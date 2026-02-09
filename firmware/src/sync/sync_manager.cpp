/**
 * @file sync_manager.cpp
 * @brief Sync Manager Implementation
 */

#include "sync_manager.h"
#include "provision_helpers.h"
#include "../app_state.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../config/config_manager.h"
#include "../auth/device_credentials.h"
#include "../common/pairing_manager.h"
#include "../device/device_info.h"
#include "../common/secure_client_config.h"
#include "../common/ca_certs.h"
#include "../core/dependencies.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>
#include <esp_ota_ops.h>
#include "../debug/log_system.h"

static const char* TAG = "SYNC";

// Firmware version from build
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

// Global instance
SyncManager syncManager;

// Include for handleSupabaseCommand and hasSafeTlsHeap
#include "../commands/command_processor.h"
#include "../loop/loop_handlers.h"
#include "../display/matrix_display.h"

namespace {
constexpr unsigned long SYNC_INTERVAL = 300000;                  // 5 minutes
constexpr unsigned long TELEMETRY_BROADCAST_INTERVAL = 30000;    // 30 seconds
constexpr unsigned long POLL_COMMANDS_MIN_INTERVAL = 10000;      // 10 seconds
}  // namespace

SyncManager::SyncManager()
    : _lastHeartbeat(0), _lastFullSync(0), _lastRealtimeSocketSeen(0),
      _lastTelemetryBroadcast(0), _lastPollCommands(0) {
}

SyncManager::~SyncManager() {
}

void SyncManager::begin() {
    _lastHeartbeat = 0;
    _lastFullSync = 0;
    _lastRealtimeSocketSeen = 0;
    _lastTelemetryBroadcast = 0;
    _lastPollCommands = 0;
}

void SyncManager::loop(unsigned long current_time) {
    auto& deps = getDependencies();
    
    if (!deps.app_state.wifi_connected || !deps.supabase.isAuthenticated()) {
        return;
    }

    const bool commandsSocketActive = deps.realtime.isConnected();
    const bool commandsConnecting = deps.realtime.isConnecting();
    const bool realtime_connecting = commandsConnecting;

    if (commandsSocketActive) {
        _lastRealtimeSocketSeen = current_time;
    }

    const bool commandsRealtimeEnabled = !deps.config.getSupabaseAnonKey().isEmpty();
    const bool realtimeWorking = commandsRealtimeEnabled && commandsSocketActive;
    const bool realtimeStale = commandsRealtimeEnabled &&
                               (_lastRealtimeSocketSeen > 0) &&
                               (current_time - _lastRealtimeSocketSeen > 120000UL);

    // --- Telemetry broadcast (independent 30s timer, lightweight WebSocket-only) ---
    if (deps.realtime.isConnected()) {
        if (current_time - _lastTelemetryBroadcast >= TELEMETRY_BROADCAST_INTERVAL) {
            broadcastTelemetry();
            _lastTelemetryBroadcast = current_time;
        }
        // Reset telemetry timer on reconnect transition
        if (_lastTelemetryBroadcast == 0) {
            _lastTelemetryBroadcast = current_time;
        }
    } else {
        // Mark disconnected so we reset on next connect
        _lastTelemetryBroadcast = 0;
    }

    // --- Below here: HTTP sync logic (gated by shouldSync) ---

    // Determine sync intervals
    bool isHeartbeat = false;
    bool shouldSync = false;

    if (realtimeWorking) {
        // Realtime active: only full sync every 5min (no periodic HTTP polling)
        if (current_time - _lastFullSync >= SYNC_INTERVAL) {
            isHeartbeat = false;
            shouldSync = true;
        }
    } else if (realtimeStale) {
        // Realtime stale: poll every 15s
        if (current_time - _lastHeartbeat >= 15000UL) {
            isHeartbeat = false;
            shouldSync = true;
        }
    } else {
        // No realtime: poll every 10s
        if (current_time - _lastHeartbeat >= 10000UL) {
            isHeartbeat = false;
            shouldSync = true;
        }
    }

    if (!shouldSync) {
        return;
    }

    // Sync (blocked during realtime connecting AND needs heap)
    if (!realtime_connecting && hasSafeTlsHeap(65000, 40000)) {
        performSync(isHeartbeat);
        _lastHeartbeat = current_time;
        if (!isHeartbeat) {
            _lastFullSync = current_time;
        }
    } else {
        // Still advance timestamps to prevent rapid-fire retries
        _lastHeartbeat = current_time;
    }

    // Poll for commands (NOT blocked during connecting, rate-limited independently)
    if (!realtimeWorking && hasSafeTlsHeap(65000, 40000)) {
        if (current_time - _lastPollCommands >= POLL_COMMANDS_MIN_INTERVAL) {
            pollCommands();
            _lastPollCommands = current_time;
        }
    }
}

