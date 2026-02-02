/**
 * @file loop_handlers.cpp
 * @brief Loop handler implementations extracted from main.cpp
 *
 * Each handler function encapsulates a logical section of the main loop.
 * The handlers maintain the same state machine logic as the original code.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "esp_heap_caps.h"

#include "config/config_manager.h"
#include "display/matrix_display.h"
#include "discovery/mdns_manager.h"
#include "web/web_server.h"
#include "webex/webex_client.h"
#include "webex/xapi_websocket.h"
#include "common/pairing_manager.h"
#include "meraki/mqtt_client.h"
#include "ota/ota_manager.h"
#include "wifi/wifi_manager.h"
#include "supabase/supabase_client.h"
#include "supabase/supabase_realtime.h"
#include "improv/improv_handler.h"
#include "serial/serial_commands.h"
#include "sync/sync_manager.h"
#include "realtime/realtime_manager.h"
#include "commands/command_processor.h"
#include "device/device_info.h"
#include "debug/remote_logger.h"
#include "time/time_manager.h"
#include "common/secure_client_config.h"
#include "common/ca_certs.h"
#include "auth/device_credentials.h"
#include "debug.h"

// Forward declarations for functions still in main.cpp
extern void setup_time();

// External globals from main.cpp
extern bool g_debug_mode;
extern bool g_debug_display;
extern bool g_debug_realtime;

// External global instances from main.cpp
extern ConfigManager config_manager;
extern MatrixDisplay matrix_display;
extern WebServerManager web_server;
extern WiFiManager wifi_manager;
extern AppState app_state;
extern PairingManager pairing_manager;

// Firmware version from build
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

// =============================================================================
// HEAP TREND MONITOR IMPLEMENTATION
// =============================================================================

void HeapTrendMonitor::sample(unsigned long now) {
    if (now - last_sample < kSampleIntervalMs) {
        return;
    }
    last_sample = now;
    free_samples[index] = ESP.getFreeHeap();
    block_samples[index] = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    index = (index + 1) % kSamples;
    if (count < kSamples) {
        count++;
    }
}

void HeapTrendMonitor::logIfTrending(unsigned long now) {
    if (count < kSamples || now - last_log < 30000) {
        return;
    }

    bool free_dropping = true;
    bool block_dropping = true;
    uint32_t prev_free = free_samples[(index + kSamples - count) % kSamples];
    uint32_t prev_block = block_samples[(index + kSamples - count) % kSamples];
    for (uint8_t i = 1; i < count; i++) {
        uint8_t idx = (index + kSamples - count + i) % kSamples;
        uint32_t cur_free = free_samples[idx];
        uint32_t cur_block = block_samples[idx];
        if (cur_free + 256 >= prev_free) {
            free_dropping = false;
        }
        if (cur_block + 256 >= prev_block) {
            block_dropping = false;
        }
        prev_free = cur_free;
        prev_block = cur_block;
    }

    if (free_dropping || block_dropping) {
        last_log = now;
        Serial.printf("[HEAP] Trend warning: free%s block%s (last=%u block=%u)\n",
                      free_dropping ? "↓" : "-",
                      block_dropping ? "↓" : "-",
                      free_samples[(index + kSamples - 1) % kSamples],
                      block_samples[(index + kSamples - 1) % kSamples]);
    }
}

// =============================================================================
// HEAP UTILITY FUNCTIONS
// =============================================================================

void logHeapStatus(const char* label) {
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t minHeap = ESP.getMinFreeHeap();
    // Log both internal (for TLS operations) and total (includes PSRAM) for complete diagnostics
    uint32_t largestInternal = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    uint32_t largestTotal = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    Serial.printf("[HEAP] %s free=%u min=%u largest_internal=%u largest_total=%u\n",
                  label, freeHeap, minHeap, largestInternal, largestTotal);
}

bool hasSafeTlsHeap(uint32_t min_free, uint32_t min_block) {
    // TLS requires contiguous internal RAM (not PSRAM) for DMA operations
    // MALLOC_CAP_INTERNAL excludes PSRAM, ensuring we check actual internal SRAM availability
    return ESP.getFreeHeap() >= min_free &&
           heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL) >= min_block;
}

void handleLowHeapRecovery(LoopContext& ctx) {
    static unsigned long lowHeapSince = 0;
    static unsigned long lastRecovery = 0;
    const uint32_t freeHeap = ESP.getFreeHeap();
    // TLS/HTTPS operations require contiguous internal RAM, not PSRAM
    // Use MALLOC_CAP_INTERNAL to detect actual internal SRAM fragmentation
    const uint32_t largestBlock = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    const uint32_t kLowHeapFree = 50000;    // Increased from 40000
    const uint32_t kLowHeapBlock = 30000;   // Increased from 25000
    const uint32_t kCriticalFree = 40000;   // Increased from 32000
    const unsigned long kLowHeapDuration = 10000;  // Reduced from 15000 (react faster)
    const unsigned long kCriticalDuration = 2000;  // Reduced from 3000 (react faster)
    const unsigned long kRecoveryCooldown = 30000;

    const bool lowHeap = (freeHeap < kLowHeapFree || largestBlock < kLowHeapBlock);
    const bool criticalHeap = (freeHeap < kCriticalFree);

    if (lowHeap) {
        if (lowHeapSince == 0) {
            lowHeapSince = ctx.current_time;
        }
        const unsigned long duration = ctx.current_time - lowHeapSince;
        if (((duration >= kLowHeapDuration) || (criticalHeap && duration >= kCriticalDuration)) &&
            ctx.current_time - lastRecovery >= kRecoveryCooldown) {
            lastRecovery = ctx.current_time;
            Serial.printf("[HEAP] Low heap recovery triggered (free=%u block=%u)\n",
                          freeHeap, largestBlock);
            // Disconnect realtime to free heap
            supabaseRealtime.disconnect();
            ctx.app_state->realtime_defer_until = ctx.current_time + 60000UL;
            Serial.println("[HEAP] Freed realtime connection to recover heap");
        }
        return;
    }

    lowHeapSince = 0;
}

void handleHeapMonitoring(LoopContext& ctx, HeapTrendMonitor& heap_trend) {
    static uint32_t last_min_heap_logged = 0;
    uint32_t min_heap = ESP.getMinFreeHeap();
    if (last_min_heap_logged == 0 || min_heap < last_min_heap_logged) {
        last_min_heap_logged = min_heap;
        logHeapStatus("min_free_heap");
    }
    handleLowHeapRecovery(ctx);
    heap_trend.sample(ctx.current_time);
    heap_trend.logIfTrending(ctx.current_time);
}

// =============================================================================
// SERIAL AND IMPROV HANDLER
// =============================================================================

void handleSerialAndImprov(LoopContext& ctx) {
    // Process Improv Wi-Fi commands (for ESP Web Tools WiFi provisioning)
    // This must be called frequently to respond to Improv requests
    improv_handler.loop();

    // Process serial commands (for web installer WiFi setup)
    serial_commands_loop();

    // Handle WiFi credentials set via serial command
    if (serial_wifi_pending()) {
        String ssid = serial_wifi_get_ssid();
        String password = serial_wifi_get_password();
        serial_wifi_clear_pending();

        Serial.printf("[WIFI] Connecting to '%s'...\n", ssid.c_str());

        WiFi.disconnect();
        WiFi.begin(ssid.c_str(), password.c_str());

        // Wait for connection with timeout (non-blocking)
        unsigned long start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
            vTaskDelay(pdMS_TO_TICKS(500));
            Serial.print(".");
        }
        Serial.println();

        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
            ctx.app_state->wifi_connected = true;

            // Disable provisioning AP now that we're connected
            ctx.wifi_manager->disableAP();

            // Start mDNS
            ctx.mdns_manager->begin(ctx.config_manager->getDeviceName());
            ctx.mdns_manager->advertiseHTTP(80);

            // Sync time
            setup_time();

            ctx.matrix_display->showUnconfigured(WiFi.localIP().toString(), ctx.mdns_manager->getHostname());
        } else {
            Serial.println("[WIFI] Connection failed!");
            ctx.app_state->wifi_connected = false;
        }
    }
}

// =============================================================================
// WIFI CONNECTION HANDLER
// =============================================================================

void handleWiFiConnection(LoopContext& ctx) {
    // Handle WiFi connection
    ctx.wifi_manager->handleConnection(ctx.mdns_manager);

    // Track WiFi state transitions to trigger OTA check on reconnect
    static bool was_wifi_connected = false;
    if (ctx.app_state->wifi_connected && !was_wifi_connected) {
        // WiFi just connected (either first time or after disconnect)
        // Defer OTA checks to keep startup responsive.
        ctx.app_state->last_ota_check = ctx.current_time;

        // Deferred Supabase client initialization
        // Handles case where WiFi wasn't available at boot
        if (!supabaseClient.isInitialized()) {
            String supabase_url = config_manager.getSupabaseUrl();
            if (!supabase_url.isEmpty()) {
                Serial.println("[SUPABASE] Deferred initialization - WiFi now connected");
                supabaseClient.begin(supabase_url, pairing_manager.getCode());
            }
        }
    }
    was_wifi_connected = ctx.app_state->wifi_connected;
}

// =============================================================================
// MDNS HANDLER
// =============================================================================

void handleMDNS(LoopContext& ctx) {
    if (!ctx.app_state->wifi_connected) {
        return;
    }

    // Refresh mDNS periodically to prevent TTL expiry
    ctx.mdns_manager->refresh();

    // Ensure mDNS stays active even if the responder stalls
    static unsigned long last_mdns_check = 0;
    if (ctx.current_time - last_mdns_check >= 5000) {
        last_mdns_check = ctx.current_time;
        if (!ctx.mdns_manager->isInitialized()) {
            Serial.println("[MDNS] mDNS not running, restarting...");
            ctx.mdns_manager->end();
            if (ctx.mdns_manager->begin(ctx.config_manager->getDeviceName())) {
                ctx.mdns_manager->advertiseHTTP(80);
            }
        }
    }
}

// =============================================================================
// TIME SYNC HANDLER
// =============================================================================

void handleTimeSync(LoopContext& ctx) {
    // Handle NTP time sync after reconnect
    if (ctx.app_state->wifi_connected && !ctx.app_state->time_synced) {
        setup_time();
    }
}

// =============================================================================
// WEB SERVER HANDLER
// =============================================================================

bool handleWebServer(LoopContext& ctx) {
    // Process web server requests
    ctx.web_server->loop();

    // Check for pending reboot from web server
    if (ctx.web_server->checkPendingReboot()) {
        return true;  // Won't actually return, device will restart
    }

    // Complete OAuth flow if callback was received
    if (ctx.web_server->hasPendingOAuthCode()) {
        String code = ctx.web_server->consumePendingOAuthCode();
        String redirect_uri = ctx.web_server->getPendingOAuthRedirectUri();
        bool auth_ok = ctx.webex_client->handleOAuthCallback(code, redirect_uri);
        ctx.app_state->webex_authenticated = auth_ok;
        ctx.web_server->clearPendingOAuth();
        Serial.printf("[WEBEX] OAuth exchange %s\n", auth_ok ? "successful" : "failed");
        if (auth_ok) {
            RLOG_INFO("Webex", "OAuth authentication successful");
        } else {
            RLOG_ERROR("Webex", "OAuth authentication failed");
        }
    }

    return false;
}

// =============================================================================
// SUPABASE HANDLER
// =============================================================================

void handleSupabase(LoopContext& ctx) {
    // Phase A: State sync via Edge Functions (replaces bridge for pairing)
    if (ctx.app_state->wifi_connected && supabaseClient.isInitialized()) {
        syncManager.loop(ctx.current_time);
        realtimeManager.loop(ctx.current_time);
        commandProcessor.processPendingAcks();
        commandProcessor.processPendingActions();
        // Keep remote logger in sync with server-side debug toggle
        remoteLogger.setRemoteEnabled(supabaseClient.isRemoteDebugEnabled());
    }

    // Phase B: Realtime WebSocket for instant command delivery
    // Handle realtime resubscribe request
    if (ctx.app_state->supabase_realtime_resubscribe) {
        ctx.app_state->supabase_realtime_resubscribe = false;
        realtimeManager.reconnect();
    }

    // Realtime connection management and event processing
    realtimeManager.loop(ctx.current_time);
}

// =============================================================================
// XAPI WEBSOCKET HANDLER
// =============================================================================

void handleXAPIWebSocket(LoopContext& ctx) {
    // Process xAPI WebSocket
    if (ctx.xapi_websocket->isConnected()) {
        ctx.xapi_websocket->loop();

        // Check for device status updates
        if (ctx.xapi_websocket->hasUpdate()) {
            XAPIUpdate update = ctx.xapi_websocket->getUpdate();
            ctx.app_state->camera_on = update.camera_on;
            ctx.app_state->mic_muted = update.mic_muted;
            ctx.app_state->in_call = update.in_call;
            ctx.app_state->xapi_connected = true;
        }
    }
}

// =============================================================================
// WEBEX FALLBACK POLLING HANDLER
// =============================================================================

// Helper function to extract first name from display name
static String extractFirstName(const String& input) {
    String name = input;
    name.trim();
    if (name.isEmpty()) {
        return name;
    }
    int comma = name.indexOf(',');
    if (comma >= 0) {
        String after = name.substring(comma + 1);
        after.trim();
        if (!after.isEmpty()) {
            name = after;
        }
    }
    int space = name.indexOf(' ');
    if (space > 0) {
        name = name.substring(0, space);
    }
    return name;
}

bool handleWebexFallbackPolling(LoopContext& ctx) {
    // Poll Webex API as fallback when Supabase/app status is unavailable or stale
    // Conditions for fallback polling:
    // 1. Embedded app not connected, OR
    // 2. Supabase sync is stale (no update in 60+ seconds)
    const unsigned long SUPABASE_STALE_THRESHOLD = 60000UL;  // 60 seconds
    bool supabase_status_stale = (ctx.app_state->last_supabase_sync > 0) &&
                                 (ctx.current_time - ctx.app_state->last_supabase_sync > SUPABASE_STALE_THRESHOLD);
    bool need_api_fallback = !ctx.app_state->embedded_app_connected &&
                             (supabase_status_stale || !ctx.app_state->webex_status_received);

    if (!need_api_fallback || (!supabaseClient.isAuthenticated() && !ctx.app_state->webex_authenticated)) {
        return false;
    }

    unsigned long poll_interval = ctx.config_manager->getWebexPollInterval() * 1000UL;

    if (ctx.current_time - ctx.app_state->last_poll_time < poll_interval) {
        return false;
    }

    ctx.app_state->last_poll_time = ctx.current_time;

    // Log why we're polling (for debugging)
    if (supabase_status_stale) {
        Serial.println("[WEBEX] Supabase status stale, polling cloud status");
    } else if (!ctx.app_state->embedded_app_connected) {
        Serial.println("[WEBEX] Embedded app not connected, polling cloud status");
    }

    bool cloud_synced = false;
    String cloud_status;

    if (supabaseClient.isAuthenticated()) {
        if (!hasSafeTlsHeap(65000, 40000)) {
            Serial.println("[SUPABASE] Skipping webex-status - low heap for TLS");
        } else {
            cloud_synced = supabaseClient.syncWebexStatus(cloud_status);
            if (cloud_synced) {
                ctx.app_state->webex_status = cloud_status;
                ctx.app_state->webex_status_received = true;
                ctx.app_state->webex_status_source = "cloud";
                Serial.printf("[WEBEX] Cloud status: %s\n", cloud_status.c_str());
            }
        }
    }

    if (!cloud_synced) {
        if (ctx.app_state->embedded_app_connected) {
            return true;
        }
        if (supabaseClient.isWebexTokenMissing() && ctx.app_state->wifi_connected) {
            Serial.println("[WEBEX] No Webex token; skipping local fallback");
            return true;
        }
        if (!ctx.app_state->webex_authenticated) {
            static unsigned long last_local_skip_log = 0;
            unsigned long now = millis();
            if (now - last_local_skip_log > 60000) {
                last_local_skip_log = now;
                Serial.println("[WEBEX] Local API auth unavailable; skipping local fallback");
            }
            return true;
        }
        Serial.println("[WEBEX] Cloud status failed, polling local API");
        WebexPresence presence;
        if (ctx.webex_client->getPresence(presence)) {
            ctx.app_state->webex_status = presence.status;
            ctx.app_state->webex_status_received = true;
            ctx.app_state->webex_status_source = "local";

            // Auto-populate display name with firstName if not already set
            if (ctx.config_manager->getDisplayName().isEmpty() && !presence.first_name.isEmpty()) {
                ctx.config_manager->setDisplayName(presence.first_name);
                Serial.printf("[WEBEX] Auto-populated display name: %s\n", presence.first_name.c_str());
            }

            // Derive in_call from status if not connected to xAPI
            if (!ctx.app_state->xapi_connected) {
                ctx.app_state->in_call = (presence.status == "meeting" || presence.status == "busy" ||
                                         presence.status == "call" || presence.status == "presenting");
            }

            JsonDocument payload;
            payload["webex_status"] = presence.status;
            if (!presence.display_name.isEmpty()) {
                payload["display_name"] = presence.display_name;
            } else if (!presence.first_name.isEmpty()) {
                payload["display_name"] = presence.first_name;
            }
            payload["camera_on"] = ctx.app_state->camera_on;
            payload["mic_muted"] = ctx.app_state->mic_muted;
            payload["in_call"] = ctx.app_state->in_call;

            String body;
            serializeJson(payload, body);

            String ignored;
            supabaseClient.syncWebexStatus(ignored, body);
        }
    }

    return false;
}

// =============================================================================
// MQTT HANDLER
// =============================================================================

void handleMQTT(LoopContext& ctx) {
    if (!ctx.app_state->wifi_connected || !ctx.config_manager->hasMQTTConfig()) {
        ctx.app_state->mqtt_connected = false;
        ctx.app_state->sensor_data_valid = false;
        return;
    }

    if (!ctx.mqtt_client->isInitialized()) {
        ctx.mqtt_client->begin(ctx.config_manager);
    }

    ctx.mqtt_client->loop();
    ctx.app_state->mqtt_connected = ctx.mqtt_client->isConnected();
    if (!ctx.app_state->mqtt_connected) {
        ctx.app_state->sensor_data_valid = false;
    }

    // Check for sensor updates
    static String last_display_sensor;
    const String configured_display_sensor = ctx.config_manager->getDisplaySensorMac();
    const bool update_available = ctx.mqtt_client->hasUpdate();

    if (update_available) {
        MerakiSensorData latest = ctx.mqtt_client->getLatestData();
        if (configured_display_sensor.isEmpty()) {
            ctx.app_state->temperature = latest.temperature;
            ctx.app_state->humidity = latest.humidity;
            ctx.app_state->door_status = latest.door_status;
            ctx.app_state->air_quality_index = latest.air_quality_index;
            ctx.app_state->tvoc = latest.tvoc;
            ctx.app_state->co2_ppm = latest.co2_ppm;
            ctx.app_state->pm2_5 = latest.pm2_5;
            ctx.app_state->ambient_noise = latest.ambient_noise;
            ctx.app_state->sensor_mac = latest.sensor_mac;
            last_display_sensor = latest.sensor_mac;
            ctx.app_state->sensor_data_valid = latest.valid;
            ctx.app_state->last_sensor_update = millis();
        }
    }

    if (!configured_display_sensor.isEmpty() &&
        (update_available || configured_display_sensor != last_display_sensor)) {
        MerakiSensorData selected;
        if (ctx.mqtt_client->getSensorData(configured_display_sensor, selected)) {
            ctx.app_state->temperature = selected.temperature;
            ctx.app_state->humidity = selected.humidity;
            ctx.app_state->door_status = selected.door_status;
            ctx.app_state->air_quality_index = selected.air_quality_index;
            ctx.app_state->tvoc = selected.tvoc;
            ctx.app_state->co2_ppm = selected.co2_ppm;
            ctx.app_state->pm2_5 = selected.pm2_5;
            ctx.app_state->ambient_noise = selected.ambient_noise;
            ctx.app_state->sensor_mac = configured_display_sensor;
            last_display_sensor = configured_display_sensor;
            ctx.app_state->sensor_data_valid = selected.valid;
            ctx.app_state->last_sensor_update = millis();
        }
    }
}

// =============================================================================
// SUPABASE PROVISIONING HANDLER
// =============================================================================

void handleSupabaseProvisioning(LoopContext& ctx) {
    // Attempt Supabase provisioning (retry until successful)
    if (ctx.app_state->wifi_connected) {
        provisionDeviceWithSupabase();
    }
}

// =============================================================================
// OTA CHECK HANDLER
// =============================================================================

// External global for OTA manager
extern OTAManager ota_manager;

/**
 * @brief Check for firmware updates and perform auto-update if enabled
 */
