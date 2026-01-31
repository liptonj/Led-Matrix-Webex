/**
 * @file main.cpp
 * @brief ESP32-S3 Webex Status Display - Main Entry Point
 *
 * Displays Webex presence status, camera/mic state, and Meraki MT sensor
 * data on a 64x32 RGB LED matrix.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include "esp_task_wdt.h"
#include "esp_ota_ops.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "esp_heap_caps.h"

#include "auth/device_credentials.h"
#include "boot_validator.h"
#include "config/config_manager.h"
#include "debug.h"
#include "debug/remote_logger.h"
#include "display/matrix_display.h"
#include "discovery/mdns_manager.h"
#include "improv/improv_handler.h"
#include "serial/serial_commands.h"
#include "web/web_server.h"
#include "webex/webex_client.h"
#include "webex/xapi_websocket.h"
#include "common/pairing_manager.h"
#include "supabase/supabase_client.h"
#include "supabase/supabase_realtime.h"
#include "common/ca_certs.h"
#include "common/secure_client_config.h"
#include "meraki/mqtt_client.h"
#include "ota/ota_manager.h"
#include "time/time_manager.h"
#include "wifi/wifi_manager.h"

// New modular components
#include "sync/sync_manager.h"
#include "realtime/realtime_manager.h"
#include "device/device_info.h"
#include "commands/command_processor.h"

// Firmware version - defined in platformio.ini [version] section
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

// Global instances
ConfigManager config_manager;
MatrixDisplay matrix_display;
MDNSManager mdns_manager;
WebServerManager web_server;
WebexClient webex_client;
XAPIWebSocket xapi_websocket;
PairingManager pairing_manager;
MerakiMQTTClient mqtt_client;
OTAManager ota_manager;
WiFiManager wifi_manager;

// Application state (defined in app_state.h)
#include "app_state.h"
AppState app_state;

// Debug mode flag (used by DEBUG_LOG macro in debug.h)
bool g_debug_mode = false;

// Forward declarations
void setup_time();
void update_display();
void check_for_updates();
void handleSupabaseCommand(const SupabaseCommand& cmd);
void handleRealtimeMessage(const RealtimeMessage& msg);
bool provisionDeviceWithSupabase();

static void logHeapStatus(const char* label) {
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t minHeap = ESP.getMinFreeHeap();
    uint32_t largestBlock = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    Serial.printf("[HEAP] %s free=%u min=%u largest=%u\n",
                  label, freeHeap, minHeap, largestBlock);
}

static bool hasSafeTlsHeap(uint32_t min_free, uint32_t min_block) {
    return ESP.getFreeHeap() >= min_free &&
           heap_caps_get_largest_free_block(MALLOC_CAP_8BIT) >= min_block;
}

static void handleLowHeapRecovery(unsigned long now) {
    static unsigned long lowHeapSince = 0;
    static unsigned long lastRecovery = 0;
    const uint32_t freeHeap = ESP.getFreeHeap();
    const uint32_t largestBlock = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
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
            lowHeapSince = now;
        }
        const unsigned long duration = now - lowHeapSince;
        if (((duration >= kLowHeapDuration) || (criticalHeap && duration >= kCriticalDuration)) &&
            now - lastRecovery >= kRecoveryCooldown) {
            lastRecovery = now;
            Serial.printf("[HEAP] Low heap recovery triggered (free=%u block=%u)\n",
                          freeHeap, largestBlock);
            // Disconnect realtime to free heap
            supabaseRealtime.disconnect();
            app_state.realtime_defer_until = now + 60000UL;
            Serial.println("[HEAP] Freed realtime connection to recover heap");
        }
        return;
    }

    lowHeapSince = 0;
}

struct HeapTrendMonitor {
    static constexpr uint8_t kSamples = 8;
    static constexpr unsigned long kSampleIntervalMs = 5000;
    uint32_t free_samples[kSamples] = {};
    uint32_t block_samples[kSamples] = {};
    uint8_t count = 0;
    uint8_t index = 0;
    unsigned long last_sample = 0;
    unsigned long last_log = 0;

    void sample(unsigned long now) {
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

    void logIfTrending(unsigned long now) {
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
};

// Command queue management moved to command_processor module

/**
 * @brief Arduino setup function
 */
