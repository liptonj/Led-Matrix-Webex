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
SupabaseRealtime supabaseRealtimeDevices;
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
void handleRealtimeDeviceMessage(const RealtimeMessage& msg);
void syncWithSupabase();
bool initSupabaseRealtime();
bool initSupabaseRealtimeDevices();
String buildStatusJson();
String buildTelemetryJson();
String buildConfigJson();
bool provisionDeviceWithSupabase();

static void logHeapStatus(const char* label) {
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t minHeap = ESP.getMinFreeHeap();
    uint32_t largestBlock = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    Serial.printf("[HEAP] %s free=%u min=%u largest=%u\n",
                  label, freeHeap, minHeap, largestBlock);
}

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
            // Show IP only for now - hostname shown after mDNS init
            matrix_display.showConnected(WiFi.localIP().toString(), "");
            delay(2000);  // Show connected screen briefly
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

    // Perform immediate OTA check when WiFi is connected
    // This fixes the issue where the first OTA check was delayed by 1 hour after boot
    // because last_ota_check starts at 0 and millis() takes an hour to exceed the threshold
    if (app_state.wifi_connected) {
        Serial.println("[OTA] Performing immediate update check on boot...");
        check_for_updates();
        app_state.last_ota_check = millis();  // Reset timer after check
        logHeapStatus("after ota check");

        unsigned long deferUntil = millis() + 8000UL;  // short post-OTA cooldown
        if (app_state.realtime_defer_until < deferUntil) {
            app_state.realtime_defer_until = deferUntil;
        }
    }

    // Initialize serial command handler (for web installer WiFi setup)
    Serial.println("[INIT] Initializing serial command handler...");
    serial_commands_begin();

    Serial.println("[INIT] Setup complete!");
    Serial.println();

    // Mark boot as successful - this cancels OTA rollback
    // Only do this after all critical initialization succeeded
    boot_validator.markBootSuccessful();

    // Show connection info briefly on display
    if (app_state.wifi_connected) {
        String hostname = mdns_manager.getHostname();
        matrix_display.showConnected(WiFi.localIP().toString(), hostname);
        delay(3000);  // Show for 3 seconds
        Serial.printf("[INIT] Device ready at http://%s or http://%s.local\n",
                      WiFi.localIP().toString().c_str(), hostname.c_str());
    }
}

/**
 * @brief Arduino main loop
 */