void check_for_updates() {
    Serial.println("[OTA] Checking for updates...");
    bool realtime_was_active = supabaseRealtime.isConnected() || supabaseRealtime.isConnecting();
    if (realtime_was_active) {
        Serial.println("[OTA] Pausing realtime during OTA check");
        supabaseRealtime.disconnect();
    }
    // Defer realtime for check phase - will extend if update starts
    app_state.realtime_defer_until = millis() + 30000UL;

    if (ota_manager.checkForUpdate()) {
        String new_version = ota_manager.getLatestVersion();
        Serial.printf("[OTA] Update available: %s\n", new_version.c_str());

        if (config_manager.getAutoUpdate()) {
            // Check if this version previously failed - skip to avoid retry loop
            String failed_version = config_manager.getFailedOTAVersion();
            if (!failed_version.isEmpty() && failed_version == new_version) {
                Serial.printf("[OTA] Skipping auto-update - version %s previously failed\n",
                              new_version.c_str());
                return;
            }

            Serial.println("[OTA] Auto-update enabled, installing...");
            matrix_display.showUpdating(new_version);

            // Disconnect realtime and defer for 10 minutes to cover the entire download
            // This is critical to free memory and prevent network contention during OTA
            if (supabaseRealtime.isConnected() || supabaseRealtime.isConnecting()) {
                Serial.println("[OTA] Disconnecting realtime for update");
                supabaseRealtime.disconnect();
            }
            app_state.realtime_defer_until = millis() + 600000UL;  // 10 minutes

            if (ota_manager.performUpdate()) {
                Serial.println("[OTA] Update successful, rebooting...");
                config_manager.clearFailedOTAVersion();
                ESP.restart();
            } else {
                Serial.println("[OTA] Update failed!");
                matrix_display.unlockFromOTA();  // Unlock display on failure
                // Record this version as failed to prevent retry loop
                config_manager.setFailedOTAVersion(new_version);
                Serial.printf("[OTA] Marked version %s as failed - will not auto-retry\n",
                              new_version.c_str());
            }
        }
    } else {
        Serial.println("[OTA] No updates available.");
    }

    if (realtime_was_active) {
        app_state.supabase_realtime_resubscribe = true;
    }
}