void setup() {
    Serial.begin(115200);
    delay(100);  // Reduced from 1000ms for faster Improv detection

    // CRITICAL: Configure watchdog timeout FIRST to prevent boot loops
    // during slow initialization (display, WiFi, etc.)
    esp_task_wdt_init(30, false);  // 30 second timeout, no panic

    Serial.println();
    Serial.println("===========================================");
    Serial.println("  Webex Status Display - ESP32-S3");
    Serial.printf("  Firmware Version: %s\n", FIRMWARE_VERSION);
    Serial.println("===========================================");
    Serial.println();

    // Boot validation - check if we should rollback to bootstrap
    // This must be called early before other initialization
    if (!boot_validator.begin()) {
        // This won't return if rollback is triggered
        Serial.println("[ERROR] Boot validation failed!");
    }

    // Initialize configuration EARLY - needed for Improv device name
    Serial.println("[INIT] Loading configuration...");
    if (!config_manager.begin()) {
        Serial.println("[ERROR] Failed to initialize configuration!");
        boot_validator.onCriticalFailure("Config", "Failed to load configuration");
        // Won't return - device reboots to bootloader
    }

    // Store version for the currently running partition (for OTA version tracking)
    // This ensures we can always display the correct version even after updates
    #ifndef NATIVE_BUILD
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        #ifdef FIRMWARE_VERSION
        config_manager.setPartitionVersion(String(running->label), FIRMWARE_VERSION);
        Serial.printf("[INIT] Stored version %s for partition %s\n", FIRMWARE_VERSION, running->label);
        #endif
    }
    #endif

    // Initialize debug mode from config
    g_debug_mode = config_manager.getDebugMode();
    if (g_debug_mode) {
        Serial.println("[INIT] Debug mode ENABLED - verbose logging active");
    }

    // Initialize device credentials (serial number, authentication key)
    Serial.println("[INIT] Initializing device credentials...");
    if (!deviceCredentials.begin()) {
        Serial.println("[WARN] Failed to initialize device credentials - authentication disabled");
    } else {
        Serial.printf("[INIT] Device serial: %s\n", deviceCredentials.getSerialNumber().c_str());
        Serial.printf("[INIT] Device ID: %s\n", deviceCredentials.getDeviceId().c_str());
    }

    // =========================================================================
    // Initialize display FIRST so we can show status during Improv provisioning
    // =========================================================================
    Serial.println("[INIT] Initializing LED matrix...");
    Serial.flush();
    delay(10);  // Feed watchdog before long operation

    bool display_ok = matrix_display.begin();
    if (!display_ok) {
        Serial.println("[WARN] Display initialization failed - continuing without display");
    } else {
        Serial.println("[INIT] Display ready!");
        matrix_display.setBrightness(config_manager.getBrightness());
        matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());
        matrix_display.showStartupScreen(FIRMWARE_VERSION);
    }

    // =========================================================================
    // IMPROV WiFi - Initialize for ESP Web Tools WiFi provisioning
    // =========================================================================

    // Initialize WiFi in STA mode (required for scanning)
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(WIFI_PS_NONE);  // Disable power save (prevents display interference)
    Serial.println("[INIT] WiFi initialized in STA mode");

    Serial.println("[IMPROV] Initializing Improv Wi-Fi handler...");
    improv_handler.begin(&Serial, &config_manager, &app_state, display_ok ? &matrix_display : nullptr);

    // Check if WiFi is already configured - still allow a brief Improv window
    bool wifi_configured = config_manager.hasWiFiCredentials();
    
    // Check boot count - if high, we're in a boot loop and need extended timeouts
    // This allows recovery via website firmware installer even during boot loops
    int boot_count = boot_validator.getBootCount();
    bool recovery_mode = (boot_count > MAX_BOOT_FAILURES);
    
    // Two-phase Improv detection:
    // Phase 1: Quick detection (10 seconds normal, 5 minutes in recovery mode)
    // Phase 2: If activity detected, extend to 60 seconds (normal) or 5 minutes (recovery)
    
    // Extend timeouts significantly if we're in recovery mode (boot loop)
    unsigned long DETECT_TIMEOUT = recovery_mode ? 300000 : 10000;   // 5 min vs 10 sec
    unsigned long PROVISION_TIMEOUT = recovery_mode ? 300000 : 60000;  // 5 min vs 60 sec

    if (recovery_mode) {
        Serial.println("[IMPROV] RECOVERY MODE: Boot loop detected, extending timeouts for firmware installer recovery");
        Serial.printf("[IMPROV] Boot count: %d (threshold: %d)\n", boot_count, MAX_BOOT_FAILURES);
        Serial.printf("[IMPROV] Extended timeouts: %lu sec detection, %lu sec provisioning\n",
                      DETECT_TIMEOUT / 1000, PROVISION_TIMEOUT / 1000);
    }

    if (wifi_configured) {
        Serial.println("[IMPROV] WiFi credentials present - listening briefly for Improv...");
    } else {
        Serial.printf("[IMPROV] No WiFi configured - detecting serial activity (%lu seconds)...\n",
                      DETECT_TIMEOUT / 1000);
    }

    unsigned long detect_start = millis();
    bool improv_activity_detected = false;

    // Phase 1: Detection
    while (millis() - detect_start < DETECT_TIMEOUT) {
        // Check serial BEFORE Improv consumes it
        if (Serial.available() > 0) {
            improv_activity_detected = true;
            Serial.println("[IMPROV] Serial activity detected! Extending window for provisioning...");

            // Show provisioning screen on display
            if (display_ok) {
                matrix_display.showImprovProvisioning();
            }
            break;
        }

        improv_handler.loop();

        // Check if WiFi was configured
        if (improv_handler.wasConfiguredViaImprov() || WiFi.status() == WL_CONNECTED) {
            Serial.println("[IMPROV] WiFi configured successfully!");
            break;
        }

        delay(10);
    }

    // Phase 2: Extended provisioning if activity was detected
    if (improv_activity_detected && WiFi.status() != WL_CONNECTED) {
        Serial.printf("[IMPROV] Waiting for WiFi provisioning (%lu seconds)...\n",
                      PROVISION_TIMEOUT / 1000);

        unsigned long provision_start = millis();
        unsigned long last_status = 0;

        while (millis() - provision_start < PROVISION_TIMEOUT) {
            improv_handler.loop();

            // Check if WiFi was configured via Improv
            if (improv_handler.wasConfiguredViaImprov() || WiFi.status() == WL_CONNECTED) {
                Serial.println("[IMPROV] WiFi configured successfully!");
                break;
            }

            // Print countdown every 5 seconds
            unsigned long elapsed = millis() - provision_start;
            if (elapsed - last_status >= 5000) {
                last_status = elapsed;
                Serial.printf("[IMPROV] Waiting... %lu seconds remaining\n",
                              (PROVISION_TIMEOUT - elapsed) / 1000);
            }

            delay(10);
        }
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("[IMPROV] Provisioning complete, continuing boot...");
        if (display_ok) {
            matrix_display.showUnconfigured(WiFi.localIP().toString(), "");
        }
        
        // If WiFi was configured via Improv (from ESP Web Tools), mark boot successful early
        // This prevents boot loop if other initialization fails, allowing WiFi provisioning to complete
        if (improv_handler.wasConfiguredViaImprov()) {
            Serial.println("[IMPROV] WiFi configured via ESP Web Tools - marking boot successful early");
            boot_validator.markBootSuccessful();
        }
    } else if (!improv_activity_detected) {
        Serial.println("[IMPROV] No serial activity detected, continuing boot...");
    } else {
        Serial.println("[IMPROV] Provisioning window closed, continuing to AP mode...");
    }

    // Setup WiFi (includes AP mode fallback if connection fails)
    Serial.println("[INIT] Setting up WiFi...");
    wifi_manager.begin(&config_manager, &app_state, &matrix_display);
    wifi_manager.setupWiFi();

    // Initialize mDNS
    if (app_state.wifi_connected) {
        Serial.println("[INIT] Starting mDNS...");
        mdns_manager.begin(config_manager.getDeviceName());
        mdns_manager.advertiseHTTP(80);

        // Sync time via NTP
        Serial.println("[INIT] Syncing time via NTP...");
        setup_time();
    }

    // Start web server
    Serial.println("[INIT] Starting web server...");
    web_server.begin(&config_manager, &app_state, nullptr, &mdns_manager);

    // Initialize Webex client
    if (config_manager.hasWebexCredentials()) {
        Serial.println("[INIT] Initializing Webex client...");
        webex_client.begin(&config_manager);

        // Try to authenticate
        if (config_manager.hasWebexTokens()) {
            app_state.webex_authenticated = webex_client.refreshToken();
        }
    }

    // Initialize pairing manager (generates/loads pairing code)
    Serial.println("[INIT] Initializing pairing manager...");
    pairing_manager.begin();
    Serial.printf("[INIT] Pairing code: %s\n", pairing_manager.getCode().c_str());

    // Initialize command processor
    Serial.println("[INIT] Initializing command processor...");
    commandProcessor.begin();

    // Initialize sync manager
    Serial.println("[INIT] Initializing sync manager...");
    syncManager.begin();

    // Initialize realtime manager
    Serial.println("[INIT] Initializing realtime manager...");
    realtimeManager.begin();

    // Register device with Supabase on first boot (requires WiFi + Supabase URL)
    if (app_state.wifi_connected) {
        provisionDeviceWithSupabase();
    }

    // Initialize Supabase client for Phase A state sync
    String supabase_url = config_manager.getSupabaseUrl();
    if (!supabase_url.isEmpty() && app_state.wifi_connected) {
        Serial.println("[INIT] Initializing Supabase client...");
        supabaseClient.begin(supabase_url, pairing_manager.getCode());
        
        // Attempt initial authentication
        if (app_state.supabase_approval_pending || app_state.supabase_disabled ||
            app_state.supabase_blacklisted || app_state.supabase_deleted) {
            Serial.println("[SUPABASE] Provisioning awaiting admin approval - skipping auth");
        } else if (!app_state.time_synced) {
            Serial.println("[SUPABASE] Waiting for NTP sync before authenticating");
        } else if (supabaseClient.authenticate()) {
            app_state.supabase_connected = true;
            Serial.println("[INIT] Supabase client authenticated successfully");

            String authAnonKey = supabaseClient.getAnonKey();
            if (!authAnonKey.isEmpty() && authAnonKey != config_manager.getSupabaseAnonKey()) {
                config_manager.setSupabaseAnonKey(authAnonKey);
                Serial.println("[SUPABASE] Anon key updated from device-auth");
            }
            
            // Check for target firmware version
            String targetVersion = supabaseClient.getTargetFirmwareVersion();
            if (!targetVersion.isEmpty()) {
                Serial.printf("[INIT] Target firmware version from Supabase: %s\n", 
                              targetVersion.c_str());
            }
            
            // Immediately update device_connected so embedded app knows device is online
            if (hasSafeTlsHeap(65000, 40000)) {
                Serial.println("[INIT] Sending initial device state to mark device as connected...");
                int rssi = WiFi.RSSI();
                uint32_t freeHeap = ESP.getFreeHeap();
                uint32_t uptime = millis() / 1000;
                float temp = app_state.temperature;
                SupabaseAppState appState = supabaseClient.postDeviceState(rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);
                if (appState.valid) {
                    DeviceInfo::applyAppState(appState);
                }
            }
            
            Serial.println("[INIT] Deferring Supabase Realtime init until after OTA/web server settle...");
            app_state.realtime_defer_until = millis() + 15000UL;  // allow OTA + web to stabilize
            logHeapStatus("after supabase auth");
        } else {
            Serial.println("[INIT] Supabase authentication failed - will retry in loop");
            SupabaseAuthError authError = supabaseClient.getLastAuthError();
            if (authError == SupabaseAuthError::InvalidSignature) {
                Serial.println("[SUPABASE] Invalid signature - triggering reprovision");
                provisionDeviceWithSupabase();
            } else if (authError == SupabaseAuthError::ApprovalRequired) {
                app_state.supabase_approval_pending = true;
            } else if (authError == SupabaseAuthError::Disabled) {
                app_state.supabase_disabled = true;
                Serial.println("[SUPABASE] Device disabled by admin");
            } else if (authError == SupabaseAuthError::Blacklisted) {
                app_state.supabase_blacklisted = true;
                Serial.println("[SUPABASE] Device blacklisted by admin");
            } else if (authError == SupabaseAuthError::Deleted) {
                app_state.supabase_deleted = true;
                Serial.println("[SUPABASE] Device deleted - clearing credentials");
                deviceCredentials.resetCredentials();
                delay(200);
                ESP.restart();
            }
        }
    }

    // Supabase is the only hub now. Route remote logs to Supabase when available.
    remoteLogger.begin(app_state.wifi_connected ? &supabaseClient : nullptr);
    if (g_debug_mode) {
        remoteLogger.setRemoteEnabled(true);
    }

    // Initialize xAPI WebSocket if configured
    if (config_manager.hasXAPIDevice()) {
        Serial.println("[INIT] Connecting to RoomOS device...");
        xapi_websocket.begin(&config_manager);
    }

    // Initialize MQTT for Meraki sensors
    if (config_manager.hasMQTTConfig()) {
        Serial.println("[INIT] Connecting to MQTT broker...");
        mqtt_client.begin(&config_manager);
    }

    // Initialize OTA manager
    Serial.println("[INIT] Initializing OTA manager...");
    String ota_url = config_manager.getOTAUrl();
    ota_manager.begin(ota_url, FIRMWARE_VERSION);

    // Enable manifest mode for non-GitHub API URLs (e.g., display.5ls.us)
    if (!ota_url.isEmpty() && ota_url.indexOf("api.github.com") < 0) {
        ota_manager.setManifestUrl(ota_url);
    }

    // Initialize serial command handler (for web installer WiFi setup)
    Serial.println("[INIT] Initializing serial command handler...");
    serial_commands_begin();

    Serial.println("[INIT] Setup complete!");
    Serial.println();

    // Mark boot as successful - this cancels OTA rollback
    // Only do this after all critical initialization succeeded
    boot_validator.markBootSuccessful();

    if (app_state.wifi_connected) {
        String hostname = mdns_manager.getHostname();
        matrix_display.showUnconfigured(WiFi.localIP().toString(), hostname);
        Serial.printf("[INIT] Device ready at http://%s or http://%s.local\n",
                      WiFi.localIP().toString().c_str(), hostname.c_str());
    }
}