void loop() {
    unsigned long current_time = millis();
    static uint32_t last_min_heap_logged = 0;
    uint32_t min_heap = ESP.getMinFreeHeap();
    if (last_min_heap_logged == 0 || min_heap < last_min_heap_logged) {
        last_min_heap_logged = min_heap;
        logHeapStatus("min_free_heap");
    }

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

            matrix_display.showConnected(WiFi.localIP().toString(), mdns_manager.getHostname());
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
        // Trigger immediate OTA check so we don't wait 1 hour after reconnect
        Serial.println("[OTA] WiFi connected - checking for updates...");
        check_for_updates();
        app_state.last_ota_check = millis();  // Reset timer after check
        logHeapStatus("after ota check (reconnect)");

        unsigned long deferUntil = millis() + 8000UL;
        if (app_state.realtime_defer_until < deferUntil) {
            app_state.realtime_defer_until = deferUntil;
        }
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
        syncWithSupabase();
        // Keep remote logger in sync with server-side debug toggle
        remoteLogger.setRemoteEnabled(supabaseClient.isRemoteDebugEnabled());
    }
    
    // =========================================================================
    // Supabase Phase B: Realtime WebSocket for instant command delivery
    // =========================================================================
    {
        static unsigned long lastRealtimeInit = 0;
        String anonKey = config_manager.getSupabaseAnonKey();
        
        if (app_state.supabase_realtime_resubscribe) {
            app_state.supabase_realtime_resubscribe = false;
            supabaseRealtime.disconnect();
            initSupabaseRealtime();
        }

        // Try to initialize realtime if we have credentials but aren't connected
        if (app_state.wifi_connected && app_state.supabase_connected && 
            !anonKey.isEmpty() && !supabaseRealtime.isConnected()) {
            if (current_time < app_state.realtime_defer_until) {
                static bool defer_logged = false;
                if (!defer_logged) {
                    Serial.println("[REALTIME] Deferring realtime init until boot settles");
                    defer_logged = true;
                }
            } else {
                unsigned long interval = supabaseRealtime.hasEverConnected() ? 60000UL : 15000UL;
                if (millis() - lastRealtimeInit > interval) {
                    if (!supabaseClient.isRequestInFlight()) {
                        lastRealtimeInit = millis();
                        Serial.println("[REALTIME] Attempting to reconnect...");
                        initSupabaseRealtime();
                    } else {
                        static unsigned long last_skip_log = 0;
                        if (millis() - last_skip_log > 10000) {
                            last_skip_log = millis();
                            Serial.println("[REALTIME] Reconnect skipped (HTTP request in flight)");
                        }
                    }
                }
            }
        }
        
        // Process realtime events if connected
        if (app_state.wifi_connected && supabaseRealtime.isConnected()) {
            supabaseRealtime.loop();
            
            // Process any pending realtime messages
            if (supabaseRealtime.hasMessage()) {
                RealtimeMessage msg = supabaseRealtime.getMessage();
                handleRealtimeMessage(msg);
            }
        }
    }

    // =========================================================================
    // Supabase Phase B (devices): Realtime updates for admin debug toggle
    // =========================================================================
    {
        static unsigned long lastDeviceRealtimeInit = 0;
        String anonKey = config_manager.getSupabaseAnonKey();

        if (app_state.wifi_connected && app_state.supabase_connected &&
            !anonKey.isEmpty() && !supabaseRealtimeDevices.isConnected()) {
            if (current_time < app_state.realtime_defer_until) {
                static bool defer_logged = false;
                if (!defer_logged) {
                    Serial.println("[REALTIME] Deferring device realtime init until boot settles");
                    defer_logged = true;
                }
            } else {
                unsigned long interval = supabaseRealtimeDevices.hasEverConnected() ? 60000UL : 20000UL;
                if (millis() - lastDeviceRealtimeInit > interval) {
                    if (!supabaseClient.isRequestInFlight()) {
                        lastDeviceRealtimeInit = millis();
                        Serial.println("[REALTIME] Attempting device realtime reconnect...");
                        initSupabaseRealtimeDevices();
                    }
                }
            }
        }

        if (app_state.wifi_connected && supabaseRealtimeDevices.isConnected()) {
            supabaseRealtimeDevices.loop();

            if (supabaseRealtimeDevices.hasMessage()) {
                RealtimeMessage msg = supabaseRealtimeDevices.getMessage();
                handleRealtimeDeviceMessage(msg);
            }
        }
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
    bool need_api_fallback = !app_state.embedded_app_connected || supabase_status_stale;

    if (need_api_fallback && app_state.webex_authenticated) {
        unsigned long poll_interval = config_manager.getWebexPollInterval() * 1000UL;

        if (current_time - app_state.last_poll_time >= poll_interval) {
            app_state.last_poll_time = current_time;

            // Log why we're polling (for debugging)
            if (supabase_status_stale) {
                Serial.println("[WEBEX] Supabase status stale, polling API directly");
            } else if (!app_state.embedded_app_connected) {
                Serial.println("[WEBEX] Embedded app not connected, polling API directly");
            }

            WebexPresence presence;
            if (webex_client.getPresence(presence)) {
                app_state.webex_status = presence.status;

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
            }
        }
    } else {
        app_state.mqtt_connected = false;
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
            const char* status_source = app_state.embedded_app_connected ? "Supabase/App" : "API";

            Serial.println();
            Serial.println("=== WEBEX STATUS DISPLAY ===");
            Serial.printf("IP: %s | mDNS: %s.local\n",
                          WiFi.localIP().toString().c_str(),
                          mdns_manager.getHostname().c_str());
            Serial.printf("Status: %s (via %s) | MQTT: %s\n",
                          app_state.webex_status.c_str(),
                          status_source,
                          app_state.mqtt_connected ? "Yes" : "No");
            Serial.printf("Supabase: %s | App: %s | API Auth: %s\n",
                          app_state.supabase_connected ? "Yes" : "No",
                          app_state.embedded_app_connected ? "Yes" : "No",
                          app_state.webex_authenticated ? "Yes" : "No");
            Serial.println("============================");
        }
    }

    // Update display
    update_display();

    // Small delay to prevent watchdog issues
    delay(10);
}