void handleOTACheck(LoopContext& ctx) {
    // Check for OTA updates (hourly)
    if (ctx.current_time - ctx.app_state->last_ota_check >= 3600000UL) {
        ctx.app_state->last_ota_check = ctx.current_time;
        check_for_updates();
    }
}

// =============================================================================
// CONNECTION STATUS LOGGING HANDLER
// =============================================================================

void handleConnectionStatusLogging(LoopContext& ctx) {
    // Print connection info every 15 seconds (visible on serial connect)
    static unsigned long last_connection_print = 0;
    if (ctx.current_time - last_connection_print < 15000) {
        return;
    }
    last_connection_print = ctx.current_time;

    if (!ctx.app_state->wifi_connected) {
        return;
    }

    // Determine status source for logging
    const char* status_source = ctx.app_state->webex_status_source.isEmpty()
        ? (ctx.app_state->embedded_app_connected ? "embedded_app" : "unknown")
        : ctx.app_state->webex_status_source.c_str();

    Serial.println();
    Serial.println("=== WEBEX STATUS DISPLAY ===");
    Serial.printf("IP: %s | mDNS: %s.local\n",
                  WiFi.localIP().toString().c_str(),
                  ctx.mdns_manager->getHostname().c_str());
    Serial.printf("Status: %s (via %s) | MQTT: %s\n",
                  ctx.app_state->webex_status.c_str(),
                  status_source,
                  ctx.app_state->mqtt_connected ? "Yes" : "No");
    Serial.printf("Supabase: %s | App: %s | Webex Source: %s\n",
                  ctx.app_state->supabase_connected ? "Yes" : "No",
                  ctx.app_state->embedded_app_connected ? "Yes" : "No",
                  status_source);
    Serial.println("============================");
}