/**
 * @brief Arduino main loop
 */
void loop() {
    unsigned long current_time = millis();
    static HeapTrendMonitor heap_trend;
    static uint32_t last_min_heap_logged = 0;
    uint32_t min_heap = ESP.getMinFreeHeap();
    if (last_min_heap_logged == 0 || min_heap < last_min_heap_logged) {
        last_min_heap_logged = min_heap;
        logHeapStatus("min_free_heap");
    }
    handleLowHeapRecovery(current_time);
    heap_trend.sample(current_time);
    heap_trend.logIfTrending(current_time);

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

        // Wait for connection with timeout
        unsigned long start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
            delay(500);
            Serial.print(".");
        }
        Serial.println();

        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
            app_state.wifi_connected = true;

            // Disable provisioning AP now that we're connected
            wifi_manager.disableAP();

            // Start mDNS
            mdns_manager.begin(config_manager.getDeviceName());
            mdns_manager.advertiseHTTP(80);

            // Sync time
            setup_time();

            matrix_display.showUnconfigured(WiFi.localIP().toString(), mdns_manager.getHostname());
        } else {
            Serial.println("[WIFI] Connection failed!");
            app_state.wifi_connected = false;
        }
    }

    // Handle WiFi connection
    wifi_manager.handleConnection(&mdns_manager);

    // Track WiFi state transitions to trigger OTA check on reconnect
    static bool was_wifi_connected = false;
    if (app_state.wifi_connected && !was_wifi_connected) {
        // WiFi just connected (either first time or after disconnect)
        // Defer OTA checks to keep startup responsive.
        app_state.last_ota_check = millis();
    }
    was_wifi_connected = app_state.wifi_connected;

    // Refresh mDNS periodically to prevent TTL expiry
    if (app_state.wifi_connected) {
        mdns_manager.refresh();
    }

    // Ensure mDNS stays active even if the responder stalls
    if (app_state.wifi_connected) {
        static unsigned long last_mdns_check = 0;
        if (millis() - last_mdns_check >= 5000) {
            last_mdns_check = millis();
            if (!mdns_manager.isInitialized()) {
                Serial.println("[MDNS] mDNS not running, restarting...");
                mdns_manager.end();
                if (mdns_manager.begin(config_manager.getDeviceName())) {
                    mdns_manager.advertiseHTTP(80);
                }
            }
        }
    }

    // Handle NTP time sync after reconnect
    if (app_state.wifi_connected && !app_state.time_synced) {
        setup_time();
    }

    // Process web server requests
    web_server.loop();

    // Check for pending reboot from web server
    if (web_server.checkPendingReboot()) {
        return;  // Won't actually return, device will restart
    }

    // Complete OAuth flow if callback was received
    if (web_server.hasPendingOAuthCode()) {
        String code = web_server.consumePendingOAuthCode();
        String redirect_uri = web_server.getPendingOAuthRedirectUri();
        bool auth_ok = webex_client.handleOAuthCallback(code, redirect_uri);
        app_state.webex_authenticated = auth_ok;
        web_server.clearPendingOAuth();
        Serial.printf("[WEBEX] OAuth exchange %s\n", auth_ok ? "successful" : "failed");
    }

    // Supabase updates embedded app status; no bridge state to maintain.

    // =========================================================================
    // Supabase Phase A: State sync via Edge Functions (replaces bridge for pairing)
    // =========================================================================
    if (app_state.wifi_connected && supabaseClient.isInitialized()) {
        syncManager.loop(current_time);
        realtimeManager.loop(current_time);
        commandProcessor.processPendingAcks();
        commandProcessor.processPendingActions();
        // Keep remote logger in sync with server-side debug toggle
        remoteLogger.setRemoteEnabled(supabaseClient.isRemoteDebugEnabled());
    }
    
    // =========================================================================
    // Supabase Phase B: Realtime WebSocket for instant command delivery
    // =========================================================================
    {
        // Handle realtime resubscribe request
        if (app_state.supabase_realtime_resubscribe) {
            app_state.supabase_realtime_resubscribe = false;
            realtimeManager.reconnect();
        }

        // Realtime connection management and event processing
        realtimeManager.loop(current_time);
    }

    // Process xAPI WebSocket
    if (xapi_websocket.isConnected()) {
        xapi_websocket.loop();

        // Check for device status updates
        if (xapi_websocket.hasUpdate()) {
            XAPIUpdate update = xapi_websocket.getUpdate();
            app_state.camera_on = update.camera_on;
            app_state.mic_muted = update.mic_muted;
            app_state.in_call = update.in_call;
            app_state.xapi_connected = true;
        }
    }

    // Poll Webex API as fallback when Supabase/app status is unavailable or stale
    // Conditions for fallback polling:
    // 1. Embedded app not connected, OR
    // 2. Supabase sync is stale (no update in 60+ seconds)
    const unsigned long SUPABASE_STALE_THRESHOLD = 60000UL;  // 60 seconds
    bool supabase_status_stale = (app_state.last_supabase_sync > 0) &&
                                 (current_time - app_state.last_supabase_sync > SUPABASE_STALE_THRESHOLD);
    bool need_api_fallback = !app_state.embedded_app_connected &&
                             (supabase_status_stale || !app_state.webex_status_received);

    if (need_api_fallback && (supabaseClient.isAuthenticated() || app_state.webex_authenticated)) {
        unsigned long poll_interval = config_manager.getWebexPollInterval() * 1000UL;

        if (current_time - app_state.last_poll_time >= poll_interval) {
            app_state.last_poll_time = current_time;

            // Log why we're polling (for debugging)
            if (supabase_status_stale) {
                Serial.println("[WEBEX] Supabase status stale, polling cloud status");
            } else if (!app_state.embedded_app_connected) {
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
                        app_state.webex_status = cloud_status;
                        app_state.webex_status_received = true;
                        app_state.webex_status_source = "cloud";
                        Serial.printf("[WEBEX] Cloud status: %s\n", cloud_status.c_str());
                    }
                }
            }

            if (!cloud_synced) {
                if (app_state.embedded_app_connected) {
                    return;
                }
                if (supabaseClient.isWebexTokenMissing() && app_state.wifi_connected) {
                    Serial.println("[WEBEX] No Webex token; skipping local fallback");
                    return;
                }
                if (!app_state.webex_authenticated) {
                    static unsigned long last_local_skip_log = 0;
                    unsigned long now = millis();
                    if (now - last_local_skip_log > 60000) {
                        last_local_skip_log = now;
                        Serial.println("[WEBEX] Local API auth unavailable; skipping local fallback");
                    }
                    return;
                }
                Serial.println("[WEBEX] Cloud status failed, polling local API");
                WebexPresence presence;
                if (webex_client.getPresence(presence)) {
                    app_state.webex_status = presence.status;
                    app_state.webex_status_received = true;
                    app_state.webex_status_source = "local";

                    // Auto-populate display name with firstName if not already set
                    if (config_manager.getDisplayName().isEmpty() && !presence.first_name.isEmpty()) {
                        config_manager.setDisplayName(presence.first_name);
                        Serial.printf("[WEBEX] Auto-populated display name: %s\n", presence.first_name.c_str());
                    }

                    // Derive in_call from status if not connected to xAPI
                    if (!app_state.xapi_connected) {
                        app_state.in_call = (presence.status == "meeting" || presence.status == "busy" ||
                                             presence.status == "call" || presence.status == "presenting");
                    }

                    JsonDocument payload;
                    payload["webex_status"] = presence.status;
                    if (!presence.display_name.isEmpty()) {
                        payload["display_name"] = presence.display_name;
                    } else if (!presence.first_name.isEmpty()) {
                        payload["display_name"] = presence.first_name;
                    }
                    payload["camera_on"] = app_state.camera_on;
                    payload["mic_muted"] = app_state.mic_muted;
                    payload["in_call"] = app_state.in_call;

                    String body;
                    serializeJson(payload, body);

                    String ignored;
                    supabaseClient.syncWebexStatus(ignored, body);
                }
            }
        }
    }

    // Process MQTT
    if (app_state.wifi_connected && config_manager.hasMQTTConfig()) {
        if (!mqtt_client.isInitialized()) {
            mqtt_client.begin(&config_manager);
        }

        mqtt_client.loop();
        app_state.mqtt_connected = mqtt_client.isConnected();
        if (!app_state.mqtt_connected) {
            app_state.sensor_data_valid = false;
        }

        // Check for sensor updates
        static String last_display_sensor;
        const String configured_display_sensor = config_manager.getDisplaySensorMac();
        const bool update_available = mqtt_client.hasUpdate();

        if (update_available) {
            MerakiSensorData latest = mqtt_client.getLatestData();
            if (configured_display_sensor.isEmpty()) {
                app_state.temperature = latest.temperature;
                app_state.humidity = latest.humidity;
                app_state.door_status = latest.door_status;
                app_state.air_quality_index = latest.air_quality_index;
                app_state.tvoc = latest.tvoc;
                app_state.co2_ppm = latest.co2_ppm;
                app_state.pm2_5 = latest.pm2_5;
                app_state.ambient_noise = latest.ambient_noise;
                app_state.sensor_mac = latest.sensor_mac;
                last_display_sensor = latest.sensor_mac;
                app_state.sensor_data_valid = latest.valid;
                app_state.last_sensor_update = millis();
            }
        }

        if (!configured_display_sensor.isEmpty() &&
            (update_available || configured_display_sensor != last_display_sensor)) {
            MerakiSensorData selected;
            if (mqtt_client.getSensorData(configured_display_sensor, selected)) {
                app_state.temperature = selected.temperature;
                app_state.humidity = selected.humidity;
                app_state.door_status = selected.door_status;
                app_state.air_quality_index = selected.air_quality_index;
                app_state.tvoc = selected.tvoc;
                app_state.co2_ppm = selected.co2_ppm;
                app_state.pm2_5 = selected.pm2_5;
                app_state.ambient_noise = selected.ambient_noise;
                app_state.sensor_mac = configured_display_sensor;
                last_display_sensor = configured_display_sensor;
                app_state.sensor_data_valid = selected.valid;
                app_state.last_sensor_update = millis();
            }
        }
    } else {
        app_state.mqtt_connected = false;
        app_state.sensor_data_valid = false;
    }

    // Attempt Supabase provisioning (retry until successful)
    if (app_state.wifi_connected) {
        provisionDeviceWithSupabase();
    }

    // Check for OTA updates (hourly)
    if (current_time - app_state.last_ota_check >= 3600000UL) {
        app_state.last_ota_check = current_time;
        check_for_updates();
    }

    // Print connection info every 15 seconds (visible on serial connect)
    static unsigned long last_connection_print = 0;
    if (current_time - last_connection_print >= 15000) {
        last_connection_print = current_time;
        if (app_state.wifi_connected) {
            // Determine status source for logging
            const char* status_source = app_state.webex_status_source.isEmpty()
                ? (app_state.embedded_app_connected ? "embedded_app" : "unknown")
                : app_state.webex_status_source.c_str();

            Serial.println();
            Serial.println("=== WEBEX STATUS DISPLAY ===");
            Serial.printf("IP: %s | mDNS: %s.local\n",
                          WiFi.localIP().toString().c_str(),
                          mdns_manager.getHostname().c_str());
            Serial.printf("Status: %s (via %s) | MQTT: %s\n",
                          app_state.webex_status.c_str(),
                          status_source,
                          app_state.mqtt_connected ? "Yes" : "No");
            Serial.printf("Supabase: %s | App: %s | Webex Source: %s\n",
                          app_state.supabase_connected ? "Yes" : "No",
                          app_state.embedded_app_connected ? "Yes" : "No",
                          status_source);
            Serial.println("============================");
        }
    }

    // Update display
    update_display();

    // Small delay to prevent watchdog issues
    delay(10);
}

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

