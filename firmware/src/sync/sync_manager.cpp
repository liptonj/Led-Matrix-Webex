/**
 * @file sync_manager.cpp
 * @brief Sync Manager Implementation
 */

#include "sync_manager.h"
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
constexpr unsigned long HEARTBEAT_INTERVAL = 30000;  // 30 seconds
constexpr unsigned long SYNC_INTERVAL = 300000;      // 5 minutes
}  // namespace

SyncManager::SyncManager()
    : _lastHeartbeat(0), _lastFullSync(0), _lastRealtimeSocketSeen(0) {
}

SyncManager::~SyncManager() {
}

void SyncManager::begin() {
    _lastHeartbeat = 0;
    _lastFullSync = 0;
    _lastRealtimeSocketSeen = 0;
}

void SyncManager::loop(unsigned long current_time) {
    auto& deps = getDependencies();
    
    if (!deps.app_state.wifi_connected || !deps.supabase.isAuthenticated()) {
        return;
    }

    const bool commandsSocketActive = deps.realtime.isSocketConnected();
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

    // Determine sync intervals
    bool isHeartbeat = false;
    bool shouldSync = false;

    if (realtimeWorking) {
        // Realtime active: heartbeat every 30s, full sync every 5min
        if (current_time - _lastHeartbeat >= HEARTBEAT_INTERVAL) {
            isHeartbeat = true;
            shouldSync = true;
        }
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

    // Skip if realtime is connecting or heap is low
    if (realtime_connecting || !hasSafeTlsHeap(65000, 40000)) {
        return;
    }

    performSync(isHeartbeat);

    if (isHeartbeat) {
        _lastHeartbeat = current_time;
    } else {
        _lastHeartbeat = current_time;
        _lastFullSync = current_time;
    }

    // Poll for commands if not using realtime
    if (!realtimeWorking) {
        pollCommands();
    }
}

void SyncManager::forceSyncNow() {
    _lastHeartbeat = 0;
    _lastFullSync = 0;
}

bool SyncManager::isSyncDue(unsigned long current_time) const {
    return (current_time - _lastHeartbeat >= HEARTBEAT_INTERVAL);
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
            deps.app_state.webex_status = appState.webex_status;
            deps.app_state.webex_status_received = true;
            if (!appState.display_name.isEmpty()) {
                deps.app_state.embedded_app_display_name = appState.display_name;
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
            Serial.printf("[SYNC] Skipping invalid command at index %d\n", i);
            continue;
        }
        
        // Validate command ID (redundant check, but defensive)
        if (commands[i].id.isEmpty() || commands[i].id.length() < 8) {
            Serial.printf("[SYNC] Skipping command with invalid ID: '%s'\n", 
                         commands[i].id.c_str());
            continue;
        }
        
        // Validate command name
        if (commands[i].command.isEmpty()) {
            Serial.printf("[SYNC] Skipping command %s with empty command name\n", 
                         commands[i].id.c_str());
            continue;
        }
        
        Serial.printf("[SYNC] Processing command: id=%s cmd=%s\n", 
                     commands[i].id.c_str(), commands[i].command.c_str());
        handleSupabaseCommand(commands[i]);
    }
}

// =============================================================================
// SUPABASE DEVICE PROVISIONING
// =============================================================================