/**
 * @brief Update the LED matrix display
 */
void update_display() {
    static unsigned long last_update = 0;

    // Update display at ~30 FPS
    if (millis() - last_update < 33) {
        return;
    }
    last_update = millis();
    matrix_display.setBrightness(config_manager.getBrightness());
    matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());
    matrix_display.setPageIntervalMs(config_manager.getPageIntervalMs());

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
    if (app_state.wifi_connected &&
        !app_state.xapi_connected &&
        !app_state.webex_authenticated &&
        !app_state.mqtt_connected) {
        matrix_display.showUnconfigured(WiFi.localIP().toString());
        return;
    }

    // Build display data
    DisplayData data;
    data.webex_status = app_state.webex_status;
    // Prefer embedded app display name (from Webex SDK), fallback to config, then device name
    if (app_state.embedded_app_connected && !app_state.embedded_app_display_name.isEmpty()) {
        data.display_name = app_state.embedded_app_display_name;
    } else if (!config_manager.getDisplayName().isEmpty()) {
        data.display_name = config_manager.getDisplayName();
    } else {
        // Fallback to device name if no display name is configured
        data.display_name = config_manager.getDeviceName();
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
    data.right_metric = config_manager.getDisplayMetric();
    data.show_sensors = app_state.mqtt_connected;
    data.sensor_page_enabled = config_manager.getSensorPageEnabled();

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
    data.use_24h = config_manager.use24HourTime();
    data.date_format = config_manager.getDateFormatCode();

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
    const unsigned long retry_interval_ms = 60000;  // 60 seconds
    const unsigned long pending_retry_interval_ms = 1800000;  // 30 minutes

    if (provisioned) {
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
    last_attempt = millis();

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

    JsonDocument payload;
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
    return true;
}

/**
 * @brief Check for firmware updates
 */
void check_for_updates() {
    Serial.println("[OTA] Checking for updates...");

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
}

/**
 * @brief Build JSON string with current device status
 */
String buildStatusJson() {
    JsonDocument doc;

    doc["wifi_connected"] = app_state.wifi_connected;
    doc["webex_authenticated"] = app_state.webex_authenticated;
    doc["webex_status"] = app_state.webex_status;
    doc["supabase_approval_pending"] = app_state.supabase_approval_pending;
    doc["supabase_disabled"] = app_state.supabase_disabled;
    doc["supabase_blacklisted"] = app_state.supabase_blacklisted;
    doc["supabase_deleted"] = app_state.supabase_deleted;
    doc["camera_on"] = app_state.camera_on;
    doc["mic_muted"] = app_state.mic_muted;
    doc["in_call"] = app_state.in_call;
    doc["pairing_code"] = pairing_manager.getCode();
    doc["ip_address"] = WiFi.localIP().toString();
    doc["mac_address"] = WiFi.macAddress();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["rssi"] = WiFi.RSSI();

    // Sensor data
    doc["temperature"] = app_state.temperature;
    doc["humidity"] = app_state.humidity;
    doc["door_status"] = app_state.door_status;
    doc["air_quality"] = app_state.air_quality_index;
    doc["tvoc"] = app_state.tvoc;

    String result;
    serializeJson(doc, result);
    return result;
}

/**
 * @brief Build JSON string with telemetry-only fields
 */
String buildTelemetryJson() {
    JsonDocument doc;

    doc["rssi"] = WiFi.RSSI();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["temperature"] = app_state.temperature;
    doc["ssid"] = WiFi.SSID();

    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        doc["ota_partition"] = running->label;
    }

    String result;
    serializeJson(doc, result);
    return result;
}

/**
 * @brief Apply Supabase app state response to local app_state
 */