void SyncManager::forceSyncNow() {
    _lastHeartbeat = 0;
    _lastFullSync = 0;
    _lastTelemetryBroadcast = 0;
}

void SyncManager::performSync(bool isHeartbeat) {
    auto& deps = getDependencies();
    
    if (!deps.supabase.isAuthenticated()) {
        return;
    }

    int rssi = WiFi.RSSI();
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t uptime = millis() / 1000;
    #ifndef FIRMWARE_VERSION
    #define FIRMWARE_VERSION "0.0.0-dev"
    #endif
    String firmwareVersion = FIRMWARE_VERSION;

    SupabaseAppState appState = deps.supabase.postDeviceState(
        rssi, freeHeap, uptime, firmwareVersion, 0);

    if (appState.valid) {
        deps.app_state.last_supabase_sync = millis();

        if (appState.app_connected) {
            deps.app_state.supabase_app_connected = true;
            safeStrCopy(deps.app_state.webex_status, sizeof(deps.app_state.webex_status), appState.webex_status);
            deps.app_state.webex_status_received = true;
            if (!appState.display_name.isEmpty()) {
                safeStrCopy(deps.app_state.embedded_app_display_name, sizeof(deps.app_state.embedded_app_display_name), appState.display_name);
            }
            deps.app_state.camera_on = appState.camera_on;
            deps.app_state.mic_muted = appState.mic_muted;
            deps.app_state.in_call = appState.in_call;
        } else {
            deps.app_state.supabase_app_connected = false;
        }
    }
}

void SyncManager::pollCommands() {
    auto& deps = getDependencies();
    
    const int MAX_COMMANDS = 10;
    SupabaseCommand commands[MAX_COMMANDS];

    int count = deps.supabase.pollCommands(commands, MAX_COMMANDS);

    for (int i = 0; i < count; i++) {
        // REGRESSION FIX: Additional validation before command processing
        if (!commands[i].valid) {
            ESP_LOGW(TAG, "Skipping invalid command at index %d", i);
            continue;
        }
        
        // Validate command ID (redundant check, but defensive)
        if (commands[i].id.isEmpty() || commands[i].id.length() < 8) {
            ESP_LOGW(TAG, "Skipping command with invalid ID: '%s'", 
                     commands[i].id.c_str());
            continue;
        }
        
        // Validate command name
        if (commands[i].command.isEmpty()) {
            ESP_LOGW(TAG, "Skipping command %s with empty command name", 
                     commands[i].id.c_str());
            continue;
        }
        
        ESP_LOGI(TAG, "Polled command: id=%s cmd=%s",
                 commands[i].id.c_str(), commands[i].command.c_str());
        handleSupabaseCommand(commands[i]);
    }
}