/**
 * @brief Setup NTP time synchronization
 */
void setup_time() {
    applyTimeConfig(config_manager, &app_state);
}

/**
 * @brief Register device with Supabase (called on first boot + retries)
 */
bool provisionDeviceWithSupabase() {
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
    if (supabaseClient.isAuthenticated() || app_state.supabase_connected) {
        provisioned = true;
        return true;
    }
    if (!app_state.wifi_connected) {
        return false;
    }
    if (app_state.supabase_disabled || app_state.supabase_blacklisted || app_state.supabase_deleted) {
        return false;
    }
    if (!app_state.time_synced) {
        unsigned long now = millis();
        if (now - last_time_warn > 60000) {
            last_time_warn = now;
            Serial.println("[SUPABASE] Waiting for NTP sync before provisioning");
        }
        return false;
    }
    if (!deviceCredentials.isProvisioned()) {
        Serial.println("[SUPABASE] Credentials not ready - cannot provision");
        return false;
    }
    String supabase_url = config_manager.getSupabaseUrl();
    supabase_url.trim();
    if (supabase_url.isEmpty()) {
        Serial.println("[SUPABASE] No Supabase URL configured");
        return false;
    }
    const unsigned long retry_interval =
        app_state.supabase_approval_pending ? pending_retry_interval_ms : retry_interval_ms;
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
    configureSecureClient(client, 2048, 2048);
    if (config_manager.getTlsVerify()) {
        client.setCACert(CA_CERT_BUNDLE_SUPABASE);
    } else {
        client.setInsecure();
    }

    HTTPClient http;
    http.begin(client, endpoint);
    http.setTimeout(15000);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<512> payload;
    payload["serial_number"] = deviceCredentials.getSerialNumber();
    payload["key_hash"] = deviceCredentials.getKeyHash();
    payload["firmware_version"] = FIRMWARE_VERSION;
    if (WiFi.isConnected()) {
        payload["ip_address"] = WiFi.localIP().toString();
    }
    // Send existing pairing code for migration (preserves user's pairing during HMAC migration)
    String existing_code = pairing_manager.getCode();
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
            app_state.supabase_approval_pending = true;
            unsigned long now = millis();
            if (now - last_pending_log > 60000) {
                last_pending_log = now;
                Serial.println("[SUPABASE] Provisioning pending admin approval");
            }
        } else if (http_code == 403 && response.indexOf("device_disabled") >= 0) {
            app_state.supabase_disabled = true;
            Serial.println("[SUPABASE] Device disabled by admin");
        } else if (http_code == 403 && response.indexOf("device_blacklisted") >= 0) {
            app_state.supabase_blacklisted = true;
            Serial.println("[SUPABASE] Device blacklisted by admin");
        } else if (http_code == 410 && response.indexOf("device_deleted") >= 0) {
            app_state.supabase_deleted = true;
            Serial.println("[SUPABASE] Device deleted - clearing credentials");
            deviceCredentials.resetCredentials();
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
        pairing_manager.setCode(pairing_code, true);
        supabaseClient.setPairingCode(pairing_code);
        app_state.supabase_realtime_resubscribe = true;
        Serial.printf("[SUPABASE] Pairing code set to %s\n", pairing_code.c_str());
    }

    provisioned = true;
    app_state.supabase_approval_pending = false;
    app_state.supabase_disabled = false;
    app_state.supabase_blacklisted = false;
    app_state.supabase_deleted = false;
    Serial.println("[SUPABASE] Device provisioned successfully");

    // Immediately authenticate after provisioning so realtime can initialize
    if (supabaseClient.authenticate()) {
        app_state.supabase_connected = true;
        String authAnonKey = supabaseClient.getAnonKey();
        if (!authAnonKey.isEmpty() && authAnonKey != config_manager.getSupabaseAnonKey()) {
            config_manager.setSupabaseAnonKey(authAnonKey);
            Serial.println("[SUPABASE] Anon key updated from device-auth");
        }
        
        // Immediately update device_connected so embedded app knows device is online
        if (hasSafeTlsHeap(65000, 40000)) {
            Serial.println("[SUPABASE] Sending initial device state after provisioning...");
            int rssi = WiFi.RSSI();
            uint32_t freeHeap = ESP.getFreeHeap();
            uint32_t uptime = millis() / 1000;
            float temp = app_state.temperature;
            SupabaseAppState appState = supabaseClient.postDeviceState(rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);
            if (appState.valid) {
                DeviceInfo::applyAppState(appState);
            }
        }
        
        app_state.realtime_defer_until = millis() + 8000UL;
        Serial.println("[SUPABASE] Authenticated after provisioning");
    } else {
        app_state.supabase_connected = false;
        Serial.println("[SUPABASE] Authentication failed after provisioning");
    }
    return true;
}