void applySupabaseAppState(const SupabaseAppState& appState) {
    if (!appState.valid) {
        return;
    }

    app_state.last_supabase_sync = millis();
    app_state.supabase_connected = true;
    app_state.supabase_app_connected = appState.app_connected;

    app_state.embedded_app_connected = appState.app_connected;

    // If Supabase reports app connected, use it as source of truth
    if (appState.app_connected) {
        app_state.webex_status = appState.webex_status;

        if (!appState.display_name.isEmpty()) {
            app_state.embedded_app_display_name = appState.display_name;
        }

        // Only update camera/mic/call state if not using xAPI (more accurate)
        if (!app_state.xapi_connected) {
            app_state.camera_on = appState.camera_on;
            app_state.mic_muted = appState.mic_muted;
            app_state.in_call = appState.in_call;

            // Fallback: derive in_call from status if not explicitly set
            if (!appState.in_call && (appState.webex_status == "meeting" || 
                                       appState.webex_status == "busy" ||
                                       appState.webex_status == "call" || 
                                       appState.webex_status == "presenting")) {
                app_state.in_call = true;
            }
        }
    }
}

/**
 * @brief Build JSON string with current device config
 */
String buildConfigJson() {
    JsonDocument doc;

    doc["device_name"] = config_manager.getDeviceName();
    doc["display_name"] = config_manager.getDisplayName();
    doc["brightness"] = config_manager.getBrightness();
    doc["scroll_speed_ms"] = config_manager.getScrollSpeedMs();
    doc["page_interval_ms"] = config_manager.getPageIntervalMs();
    doc["sensor_page_enabled"] = config_manager.getSensorPageEnabled();
    doc["poll_interval"] = config_manager.getWebexPollInterval();
    doc["time_zone"] = config_manager.getTimeZone();
    doc["time_format"] = config_manager.getTimeFormat();
    doc["date_format"] = config_manager.getDateFormat();
    doc["ntp_server"] = config_manager.getNtpServer();
    doc["has_webex_credentials"] = config_manager.hasWebexCredentials();
    doc["has_webex_tokens"] = config_manager.hasWebexTokens();
    doc["ota_url"] = config_manager.getOTAUrl();
    doc["auto_update"] = config_manager.getAutoUpdate();
    doc["pairing_code"] = pairing_manager.getCode();
    doc["tls_verify"] = config_manager.getTlsVerify();

    String result;
    serializeJson(doc, result);
    return result;
}

/**
 * @brief Sync device state with Supabase Edge Functions
 *
 * Phase A implementation: HTTP polling for state sync.
 * - Posts device telemetry to Supabase
 * - Receives app status back
 * - Polls for pending commands
 * - Executes and acknowledges commands
 */