void SyncManager::broadcastTelemetry() {
    auto& deps = getDependencies();
    static unsigned long broadcastCount = 0;

    int rssi = WiFi.RSSI();
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t uptime = millis() / 1000;
    float temperature = deps.app_state.temperature;
    String firmwareVersion = FIRMWARE_VERSION;

    JsonDocument telemetry;
    telemetry["device_uuid"] = deps.config.getDeviceUuid();
    telemetry["rssi"] = rssi;
    telemetry["free_heap"] = freeHeap;
    telemetry["uptime"] = uptime;
    telemetry["firmware_version"] = firmwareVersion;
    telemetry["temperature"] = temperature;
    telemetry["ssid"] = WiFi.SSID();
    telemetry["timestamp"] = (unsigned long)time(nullptr);

    // Add OTA partition info if available
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        telemetry["ota_partition"] = running->label;
    }

    bool sent = deps.realtime.sendBroadcast("device_telemetry", telemetry);
    broadcastCount++;

    // Only log on failure or every 10th success to avoid serial spam
    if (!sent) {
        ESP_LOGW(TAG, "Broadcast failed (heap=%u, rssi=%d)", freeHeap, rssi);
    } else if (broadcastCount % 10 == 0) {
        ESP_LOGI(TAG, "Telemetry broadcast #%lu (heap=%u, rssi=%d)",
                 broadcastCount, freeHeap, rssi);
    }
    // Always log to remote when enabled (even if suppressed in Serial)
    if (sent) {
        ESP_LOGD(TAG, "Sent #%lu: heap=%u rssi=%d uptime=%lu temp=%.1f fw=%s",
                 broadcastCount, freeHeap, rssi, uptime, temperature, firmwareVersion.c_str());
    }
}

void SyncManager::broadcastDeviceConfig() {
    auto& deps = getDependencies();

    if (!deps.realtime.isConnected()) {
        ESP_LOGD(TAG, "Skipping config broadcast - not connected");
        return;
    }

    String configStr = DeviceInfo::buildConfigJson();
    
    JsonDocument configDoc;
    DeserializationError err = deserializeJson(configDoc, configStr);
    if (err) {
        ESP_LOGW(TAG, "Failed to parse config JSON: %s", err.c_str());
        return;
    }

    // Add device identity and timestamp
    configDoc["device_uuid"] = deps.config.getDeviceUuid();
    configDoc["timestamp"] = (unsigned long)time(nullptr);

    bool sent = deps.realtime.sendBroadcast("device_config", configDoc);
    if (!sent) {
        ESP_LOGW(TAG, "Config broadcast failed (heap=%u)", ESP.getFreeHeap());
    } else {
        ESP_LOGD(TAG, "Config broadcast sent");
    }
}

// =============================================================================
// SUPABASE DEVICE PROVISIONING
// =============================================================================