/**
 * @brief Check for firmware updates
 */
void check_for_updates() {
    Serial.println("[OTA] Checking for updates...");
    bool realtime_was_active = supabaseRealtime.isConnected() || supabaseRealtime.isConnecting();
    if (realtime_was_active) {
        Serial.println("[OTA] Pausing realtime during OTA check");
        supabaseRealtime.disconnect();
        app_state.realtime_defer_until = millis() + 15000UL;
    }

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

/**
 * @brief Build JSON string with current device status
 */

/**
 * @brief Build JSON string with telemetry-only fields
 */

/**
 * @brief Build JSON string with current device config
 */

/**
 * @brief Sync device state with Supabase Edge Functions
 *
 * Phase A implementation: HTTP polling for state sync.
 * - Posts device telemetry to Supabase
 * - Receives app status back
 * - Polls for pending commands
 * - Executes and acknowledges commands
 */

/**
 * @brief Handle commands received from Supabase
 */
void handleSupabaseCommand(const SupabaseCommand& cmd) {
    Serial.printf("[CMD-SB] Processing command: %s\n", cmd.command.c_str());
    
    bool success = true;
    String response = "";
    String error = "";
    
    if (cmd.command == "get_status") {
        response = DeviceInfo::buildStatusJson();
        
    } else if (cmd.command == "get_telemetry") {
        int rssi = WiFi.RSSI();
        uint32_t freeHeap = ESP.getFreeHeap();
        uint32_t uptime = millis() / 1000;
        float temp = app_state.temperature;
        if (!hasSafeTlsHeap(65000, 40000)) {
            success = false;
            error = "low_heap";
        } else {
            SupabaseAppState appState = supabaseClient.postDeviceState(
                rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);
            if (!appState.valid) {
                success = false;
                error = "get_telemetry failed";
            } else {
                DeviceInfo::applyAppState(appState);
                response = DeviceInfo::buildTelemetryJson();
            }
        }

    } else if (cmd.command == "get_troubleshooting_status") {
        response = DeviceInfo::buildStatusJson();

    } else if (cmd.command == "get_config") {
        response = DeviceInfo::buildConfigJson();
        
    } else if (cmd.command == "set_config") {
        JsonDocument doc;
        DeserializationError parseError = deserializeJson(doc, cmd.payload);
        
        if (parseError) {
            success = false;
            error = "Invalid JSON";
        } else {
            // Apply settings
            if (doc["display_name"].is<const char*>()) {
                config_manager.setDisplayName(doc["display_name"].as<String>());
            }
            if (doc["brightness"].is<int>()) {
                uint8_t brightness = doc["brightness"].as<uint8_t>();
                config_manager.setBrightness(brightness);
                matrix_display.setBrightness(brightness);
            }
            if (doc["scroll_speed_ms"].is<int>()) {
                uint16_t speed = doc["scroll_speed_ms"].as<uint16_t>();
                config_manager.setScrollSpeedMs(speed);
                matrix_display.setScrollSpeedMs(speed);
            }
            if (doc["page_interval_ms"].is<int>()) {
                uint16_t interval = doc["page_interval_ms"].as<uint16_t>();
                config_manager.setPageIntervalMs(interval);
                matrix_display.setPageIntervalMs(config_manager.getPageIntervalMs());
            }
            if (doc["sensor_page_enabled"].is<bool>()) {
                config_manager.setSensorPageEnabled(doc["sensor_page_enabled"].as<bool>());
            }
            if (doc["display_pages"].is<const char*>()) {
                config_manager.setDisplayPages(doc["display_pages"].as<const char*>());
            }
            if (doc["status_layout"].is<const char*>()) {
                config_manager.setStatusLayout(doc["status_layout"].as<const char*>());
            }
            if (doc["date_color"].is<const char*>()) {
                config_manager.setDateColor(doc["date_color"].as<String>());
            }
            if (doc["time_color"].is<const char*>()) {
                config_manager.setTimeColor(doc["time_color"].as<String>());
            }
            if (doc["name_color"].is<const char*>()) {
                config_manager.setNameColor(doc["name_color"].as<String>());
            }
            if (doc["metric_color"].is<const char*>()) {
                config_manager.setMetricColor(doc["metric_color"].as<String>());
            }
            if (doc["time_zone"].is<const char*>()) {
                config_manager.setTimeZone(doc["time_zone"].as<String>());
                applyTimeConfig(config_manager, &app_state);
            }
            if (doc["time_format"].is<const char*>()) {
                config_manager.setTimeFormat(doc["time_format"].as<String>());
            }
            if (doc["date_format"].is<const char*>()) {
                config_manager.setDateFormat(doc["date_format"].as<String>());
            }
            if (doc["tls_verify"].is<bool>()) {
                config_manager.setTlsVerify(doc["tls_verify"].as<bool>());
            }
            // Update MQTT config if broker is provided (indicates MQTT update intent)
            if (doc["mqtt_broker"].is<const char*>()) {
                // Get current values as defaults (for fields not provided)
                String currentBroker = config_manager.getMQTTBroker();
                uint16_t currentPort = config_manager.getMQTTPort();
                String currentUsername = config_manager.getMQTTUsername();
                String currentPassword = config_manager.getMQTTPassword();
                String currentTopic = config_manager.getMQTTTopic();
                
                // Update only provided fields, keep current values for others
                String broker = doc["mqtt_broker"].as<String>();
                // Port: use provided value if present, otherwise keep current
                uint16_t port = doc["mqtt_port"].is<int>() ? doc["mqtt_port"].as<uint16_t>() : currentPort;
                // Username: use provided value if present (even if empty), otherwise keep current
                String username = doc["mqtt_username"].is<const char*>() ? doc["mqtt_username"].as<String>() : currentUsername;
                // Password: only update if explicitly provided
                String password = doc["mqtt_password"].is<const char*>() ? doc["mqtt_password"].as<String>() : currentPassword;
                bool updatePassword = doc["mqtt_password"].is<const char*>();
                // Topic: use provided value if present, otherwise keep current
                String topic = doc["mqtt_topic"].is<const char*>() ? doc["mqtt_topic"].as<String>() : currentTopic;
                
                config_manager.updateMQTTConfig(broker, port, username, password, updatePassword, topic);
                Serial.println("[CMD-SB] MQTT config updated");
                mqtt_client.invalidateConfig();  // Reconnect with new MQTT settings
            }
            if (doc["display_sensor_mac"].is<const char*>()) {
                config_manager.setDisplaySensorMac(doc["display_sensor_mac"].as<String>());
            }
            if (doc["display_metric"].is<const char*>()) {
                config_manager.setDisplayMetric(doc["display_metric"].as<String>());
            }
            if (doc["sensor_macs"].is<const char*>()) {
                config_manager.setSensorMacs(doc["sensor_macs"].as<String>());
            } else if (doc["sensor_serial"].is<const char*>()) {
                config_manager.setSensorSerial(doc["sensor_serial"].as<String>());
            }
            if (doc["poll_interval"].is<int>()) {
                config_manager.setWebexPollInterval(doc["poll_interval"].as<uint16_t>());
            }
            
            response = DeviceInfo::buildConfigJson();
            Serial.println("[CMD-SB] Config updated");
        }
        
    } else if (cmd.command == "set_brightness") {
        JsonDocument doc;
        deserializeJson(doc, cmd.payload);
        uint8_t brightness = doc["value"] | 128;
        config_manager.setBrightness(brightness);
        matrix_display.setBrightness(brightness);
        
    } else if (cmd.command == "regenerate_pairing") {
        String newCode = pairing_manager.generateCode(true);
        supabaseClient.setPairingCode(newCode);  // Update Supabase client
        app_state.supabase_realtime_resubscribe = true;
        JsonDocument resp;
        resp["code"] = newCode;
        serializeJson(resp, response);

    } else if (cmd.command == "set_remote_debug") {
        JsonDocument doc;
        deserializeJson(doc, cmd.payload);
        bool enabled = doc["enabled"] | false;
        supabaseClient.setRemoteDebugEnabled(enabled);
        remoteLogger.setRemoteEnabled(enabled);
        JsonDocument resp;
        resp["enabled"] = enabled;
        serializeJson(resp, response);
        
    } else if (cmd.command == "reboot") {
        commandProcessor.queuePendingAction(PendingCommandAction::Reboot, cmd.id);
        return;
        
    } else if (cmd.command == "factory_reset") {
        commandProcessor.queuePendingAction(PendingCommandAction::FactoryReset, cmd.id);
        return;
        
    } else {
        success = false;
        error = "Unknown command: " + cmd.command;
    }
    
    // Send acknowledgment
    const bool ackQueued = commandProcessor.sendOrQueueAck(cmd.id, success, response, error);
    if (ackQueued) {
        commandProcessor.markProcessed(cmd.id);
    }
}

/**
 * @brief Initialize Supabase Realtime for Phase B (optional, low-latency commands)
 *
 * Phase B provides real-time command delivery via WebSocket instead of polling.
 * This reduces latency and server load but requires the Supabase anon key.
 */

/**
 * @brief Initialize Supabase Realtime for device updates (admin debug toggle)
 */

/**
 * @brief Handle realtime messages from Supabase
 *
 * Called when a postgres_changes event is received via WebSocket.
 * For INSERT events on the commands table, immediately process the command.
 */
void handleRealtimeMessage(const RealtimeMessage& msg) {
    if (!msg.valid) {
        return;
    }
    
    Serial.printf("[REALTIME] Received %s on %s.%s\n", 
                  msg.event.c_str(), msg.schema.c_str(), msg.table.c_str());

    // Handle broadcast events (pairing channels)
    if (msg.event == "broadcast") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject broadcast = payload["payload"];
        if (broadcast.isNull()) {
            Serial.println("[REALTIME] Broadcast payload missing");
            return;
        }

        String broadcastEvent = broadcast["event"] | "";
        JsonVariant inner = broadcast["payload"];
        JsonObject data = inner.is<JsonObject>() ? inner.as<JsonObject>() : broadcast;

        if (data.isNull()) {
            Serial.println("[REALTIME] Broadcast data missing");
            return;
        }

        String table = data["table"] | "";
        String operation = data["operation"] | "";
        JsonObject record = data["record"];

        Serial.printf("[REALTIME] Broadcast %s table=%s op=%s\n",
                      broadcastEvent.c_str(),
                      table.c_str(),
                      operation.c_str());

        if (table == "commands" && operation == "INSERT") {
            if (record.isNull()) {
                Serial.println("[REALTIME] Broadcast command missing record");
                return;
            }

            SupabaseCommand cmd;
            cmd.valid = true;
            cmd.id = record["id"].as<String>();
            cmd.command = record["command"].as<String>();
            cmd.created_at = record["created_at"].as<String>();

            JsonObject cmdPayload = record["payload"];
            if (!cmdPayload.isNull()) {
                serializeJson(cmdPayload, cmd.payload);
            } else {
                cmd.payload = "{}";
            }

            if (commandProcessor.wasRecentlyProcessed(cmd.id)) {
                Serial.printf("[REALTIME] Duplicate command ignored: %s\n", cmd.id.c_str());
                return;
            }

            String status = record["status"].as<String>();
            if (status != "pending") {
                Serial.printf("[REALTIME] Command %s already %s, skipping\n",
                              cmd.id.c_str(), status.c_str());
                return;
            }

            Serial.printf("[REALTIME] Processing command via broadcast: %s (id=%s)\n",
                          cmd.command.c_str(), cmd.id.c_str());
            handleSupabaseCommand(cmd);
        }

        if (table == "pairings" && operation == "UPDATE") {
            if (record.isNull()) {
                Serial.println("[REALTIME] Broadcast pairing missing record");
                return;
            }

            // Extract new values
            bool newAppConnected = record["app_connected"] | false;
            String newWebexStatus = record["webex_status"] | "offline";
            String newDisplayName = record["display_name"] | "";
            bool newCameraOn = record["camera_on"] | false;
            bool newMicMuted = record["mic_muted"] | false;
            bool newInCall = record["in_call"] | false;

            // Check if any STATUS-RELEVANT fields actually changed
            bool statusChanged = false;
            
            if (newAppConnected != app_state.embedded_app_connected ||
                newWebexStatus != app_state.webex_status ||
                (!newDisplayName.isEmpty() && newDisplayName != app_state.embedded_app_display_name)) {
                statusChanged = true;
            }
            
            if (!app_state.xapi_connected) {
                if (newCameraOn != app_state.camera_on ||
                    newMicMuted != app_state.mic_muted ||
                    newInCall != app_state.in_call) {
                    statusChanged = true;
                }
            }
            
            // Ignore heartbeat-only updates
            if (!statusChanged) {
                app_state.last_supabase_sync = millis();
                if (g_debug_mode && config_manager.getPairingRealtimeDebug()) {
                    Serial.println("[REALTIME] Broadcast pairing update ignored (no status change)");
                }
                return;
            }

            // Apply changes
            app_state.supabase_app_connected = newAppConnected;
            app_state.embedded_app_connected = newAppConnected;
            if (newAppConnected) {
                app_state.webex_status = newWebexStatus;
                app_state.webex_status_received = true;
                app_state.webex_status_source = "embedded_app";
                if (!newDisplayName.isEmpty()) {
                    app_state.embedded_app_display_name = newDisplayName;
                }
                if (!app_state.xapi_connected) {
                    app_state.camera_on = newCameraOn;
                    app_state.mic_muted = newMicMuted;
                    app_state.in_call = newInCall;
                }
            }

            app_state.last_supabase_sync = millis();
            Serial.printf("[REALTIME] Pairing status changed (broadcast) - app=%s, status=%s\n",
                          newAppConnected ? "connected" : "disconnected",
                          newWebexStatus.c_str());
        }
        return;
    }
    
    // Handle command insertions (immediate command delivery)
    if (msg.table == "commands" && msg.event == "INSERT") {
        // Extract command data from payload
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject data = payload["data"]["record"];
        
        if (data.isNull()) {
            Serial.println("[REALTIME] No record in command payload");
            return;
        }
        
        // Build SupabaseCommand from realtime data
        SupabaseCommand cmd;
        cmd.valid = true;
        cmd.id = data["id"].as<String>();
        cmd.command = data["command"].as<String>();
        cmd.created_at = data["created_at"].as<String>();

        if (commandProcessor.wasRecentlyProcessed(cmd.id)) {
            Serial.printf("[REALTIME] Duplicate command ignored: %s\n", cmd.id.c_str());
            return;
        }
        
        // Serialize payload to string
        JsonObject cmdPayload = data["payload"];
        if (!cmdPayload.isNull()) {
            serializeJson(cmdPayload, cmd.payload);
        } else {
            cmd.payload = "{}";
        }
        
        // Verify this command is pending (not already processed via polling)
        String status = data["status"].as<String>();
        if (status != "pending") {
            Serial.printf("[REALTIME] Command %s already %s, skipping\n", 
                          cmd.id.c_str(), status.c_str());
            return;
        }
        
        Serial.printf("[REALTIME] Processing command via realtime: %s (id=%s)\n",
                      cmd.command.c_str(), cmd.id.c_str());
        
        // Handle the command (same handler as polling)
        handleSupabaseCommand(cmd);
    }
    
    // Handle pairing updates (app connection state changes)
    if (msg.table == "pairings" && msg.event == "UPDATE") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject data = payload["data"]["record"];
        
        if (!data.isNull()) {
            // Extract new values from realtime message
            bool newAppConnected = data["app_connected"] | false;
            String newWebexStatus = data["webex_status"] | "offline";
            String newDisplayName = data["display_name"] | "";
            bool newCameraOn = data["camera_on"] | false;
            bool newMicMuted = data["mic_muted"] | false;
            bool newInCall = data["in_call"] | false;
            
            // Check if any STATUS-RELEVANT fields actually changed
            // (ignore heartbeat-only updates that only change app_last_seen/device_last_seen)
            bool statusChanged = false;
            
            // Check connection state changes
            if (newAppConnected != app_state.embedded_app_connected) {
                statusChanged = true;
            }
            
            // Check webex status change
            if (newWebexStatus != app_state.webex_status) {
                statusChanged = true;
            }
            
            // Check display name change (only if non-empty)
            if (!newDisplayName.isEmpty() && newDisplayName != app_state.embedded_app_display_name) {
                statusChanged = true;
            }
            
            // Check camera/mic/call state changes (only if not using xAPI)
            if (!app_state.xapi_connected) {
                if (newCameraOn != app_state.camera_on ||
                    newMicMuted != app_state.mic_muted ||
                    newInCall != app_state.in_call) {
                    statusChanged = true;
                }
            }
            
            // Only process and log if something actually changed
            if (!statusChanged) {
                app_state.last_supabase_sync = millis();
                // Heartbeat-only update - silently ignore
                if (g_debug_mode && config_manager.getPairingRealtimeDebug()) {
                    Serial.println("[REALTIME] Pairing update ignored (no status change - likely heartbeat)");
                }
                return;
            }
            
            // Apply the changes to app state
            app_state.supabase_app_connected = newAppConnected;
            app_state.embedded_app_connected = newAppConnected;
            if (newAppConnected) {
                app_state.webex_status = newWebexStatus;
                app_state.webex_status_received = true;
                app_state.webex_status_source = "embedded_app";
                
                if (!newDisplayName.isEmpty()) {
                    app_state.embedded_app_display_name = newDisplayName;
                }
                
                // Only update camera/mic/call if not using xAPI
                if (!app_state.xapi_connected) {
                    app_state.camera_on = newCameraOn;
                    app_state.mic_muted = newMicMuted;
                    app_state.in_call = newInCall;
                }
            }
            
            app_state.last_supabase_sync = millis();
            Serial.printf("[REALTIME] Pairing status changed - app=%s, status=%s, camera=%s, mic=%s, inCall=%s\n",
                          newAppConnected ? "connected" : "disconnected",
                          newWebexStatus.c_str(),
                          newCameraOn ? "on" : "off",
                          newMicMuted ? "muted" : "unmuted",
                          newInCall ? "yes" : "no");

            if (g_debug_mode && config_manager.getPairingRealtimeDebug()) {
                JsonDocument debugDoc;
                debugDoc["app_connected"] = newAppConnected;
                debugDoc["webex_status"] = newWebexStatus;
                debugDoc["display_name"] = newDisplayName;
                debugDoc["camera_on"] = newCameraOn;
                debugDoc["mic_muted"] = newMicMuted;
                debugDoc["in_call"] = newInCall;
                String debugJson;
                serializeJson(debugDoc, debugJson);
                Serial.printf("[REALTIME][DEBUG] Pairing payload: %s\n", debugJson.c_str());
            }
        }
    }

    // Handle device updates (admin debug toggle)
    // Device realtime handler removed - using single connection now
}

/**
 * @brief Handle realtime device updates from Supabase
 */