void syncWithSupabase() {
    static unsigned long lastSync = 0;
    static unsigned long lastCommandPoll = 0;
    static bool retryAuth = false;
    static unsigned long last_time_warn = 0;
    
    unsigned long now = millis();

    if (!app_state.time_synced) {
        if (now - last_time_warn > 60000) {
            last_time_warn = now;
            Serial.println("[SUPABASE] Waiting for NTP sync before contacting server");
        }
        return;
    }

    if (app_state.supabase_approval_pending || app_state.supabase_disabled ||
        app_state.supabase_blacklisted || app_state.supabase_deleted) {
        return;
    }
    
    // Telemetry cadence: every 5 minutes (or on-demand via realtime command)
    const unsigned long syncInterval = 300000;
    const bool realtime_connected = supabaseRealtime.isConnected();
    unsigned long commandPollInterval = realtime_connected ? 0 :
        (app_state.supabase_app_connected ? 5000 : 15000);
    
    // Handle authentication retry
    if (retryAuth && now - lastSync > 60000) {
        if (supabaseClient.authenticate()) {
            app_state.supabase_connected = true;
            retryAuth = false;
            Serial.println("[SUPABASE] Re-authentication successful");

            String authAnonKey = supabaseClient.getAnonKey();
            if (!authAnonKey.isEmpty() && authAnonKey != config_manager.getSupabaseAnonKey()) {
                config_manager.setSupabaseAnonKey(authAnonKey);
                Serial.println("[SUPABASE] Anon key updated from device-auth");
            }
            
            // Update realtime token if realtime is initialized
            String anonKey = config_manager.getSupabaseAnonKey();
            if (!anonKey.isEmpty()) {
                String newToken = supabaseClient.getAccessToken();
                supabaseRealtime.setAccessToken(newToken);
                supabaseRealtimeDevices.setAccessToken(newToken);
                Serial.println("[REALTIME] Token updated after re-authentication");
            }
        } else {
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
            lastSync = now;  // Prevent rapid retry
            return;
        }
    }
    
    // Skip if not authenticated
    if (!supabaseClient.isAuthenticated()) {
        if (!retryAuth) {
            retryAuth = true;
            Serial.println("[SUPABASE] Not authenticated - will retry");
        }
        return;
    }
    
    // Post device state periodically
    if (now - lastSync >= syncInterval) {
        lastSync = now;
        
        // Gather device telemetry
        int rssi = WiFi.RSSI();
        uint32_t freeHeap = ESP.getFreeHeap();
        uint32_t uptime = millis() / 1000;
        float temp = app_state.temperature;  // From sensor if available
        
        // Post state and get app status back (include firmware version)
        SupabaseAppState appState = supabaseClient.postDeviceState(rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);
        if (appState.valid) {
            applySupabaseAppState(appState);
        }
    }
    
    // Poll for commands (can be more frequent than state sync)
    if (commandPollInterval > 0 && now - lastCommandPoll >= commandPollInterval) {
        lastCommandPoll = now;
        
        SupabaseCommand commands[10];
        int count = supabaseClient.pollCommands(commands, 10);
        
        for (int i = 0; i < count; i++) {
            if (commands[i].valid) {
                Serial.printf("[SUPABASE] Processing command: %s (id=%s)\n",
                              commands[i].command.c_str(), commands[i].id.c_str());
                
                // Handle the command
                handleSupabaseCommand(commands[i]);
            }
        }
    }
}

/**
 * @brief Handle commands received from Supabase
 */
void handleSupabaseCommand(const SupabaseCommand& cmd) {
    Serial.printf("[CMD-SB] Processing command: %s\n", cmd.command.c_str());
    
    bool success = true;
    String response = "";
    String error = "";
    
    if (cmd.command == "get_status") {
        response = buildTelemetryJson();
        
    } else if (cmd.command == "get_telemetry") {
        int rssi = WiFi.RSSI();
        uint32_t freeHeap = ESP.getFreeHeap();
        uint32_t uptime = millis() / 1000;
        float temp = app_state.temperature;
        SupabaseAppState appState = supabaseClient.postDeviceState(
            rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);
        if (!appState.valid) {
            success = false;
            error = "get_telemetry failed";
        } else {
            applySupabaseAppState(appState);
            response = buildTelemetryJson();
        }

    } else if (cmd.command == "get_troubleshooting_status") {
        response = buildStatusJson();

    } else if (cmd.command == "get_config") {
        response = buildConfigJson();
        
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
            
            response = buildConfigJson();
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
        // Ack first, then reboot
        supabaseClient.ackCommand(cmd.id, true, "", "");
        delay(500);
        ESP.restart();
        return;  // Won't reach here
        
    } else if (cmd.command == "factory_reset") {
        // Ack first, then reset
        supabaseClient.ackCommand(cmd.id, true, "", "");
        config_manager.factoryReset();
        delay(500);
        ESP.restart();
        return;  // Won't reach here
        
    } else {
        success = false;
        error = "Unknown command: " + cmd.command;
    }
    
    // Send acknowledgment
    supabaseClient.ackCommand(cmd.id, success, response, error);
}

/**
 * @brief Initialize Supabase Realtime for Phase B (optional, low-latency commands)
 *
 * Phase B provides real-time command delivery via WebSocket instead of polling.
 * This reduces latency and server load but requires the Supabase anon key.
 */