bool provisionDeviceWithSupabase() {
    auto& deps = getDependencies();
    
    static bool provisioned = false;
    static unsigned long last_attempt = 0;
    static unsigned long last_pending_log = 0;
    static unsigned long last_low_heap_log = 0;
    const unsigned long retry_interval_ms = 30000;  // 30 seconds (Netflix-style polling)
    const unsigned long pending_retry_interval_ms = 1800000;  // 30 minutes

    // Early returns for already provisioned
    if (provisioned) {
        return true;
    }
    if (deps.supabase.isAuthenticated() || deps.app_state.supabase_connected) {
        provisioned = true;
        return true;
    }

    // Use helper for guard conditions
    if (!ProvisionHelpers::shouldAttemptProvision()) {
        return false;
    }

    // Rate limiting check
    const unsigned long retry_interval =
        deps.app_state.supabase_approval_pending ? pending_retry_interval_ms : retry_interval_ms;
    unsigned long now = millis();
    if (now - last_attempt < retry_interval) {
        return false;
    }
    last_attempt = now;

    // Heap check
    if (!hasSafeTlsHeap(65000, 40000)) {
        if (now - last_low_heap_log > 60000) {
            last_low_heap_log = now;
            ESP_LOGW(TAG, "Skipping provisioning - low heap for TLS");
        }
        return false;
    }

    // Build endpoint URL
    String supabase_url = deps.config.getSupabaseUrl();
    supabase_url.trim();
    if (supabase_url.endsWith("/")) {
        supabase_url.remove(supabase_url.length() - 1);
    }
    String endpoint = supabase_url + "/functions/v1/provision-device";

    ESP_LOGI(TAG, "Provisioning device via %s", endpoint.c_str());

    // HTTP request setup (kept local as requested)
    WiFiClientSecure client;
    configureSecureClientWithTls(client, CA_CERT_BUNDLE_SUPABASE, 
                                 deps.config.getTlsVerify(), 2048, 2048);

    HTTPClient http;
    http.begin(client, endpoint);
    http.setTimeout(15000);
    http.addHeader("Content-Type", "application/json");

    // Use helper to build payload
    String body = ProvisionHelpers::buildProvisionPayload();
    int http_code = http.POST(body);
    String response = http.getString();
    http.end();

    // Handle responses
    if (http_code < 200 || http_code >= 300) {
        ESP_LOGW(TAG, "Provision failed: HTTP %d", http_code);
        ESP_LOGD(TAG, "Response: %s", response.c_str());
        ESP_LOGW(TAG, "Failed: HTTP %d", http_code);
        
        if (http_code == 409 && response.indexOf("approval_required") >= 0) {
            deps.app_state.supabase_approval_pending = true;
            if (now - last_pending_log > 60000) {
                last_pending_log = now;
                ESP_LOGI(TAG, "Provisioning pending admin approval");
            }
        } else if (http_code == 403 && response.indexOf("awaiting_approval") >= 0) {
            // Use helper for awaiting approval handling
            int result = ProvisionHelpers::handleAwaitingApproval(response);
            if (result == 1) {
                deps.app_state.provisioning_timeout = true;
            }
            return false;
        } else if (http_code == 403 && response.indexOf("device_disabled") >= 0) {
            deps.app_state.supabase_disabled = true;
            ESP_LOGW(TAG, "Device disabled by admin");
        } else if (http_code == 403 && response.indexOf("device_blacklisted") >= 0) {
            deps.app_state.supabase_blacklisted = true;
            ESP_LOGW(TAG, "Device blacklisted by admin");
        } else if (http_code == 410 && response.indexOf("device_deleted") >= 0) {
            deps.app_state.supabase_deleted = true;
            ESP_LOGW(TAG, "Device deleted - clearing credentials");
            deps.credentials.resetCredentials();
            delay(200);
            ESP.restart();
        }
        return false;
    }

    // Parse success response
    JsonDocument result;
    DeserializationError error = deserializeJson(result, response);
    if (error) {
        ESP_LOGE(TAG, "Invalid JSON response: %s", error.c_str());
        return false;
    }

    if (!result["success"].as<bool>()) {
        const char* err = result["error"] | "Unknown error";
        ESP_LOGE(TAG, "Provision error: %s", err);
        return false;
    }

    // Handle pairing code
    String pairing_code = result["pairing_code"] | "";
    if (!pairing_code.isEmpty()) {
        deps.pairing.setCode(pairing_code, true);
        deps.supabase.setPairingCode(pairing_code);
        deps.app_state.supabase_realtime_resubscribe = true;
        ESP_LOGI(TAG, "Pairing code received and set");
    }

    // Success - reset state using helper
    provisioned = true;
    ProvisionHelpers::resetProvisionState();
    deps.app_state.supabase_approval_pending = false;
    deps.app_state.provisioning_timeout = false;
    deps.app_state.supabase_disabled = false;
    deps.app_state.supabase_blacklisted = false;
    deps.app_state.supabase_deleted = false;
    ESP_LOGI(TAG, "Device provisioned successfully");

    // Immediately authenticate after provisioning so realtime can initialize
    if (deps.supabase.authenticate()) {
        deps.app_state.supabase_connected = true;
        String authAnonKey = deps.supabase.getAnonKey();
        if (!authAnonKey.isEmpty() && authAnonKey != deps.config.getSupabaseAnonKey()) {
            deps.config.setSupabaseAnonKey(authAnonKey);
            ESP_LOGI(TAG, "Anon key updated from device-auth");
        }
        
        // Immediately update device_connected so embedded app knows device is online
        if (hasSafeTlsHeap(65000, 40000)) {
            ESP_LOGI(TAG, "Sending initial device state after provisioning...");
            int rssi = WiFi.RSSI();
            uint32_t freeHeap = ESP.getFreeHeap();
            uint32_t uptime = millis() / 1000;
            float temp = deps.app_state.temperature;
            SupabaseAppState appState = deps.supabase.postDeviceState(rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);
            if (appState.valid) {
                DeviceInfo::applyAppState(appState);
            }
        }
        
        deps.app_state.realtime_defer_until = millis() + 8000UL;
        ESP_LOGI(TAG, "Authenticated after provisioning");
    } else {
        deps.app_state.supabase_connected = false;
        ESP_LOGW(TAG, "Authentication failed after provisioning");
    }
    return true;
}