bool provisionDeviceWithSupabase() {
    auto& deps = getDependencies();
    
    static bool provisioned = false;
    static unsigned long last_attempt = 0;
    static unsigned long last_time_warn = 0;
    static unsigned long last_pending_log = 0;
    static unsigned long last_low_heap_log = 0;
    const unsigned long retry_interval_ms = 60000;  // 60 seconds
    const unsigned long pending_retry_interval_ms = 1800000;  // 30 minutes

    if (provisioned) {
        return true;
    }
    if (deps.supabase.isAuthenticated() || deps.app_state.supabase_connected) {
        provisioned = true;
        return true;
    }
    if (!deps.app_state.wifi_connected) {
        return false;
    }
    // Guard: Check if supabaseClient is initialized before attempting provisioning
    if (!deps.supabase.isInitialized()) {
        Serial.println("[SUPABASE] Client not initialized - skipping provisioning");
        return false;
    }
    if (deps.app_state.supabase_disabled || deps.app_state.supabase_blacklisted || deps.app_state.supabase_deleted) {
        return false;
    }
    if (!deps.app_state.time_synced) {
        unsigned long now = millis();
        if (now - last_time_warn > 60000) {
            last_time_warn = now;
            Serial.println("[SUPABASE] Waiting for NTP sync before provisioning");
        }
        return false;
    }
    if (!deps.credentials.isProvisioned()) {
        Serial.println("[SUPABASE] Credentials not ready - cannot provision");
        return false;
    }
    String supabase_url = deps.config.getSupabaseUrl();
    supabase_url.trim();
    if (supabase_url.isEmpty()) {
        Serial.println("[SUPABASE] No Supabase URL configured");
        return false;
    }
    const unsigned long retry_interval =
        deps.app_state.supabase_approval_pending ? pending_retry_interval_ms : retry_interval_ms;
    if (millis() - last_attempt < retry_interval) {
        return false;
    }
    unsigned long now = millis();
    last_attempt = now;

    if (!hasSafeTlsHeap(65000, 40000)) {
        if (now - last_low_heap_log > 60000) {
            last_low_heap_log = now;
            Serial.println("[SUPABASE] Skipping provisioning - low heap for TLS");
        }
        return false;
    }

    if (supabase_url.endsWith("/")) {
        supabase_url.remove(supabase_url.length() - 1);
    }
    String endpoint = supabase_url + "/functions/v1/provision-device";

    Serial.printf("[SUPABASE] Provisioning device via %s\n", endpoint.c_str());

    WiFiClientSecure client;
    configureSecureClientWithTls(client, CA_CERT_BUNDLE_SUPABASE, 
                                 deps.config.getTlsVerify(), 2048, 2048);

    HTTPClient http;
    http.begin(client, endpoint);
    http.setTimeout(15000);
    http.addHeader("Content-Type", "application/json");

    JsonDocument payload;
    payload["serial_number"] = deps.credentials.getSerialNumber();
    payload["key_hash"] = deps.credentials.getKeyHash();
    payload["firmware_version"] = FIRMWARE_VERSION;
    if (WiFi.isConnected()) {
        payload["ip_address"] = WiFi.localIP().toString();
    }
    // Send existing pairing code for migration (preserves user's pairing during HMAC migration)
    String existing_code = deps.pairing.getCode();
    if (!existing_code.isEmpty()) {
        payload["existing_pairing_code"] = existing_code;
    }

    String body;
    body.reserve(256);
    serializeJson(payload, body);

    int http_code = http.POST(body);
    String response = http.getString();
    http.end();

    if (http_code < 200 || http_code >= 300) {
        Serial.printf("[SUPABASE] Provision failed: HTTP %d\n", http_code);
        Serial.printf("[SUPABASE] Response: %s\n", response.c_str());
        if (http_code == 409 && response.indexOf("approval_required") >= 0) {
            deps.app_state.supabase_approval_pending = true;
            unsigned long now = millis();
            if (now - last_pending_log > 60000) {
                last_pending_log = now;
                Serial.println("[SUPABASE] Provisioning pending admin approval");
            }
        } else if (http_code == 403 && response.indexOf("awaiting_approval") >= 0) {
            // Device needs user approval
            static unsigned long last_approval_log = 0;
            if (millis() - last_approval_log > 60000) {
                last_approval_log = millis();
                Serial.println("[SUPABASE] Device awaiting user approval");
                Serial.printf("[SUPABASE] Serial: %s\n", deps.credentials.getSerialNumber().c_str());
                
                // Update display to show awaiting approval
                deps.display.displayProvisioningStatus(deps.credentials.getSerialNumber());
            }
            deps.app_state.supabase_approval_pending = true;
            return false;
        } else if (http_code == 403 && response.indexOf("device_disabled") >= 0) {
            deps.app_state.supabase_disabled = true;
            Serial.println("[SUPABASE] Device disabled by admin");
        } else if (http_code == 403 && response.indexOf("device_blacklisted") >= 0) {
            deps.app_state.supabase_blacklisted = true;
            Serial.println("[SUPABASE] Device blacklisted by admin");
        } else if (http_code == 410 && response.indexOf("device_deleted") >= 0) {
            deps.app_state.supabase_deleted = true;
            Serial.println("[SUPABASE] Device deleted - clearing credentials");
            deps.credentials.resetCredentials();
            delay(200);
            ESP.restart();
        }
        return false;
    }

    JsonDocument result;
    DeserializationError error = deserializeJson(result, response);
    if (error) {
        Serial.printf("[SUPABASE] Invalid JSON response: %s\n", error.c_str());
        return false;
    }

    if (!result["success"].as<bool>()) {
        const char* err = result["error"] | "Unknown error";
        Serial.printf("[SUPABASE] Provision error: %s\n", err);
        return false;
    }

    String pairing_code = result["pairing_code"] | "";
    if (!pairing_code.isEmpty()) {
        deps.pairing.setCode(pairing_code, true);
        deps.supabase.setPairingCode(pairing_code);
        deps.app_state.supabase_realtime_resubscribe = true;
        Serial.println("[SUPABASE] Pairing code received and set");
    }

    provisioned = true;
    deps.app_state.supabase_approval_pending = false;
    deps.app_state.supabase_disabled = false;
    deps.app_state.supabase_blacklisted = false;
    deps.app_state.supabase_deleted = false;
    Serial.println("[SUPABASE] Device provisioned successfully");

    // Immediately authenticate after provisioning so realtime can initialize
    if (deps.supabase.authenticate()) {
        deps.app_state.supabase_connected = true;
        String authAnonKey = deps.supabase.getAnonKey();
        if (!authAnonKey.isEmpty() && authAnonKey != deps.config.getSupabaseAnonKey()) {
            deps.config.setSupabaseAnonKey(authAnonKey);
            Serial.println("[SUPABASE] Anon key updated from device-auth");
        }
        
        // Immediately update device_connected so embedded app knows device is online
        if (hasSafeTlsHeap(65000, 40000)) {
            Serial.println("[SUPABASE] Sending initial device state after provisioning...");
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
        Serial.println("[SUPABASE] Authenticated after provisioning");
    } else {
        deps.app_state.supabase_connected = false;
        Serial.println("[SUPABASE] Authentication failed after provisioning");
    }
    return true;
}