bool initSupabaseRealtime() {
    static unsigned long last_realtime_error_log = 0;
    String anonKey = config_manager.getSupabaseAnonKey();
    
    // Skip if anon key not configured (Phase A polling will continue to work)
    if (anonKey.isEmpty()) {
        Serial.println("[REALTIME] Skipping - no anon key configured (Phase A polling active)");
        app_state.realtime_error = "anon_key_missing";
        app_state.last_realtime_error = millis();
        return false;
    }

    if (!app_state.time_synced) {
        Serial.println("[REALTIME] Skipping - time not synced yet");
        app_state.realtime_error = "time_not_synced";
        app_state.last_realtime_error = millis();
        return false;
    }

    const uint32_t min_heap = supabaseRealtime.minHeapRequired();
    if (ESP.getFreeHeap() < min_heap) {
        Serial.printf("[REALTIME] Skipping - low heap (%lu < %lu)\n",
                      ESP.getFreeHeap(), (unsigned long)min_heap);
        logHeapStatus("realtime low heap");
        app_state.realtime_error = "low_heap";
        app_state.last_realtime_error = millis();
        return false;
    }
    
    String supabaseUrl = config_manager.getSupabaseUrl();
    String accessToken = supabaseClient.getAccessToken();
    
    if (supabaseUrl.isEmpty() || accessToken.isEmpty()) {
        Serial.println("[REALTIME] Cannot initialize - missing URL or token");
        app_state.realtime_error = "missing_url_or_token";
        app_state.last_realtime_error = millis();
        return false;
    }
    
    Serial.println("[REALTIME] Initializing Phase B realtime connection...");
    
    // Set message handler for realtime events
    supabaseRealtime.setMessageHandler(handleRealtimeMessage);
    
    // Initialize WebSocket connection
    supabaseRealtime.begin(supabaseUrl, anonKey, accessToken);
    
    // Subscribe to commands for this device's pairing code
    String pairingCode = pairing_manager.getCode();
    if (!pairingCode.isEmpty()) {
        // Wait briefly for connection to establish
        unsigned long waitStart = millis();
        while (!supabaseRealtime.isSocketConnected() && millis() - waitStart < 5000) {
            supabaseRealtime.loop();
            delay(100);
        }
        
        if (supabaseRealtime.isSocketConnected()) {
            // Subscribe to both commands and pairings tables for this device
            String filter = "pairing_code=eq." + pairingCode;
            const String tables[] = { "commands", "pairings" };
            supabaseRealtime.subscribeMultiple("display", tables, 2, filter);
            Serial.printf("[REALTIME] Subscribed to commands + pairings for pairing code: %s\n", 
                          pairingCode.c_str());
            app_state.realtime_error = "";
            return true;
        } else {
            Serial.println("[REALTIME] Connection timeout - will retry");
            app_state.realtime_error = "connection_timeout";
            app_state.last_realtime_error = millis();
            unsigned long now = millis();
            if (now - last_realtime_error_log > 600000) {  // 10 minutes
                last_realtime_error_log = now;
                JsonDocument meta;
                meta["reason"] = "connection_timeout";
                meta["heap"] = ESP.getFreeHeap();
                meta["time"] = (unsigned long)time(nullptr);
                String metaStr;
                serializeJson(meta, metaStr);
                supabaseClient.insertDeviceLog("warn", "realtime_connect_failed", metaStr);
            }
        }
    }
    return supabaseRealtime.isSocketConnected();
}

/**
 * @brief Initialize Supabase Realtime for device updates (admin debug toggle)
 */