// =============================================================================
// DISPLAY UPDATE HANDLER
// =============================================================================

/**
 * @brief Parse a hex color string to RGB565 format
 */
static uint16_t parseColor565(const String& input, uint16_t fallback) {
    String hex = input;
    hex.trim();
    if (hex.startsWith("#")) {
        hex = hex.substring(1);
    }
    if (hex.startsWith("0x") || hex.startsWith("0X")) {
        hex = hex.substring(2);
    }
    if (hex.length() == 3) {
        String expanded;
        expanded.reserve(6);
        for (size_t i = 0; i < 3; i++) {
            char c = hex[i];
            expanded += c;
            expanded += c;
        }
        hex = expanded;
    }
    if (hex.length() != 6) {
        return fallback;
    }
    char* endptr = nullptr;
    long value = strtol(hex.c_str(), &endptr, 16);
    if (endptr == nullptr || *endptr != '\0') {
        return fallback;
    }
    uint8_t r = (value >> 16) & 0xFF;
    uint8_t g = (value >> 8) & 0xFF;
    uint8_t b = value & 0xFF;
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

/**
 * @brief Update the LED matrix display
 */
void update_display() {
    static unsigned long last_update = 0;
    static unsigned long last_config_refresh = 0;
    static uint8_t last_brightness = 0;
    static bool brightness_initialized = false;

    struct DisplayConfigCache {
        bool initialized = false;
        uint8_t brightness = 128;
        uint16_t scroll_speed_ms = 60;
        uint16_t page_interval_ms = 5000;
        uint8_t border_width = 1;
        String display_pages;
        String status_layout;
        String display_metric;
        String display_name;
        String display_name_short;
        String device_name;
        String device_name_short;
        uint16_t date_color = COLOR_CYAN;
        uint16_t time_color = COLOR_WHITE;
        uint16_t name_color = COLOR_ORANGE;
        uint16_t metric_color = COLOR_BLUE;
        bool use_24h = false;
        uint8_t date_format = 0;
    };
    static DisplayConfigCache cached;

    // Update display at ~30 FPS
    if (millis() - last_update < 33) {
        return;
    }
    last_update = millis();
    const unsigned long now = millis();
    if (!cached.initialized || now - last_config_refresh >= 1000) {
        last_config_refresh = now;
        cached.initialized = true;
        cached.brightness = config_manager.getBrightness();
        cached.scroll_speed_ms = config_manager.getScrollSpeedMs();
        cached.page_interval_ms = config_manager.getPageIntervalMs();
        cached.border_width = config_manager.getBorderWidth();
        cached.display_pages = config_manager.getDisplayPages();
        cached.status_layout = config_manager.getStatusLayout();
        cached.display_metric = config_manager.getDisplayMetric();
        cached.display_name = config_manager.getDisplayName();
        cached.display_name_short = extractFirstName(cached.display_name);
        cached.device_name = config_manager.getDeviceName();
        cached.device_name_short = extractFirstName(cached.device_name);
        cached.date_color = parseColor565(config_manager.getDateColor(), COLOR_CYAN);
        cached.time_color = parseColor565(config_manager.getTimeColor(), COLOR_WHITE);
        cached.name_color = parseColor565(config_manager.getNameColor(), COLOR_ORANGE);
        cached.metric_color = parseColor565(config_manager.getMetricColor(), COLOR_BLUE);
        cached.use_24h = config_manager.use24HourTime();
        cached.date_format = config_manager.getDateFormatCode();
        
        // Update runtime debug flags
        g_debug_display = config_manager.getDebugDisplay();
        g_debug_realtime = config_manager.getDebugRealtime();
    }

    if (!brightness_initialized || last_brightness != cached.brightness) {
        last_brightness = cached.brightness;
        brightness_initialized = true;
        matrix_display.setBrightness(cached.brightness);
    }
    matrix_display.setScrollSpeedMs(cached.scroll_speed_ms);
    matrix_display.setPageIntervalMs(cached.page_interval_ms);

    // Show updating screen during OTA file upload
    if (web_server.isOTAUploadInProgress()) {
        matrix_display.showUpdating("Uploading...");
        return;
    }

    // If WiFi is not connected, show appropriate screen
    if (!app_state.wifi_connected) {
        if (wifi_manager.isAPModeActive()) {
            // In AP mode for setup - show AP mode screen
            matrix_display.showAPMode(WiFi.softAPIP().toString());
        } else {
            // WiFi was configured but connection dropped
            matrix_display.showWifiDisconnected();
        }
        return;
    }

    // If Webex is unavailable, keep showing a generic screen with IP
    // Only show unconfigured screen if WiFi is connected but no services are connected
    // Note: Even "unknown" status should be displayed on the status page, not trigger unconfigured screen
    const bool has_app_presence = app_state.embedded_app_connected || app_state.supabase_app_connected;
    if (app_state.wifi_connected &&
        !app_state.xapi_connected &&
        !app_state.webex_authenticated &&
        !app_state.mqtt_connected &&
        !has_app_presence &&
        !app_state.webex_status_received) {
        // Show unconfigured screen only when truly no services are connected
        // Status display will show "unknown" status if webex_status is "unknown"
        const uint16_t unconfigured_scroll = cached.scroll_speed_ms < 60 ? cached.scroll_speed_ms : 60;
        matrix_display.setScrollSpeedMs(unconfigured_scroll);
        matrix_display.showUnconfigured(WiFi.localIP().toString(), cached.device_name);
        return;
    }

    // Build display data
    DisplayData data;
    data.webex_status = app_state.webex_status;
    // Prefer embedded app display name (from Webex SDK), fallback to config, then device name
    if (app_state.embedded_app_connected && !app_state.embedded_app_display_name.isEmpty()) {
        data.display_name = extractFirstName(app_state.embedded_app_display_name);
    } else if (!cached.display_name_short.isEmpty()) {
        data.display_name = cached.display_name_short;
    } else {
        // Fallback to device name if no display name is configured
        data.display_name = cached.device_name_short;
    }
    data.camera_on = app_state.camera_on;
    data.mic_muted = app_state.mic_muted;
    data.in_call = app_state.in_call;
    // Show call status when we have camera/mic info (xAPI) OR when in a call from any source
    data.show_call_status = app_state.xapi_connected || app_state.embedded_app_connected || app_state.in_call;
    data.temperature = app_state.temperature;
    data.humidity = app_state.humidity;
    data.door_status = app_state.door_status;
    data.air_quality_index = app_state.air_quality_index;
    data.tvoc = app_state.tvoc;
    data.co2_ppm = app_state.co2_ppm;
    data.pm2_5 = app_state.pm2_5;
    data.ambient_noise = app_state.ambient_noise;
    data.right_metric = cached.display_metric;
    data.show_sensors = app_state.mqtt_connected && app_state.sensor_data_valid;
    const String& page_mode = cached.display_pages;
    if (page_mode == "status") {
        data.page_mode = DisplayPageMode::STATUS_ONLY;
    } else if (page_mode == "sensors") {
        data.page_mode = DisplayPageMode::SENSORS_ONLY;
    } else {
        data.page_mode = DisplayPageMode::ROTATE;
    }
    const String& status_layout = cached.status_layout;
    data.status_layout = (status_layout == "name") ? StatusLayoutMode::NAME : StatusLayoutMode::SENSORS;
    data.border_width = cached.border_width;
    data.date_color = cached.date_color;
    data.time_color = cached.time_color;
    data.name_color = cached.name_color;
    data.metric_color = cached.metric_color;

    // Connection indicators
    data.wifi_connected = app_state.wifi_connected;

    // Get current time (cache once per second)
    static struct tm last_timeinfo;
    static bool has_time = false;
    static unsigned long last_time_check_ms = 0;
    if (millis() - last_time_check_ms >= 1000) {
        last_time_check_ms = millis();
        struct tm timeinfo;
        if (getLocalTime(&timeinfo)) {
            last_timeinfo = timeinfo;
            has_time = true;
            app_state.time_synced = true;
        } else if (!app_state.time_synced) {
            has_time = false;
        }
    }
    if (has_time) {
        data.hour = last_timeinfo.tm_hour;
        data.minute = last_timeinfo.tm_min;
        data.day = last_timeinfo.tm_mday;
        data.month = last_timeinfo.tm_mon + 1;  // tm_mon is 0-11
        data.time_valid = true;
    }
    data.use_24h = cached.use_24h;
    data.date_format = cached.date_format;

    matrix_display.update(data);
}

void handleDisplayUpdate(LoopContext& ctx) {
    update_display();
}

// =============================================================================
// MAIN LOOP ORCHESTRATOR
// =============================================================================

void executeLoopHandlers(LoopContext& ctx) {
    static HeapTrendMonitor heap_trend;

    // 1. Heap monitoring (early, to detect issues)
    handleHeapMonitoring(ctx, heap_trend);

    // 2. Serial and Improv WiFi provisioning
    handleSerialAndImprov(ctx);

    // 3. WiFi connection management
    handleWiFiConnection(ctx);

    // 4. mDNS maintenance
    handleMDNS(ctx);

    // 5. NTP time sync
    handleTimeSync(ctx);

    // 6. Web server processing
    if (handleWebServer(ctx)) {
        return;  // Pending reboot
    }

    // 7. Supabase sync and realtime
    handleSupabase(ctx);

    // 8. xAPI WebSocket processing
    handleXAPIWebSocket(ctx);

    // 9. Webex API fallback polling
    if (handleWebexFallbackPolling(ctx)) {
        return;  // Early return from fallback logic
    }

    // 10. MQTT sensor processing
    handleMQTT(ctx);

    // 11. Supabase provisioning
    handleSupabaseProvisioning(ctx);

    // 12. OTA update check
    handleOTACheck(ctx);

    // 13. Connection status logging
    handleConnectionStatusLogging(ctx);

    // 14. Display update (always last)
    handleDisplayUpdate(ctx);

    // Small delay to prevent watchdog issues
    delay(10);
}

#endif // !NATIVE_BUILD