bool initSupabaseRealtimeDevices() {
    String anonKey = config_manager.getSupabaseAnonKey();
    if (anonKey.isEmpty()) {
        app_state.realtime_devices_error = "anon_key_missing";
        app_state.last_realtime_devices_error = millis();
        return false;
    }

    if (!app_state.time_synced) {
        app_state.realtime_devices_error = "time_not_synced";
        app_state.last_realtime_devices_error = millis();
        return false;
    }

    const uint32_t min_heap = supabaseRealtimeDevices.minHeapRequired();
    if (ESP.getFreeHeap() < min_heap) {
        app_state.realtime_devices_error = "low_heap";
        app_state.last_realtime_devices_error = millis();
        logHeapStatus("device realtime low heap");
        return false;
    }

    String supabaseUrl = config_manager.getSupabaseUrl();
    String accessToken = supabaseClient.getAccessToken();
    String deviceId = deviceCredentials.getDeviceId();
    deviceId.trim();

    if (supabaseUrl.isEmpty() || accessToken.isEmpty() || deviceId.isEmpty()) {
        app_state.realtime_devices_error = "missing_url_token_or_device_id";
        app_state.last_realtime_devices_error = millis();
        return false;
    }

    Serial.println("[REALTIME] Initializing device realtime connection...");
    supabaseRealtimeDevices.setMessageHandler(handleRealtimeDeviceMessage);
    supabaseRealtimeDevices.begin(supabaseUrl, anonKey, accessToken);

    unsigned long waitStart = millis();
    while (!supabaseRealtimeDevices.isSocketConnected() && millis() - waitStart < 5000) {
        supabaseRealtimeDevices.loop();
        delay(100);
    }

    if (supabaseRealtimeDevices.isSocketConnected()) {
        String filter = "device_id=eq." + deviceId;
        const String tables[] = { "devices" };
        supabaseRealtimeDevices.subscribeMultiple("display", tables, 1, filter);
        Serial.printf("[REALTIME] Subscribed to devices updates for %s\n", deviceId.c_str());
        app_state.realtime_devices_error = "";
        return true;
    } else {
        Serial.println("[REALTIME] Device realtime connection timeout - will retry");
        app_state.realtime_devices_error = "connection_timeout";
        app_state.last_realtime_devices_error = millis();
        return false;
    }
}

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
            // Update app state from pairing record
            bool appConnected = data["app_connected"] | false;
            String webexStatus = data["webex_status"] | "offline";
            String displayName = data["display_name"] | "";
            bool cameraOn = data["camera_on"] | false;
            bool micMuted = data["mic_muted"] | false;
            bool inCall = data["in_call"] | false;
            
            // Update app state
            app_state.supabase_app_connected = appConnected;
            app_state.embedded_app_connected = appConnected;
            if (appConnected) {
                app_state.webex_status = webexStatus;
                
                if (!displayName.isEmpty()) {
                    app_state.embedded_app_display_name = displayName;
                }
                
                // Only update if not using xAPI
                if (!app_state.xapi_connected) {
                    app_state.camera_on = cameraOn;
                    app_state.mic_muted = micMuted;
                    app_state.in_call = inCall;
                }
            }
            
            Serial.printf("[REALTIME] Pairing updated - app=%s, status=%s\n",
                          appConnected ? "connected" : "disconnected",
                          webexStatus.c_str());

            if (g_debug_mode && config_manager.getPairingRealtimeDebug()) {
                JsonDocument debugDoc;
                debugDoc["app_connected"] = appConnected;
                debugDoc["webex_status"] = webexStatus;
                debugDoc["display_name"] = displayName;
                debugDoc["camera_on"] = cameraOn;
                debugDoc["mic_muted"] = micMuted;
                debugDoc["in_call"] = inCall;
                String debugJson;
                serializeJson(debugDoc, debugJson);
                Serial.printf("[REALTIME][DEBUG] Pairing payload: %s\n", debugJson.c_str());
            }
        }
    }
}

/**
 * @brief Handle realtime device updates from Supabase
 */
void handleRealtimeDeviceMessage(const RealtimeMessage& msg) {
    if (!msg.valid) {
        return;
    }

    if (msg.table == "devices" && msg.event == "UPDATE") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject data = payload["data"]["record"];
        if (data.isNull()) {
            return;
        }

        bool debugEnabled = data["debug_enabled"] | false;
        bool previous = supabaseClient.isRemoteDebugEnabled();
        supabaseClient.setRemoteDebugEnabled(debugEnabled);
        remoteLogger.setRemoteEnabled(debugEnabled);

        if (previous != debugEnabled) {
            Serial.printf("[REALTIME] Remote debug %s via devices update\n",
                          debugEnabled ? "ENABLED" : "DISABLED");
        }
    }
}
