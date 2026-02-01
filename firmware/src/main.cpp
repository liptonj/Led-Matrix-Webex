/**
 * @file main.cpp
 * @brief ESP32-S3 Webex Status Display - Main Entry Point
 *
 * Displays Webex presence status, camera/mic state, and Meraki MT sensor
 * data on a 64x32 RGB LED matrix.
 */

// System includes
#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include "esp_task_wdt.h"
#include "esp_ota_ops.h"

// Core components
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
#include "meraki/mqtt_client.h"
#include "ota/ota_manager.h"
#include "time/time_manager.h"
#include "wifi/wifi_manager.h"

// Modular components (extracted from main.cpp)
#include "sync/sync_manager.h"
#include "realtime/realtime_manager.h"
#include "device/device_info.h"
#include "commands/command_processor.h"
#include "loop/loop_handlers.h"

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
bool g_debug_display = false;
bool g_debug_realtime = false;

// Display initialization state (tracked across setup functions)
static bool s_display_ok = false;

// Forward declarations
void setup_time();

// Setup initialization functions (preserve order)
void initSerialAndWatchdog();
void initBootValidator();
void initConfigManager();
void initDebugMode();
void initDeviceCredentials();
void initDisplay();
void initWiFiAndImprov();
void initWebServer();
void initWebexClient();
void initManagers();
void initSupabase();
void initRemoteLogger();
void initIntegrations();
void initOTAManager();
void initSerialCommands();
void finalizeBootAndDisplay();

// Command queue management moved to command_processor module

/**
 * @brief Arduino setup function
 */
void setup() {
    initSerialAndWatchdog();
    initBootValidator();
    initConfigManager();
    initDebugMode();
    initDeviceCredentials();
    initDisplay();
    initWiFiAndImprov();
    initWebServer();
    initWebexClient();
    initManagers();
    initSupabase();
    initRemoteLogger();
    initIntegrations();
    initOTAManager();
    initSerialCommands();
    finalizeBootAndDisplay();
}

/**
 * @brief Arduino main loop
 *
 * The loop has been refactored into handler functions in loop/loop_handlers.cpp.
 * Each handler encapsulates a logical section of the original loop while
 * preserving the same state machine logic and execution order.
 *
 * Handler execution order:
 * 1. Heap monitoring (early detection of memory issues)
 * 2. Serial and Improv WiFi provisioning
 * 3. WiFi connection management
 * 4. mDNS maintenance
 * 5. NTP time sync
 * 6. Web server processing (may trigger early return on reboot)
 * 7. Supabase sync and realtime
 * 8. xAPI WebSocket processing
 * 9. Webex API fallback polling (may trigger early return)
 * 10. MQTT sensor processing
 * 11. Supabase provisioning
 * 12. OTA update check
 * 13. Connection status logging
 * 14. Display update (always last)
 */
void loop() {
    // Build the loop context with references to all managers
    LoopContext ctx;
    ctx.current_time = millis();
    ctx.app_state = &app_state;
    ctx.config_manager = &config_manager;
    ctx.matrix_display = &matrix_display;
    ctx.mdns_manager = &mdns_manager;
    ctx.web_server = &web_server;
    ctx.webex_client = &webex_client;
    ctx.xapi_websocket = &xapi_websocket;
    ctx.pairing_manager = &pairing_manager;
    ctx.mqtt_client = &mqtt_client;
    ctx.ota_manager = &ota_manager;
    ctx.wifi_manager = &wifi_manager;

    // Execute all loop handlers in correct order
    executeLoopHandlers(ctx);
}

// =============================================================================
// SETUP INITIALIZATION FUNCTIONS
// =============================================================================

void initSerialAndWatchdog() {
    Serial.begin(115200);
    delay(100);  // Reduced from 1000ms for faster Improv detection

    // CRITICAL: Configure watchdog timeout FIRST to prevent boot loops
    esp_task_wdt_init(30, false);  // 30 second timeout, no panic

    Serial.println();
    Serial.println("===========================================");
    Serial.println("  Webex Status Display - ESP32-S3");
    Serial.printf("  Firmware Version: %s\n", FIRMWARE_VERSION);
    Serial.println("===========================================");
    Serial.println();
}

void initBootValidator() {
    // Boot validation - check if we should rollback to bootstrap
    if (!boot_validator.begin()) {
        Serial.println("[ERROR] Boot validation failed!");
    }
}

void initConfigManager() {
    Serial.println("[INIT] Loading configuration...");
    if (!config_manager.begin()) {
        Serial.println("[ERROR] Failed to initialize configuration!");
        boot_validator.onCriticalFailure("Config", "Failed to load configuration");
    }

    // Store version for currently running partition (for OTA version tracking)
    #ifndef NATIVE_BUILD
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        #ifdef FIRMWARE_VERSION
        config_manager.setPartitionVersion(String(running->label), FIRMWARE_VERSION);
        Serial.printf("[INIT] Stored version %s for partition %s\n", FIRMWARE_VERSION, running->label);
        #endif
    }
    #endif
}

void initDebugMode() {
    g_debug_mode = config_manager.getDebugMode();
    g_debug_display = config_manager.getDebugDisplay();
    g_debug_realtime = config_manager.getDebugRealtime();
    if (g_debug_mode) {
        Serial.println("[INIT] Debug mode ENABLED - verbose logging active");
    }
    if (g_debug_display) {
        Serial.println("[INIT] Display debug ENABLED");
    }
    if (g_debug_realtime) {
        Serial.println("[INIT] Realtime debug ENABLED");
    }
}

void initDeviceCredentials() {
    Serial.println("[INIT] Initializing device credentials...");
    if (!deviceCredentials.begin()) {
        Serial.println("[WARN] Failed to initialize device credentials - authentication disabled");
    } else {
        Serial.printf("[INIT] Device serial: %s\n", deviceCredentials.getSerialNumber().c_str());
        Serial.printf("[INIT] Device ID: %s\n", deviceCredentials.getDeviceId().c_str());
    }
}

void initDisplay() {
    Serial.println("[INIT] Initializing LED matrix...");
    Serial.flush();
    delay(10);  // Feed watchdog before long operation

    s_display_ok = matrix_display.begin();
    if (!s_display_ok) {
        Serial.println("[WARN] Display initialization failed - continuing without display");
    } else {
        Serial.println("[INIT] Display ready!");
        matrix_display.setBrightness(config_manager.getBrightness());
        matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());
        matrix_display.showStartupScreen(FIRMWARE_VERSION);
    }
}

void initWiFiAndImprov() {
    // Initialize WiFi in STA mode (required for scanning)
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(WIFI_PS_NONE);  // Disable power save (prevents display interference)
    Serial.println("[INIT] WiFi initialized in STA mode");

    Serial.println("[IMPROV] Initializing Improv Wi-Fi handler...");
    improv_handler.begin(&Serial, &config_manager, &app_state, s_display_ok ? &matrix_display : nullptr);

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
            if (s_display_ok) {
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
        if (s_display_ok) {
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

    // Initialize mDNS and sync time if WiFi is connected
    if (app_state.wifi_connected) {
        Serial.println("[INIT] Starting mDNS...");
        mdns_manager.begin(config_manager.getDeviceName());
        mdns_manager.advertiseHTTP(80);

        // Sync time via NTP
        Serial.println("[INIT] Syncing time via NTP...");
        setup_time();
    }
}

void initWebServer() {
    Serial.println("[INIT] Starting web server...");
    web_server.begin(&config_manager, &app_state, nullptr, &mdns_manager);
}

void initWebexClient() {
    if (config_manager.hasWebexCredentials()) {
        Serial.println("[INIT] Initializing Webex client...");
        webex_client.begin(&config_manager);

        if (config_manager.hasWebexTokens()) {
            app_state.webex_authenticated = webex_client.refreshToken();
        }
    }
}

void initManagers() {
    Serial.println("[INIT] Initializing pairing manager...");
    pairing_manager.begin();
    Serial.println("[INIT] Pairing manager initialized");

    Serial.println("[INIT] Initializing command processor...");
    commandProcessor.begin();

    Serial.println("[INIT] Initializing sync manager...");
    syncManager.begin();

    Serial.println("[INIT] Initializing realtime manager...");
    realtimeManager.begin();
}

void initSupabase() {
    // Register device with Supabase on first boot (requires WiFi + Supabase URL)
    if (app_state.wifi_connected) {
        provisionDeviceWithSupabase();
    }

    // Initialize Supabase client for state sync
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
}

void initRemoteLogger() {
    remoteLogger.begin(app_state.wifi_connected ? &supabaseClient : nullptr);
    if (g_debug_mode) {
        remoteLogger.setRemoteEnabled(true);
    }
}

void initIntegrations() {
    if (config_manager.hasXAPIDevice()) {
        Serial.println("[INIT] Connecting to RoomOS device...");
        xapi_websocket.begin(&config_manager);
    }

    if (config_manager.hasMQTTConfig()) {
        Serial.println("[INIT] Connecting to MQTT broker...");
        mqtt_client.begin(&config_manager);
    }
}

void initOTAManager() {
    Serial.println("[INIT] Initializing OTA manager...");
    String ota_url = config_manager.getOTAUrl();
    ota_manager.begin(ota_url, FIRMWARE_VERSION);

    // Enable manifest mode for non-GitHub API URLs
    if (!ota_url.isEmpty() && ota_url.indexOf("api.github.com") < 0) {
        ota_manager.setManifestUrl(ota_url);
    }
}

void initSerialCommands() {
    Serial.println("[INIT] Initializing serial command handler...");
    serial_commands_begin();
}

void finalizeBootAndDisplay() {
    Serial.println("[INIT] Setup complete!");
    Serial.println();

    // Mark boot as successful - cancels OTA rollback
    boot_validator.markBootSuccessful();

    if (app_state.wifi_connected) {
        String hostname = mdns_manager.getHostname();
        matrix_display.showUnconfigured(WiFi.localIP().toString(), hostname);
        Serial.printf("[INIT] Device ready at http://%s or http://%s.local\n",
                      WiFi.localIP().toString().c_str(), hostname.c_str());
    }
}

// Helper functions and update_display() moved to loop/loop_handlers.cpp

/**
 * @brief Setup NTP time synchronization
 */
void setup_time() {
    if (!applyTimeConfig(config_manager, &app_state)) {
        Serial.println("[TIME] Failed to apply time configuration");
    }
}

// =============================================================================
// MODULARIZATION NOTES
// =============================================================================
// The following functions have been extracted to focused modules:
// 
// loop/loop_handlers.cpp:
//   - update_display() - LED matrix display logic
//   - check_for_updates() - OTA firmware update checks
//   - All loop handler functions
//
// commands/command_processor.cpp:
//   - handleSupabaseCommand() - Command execution logic
//
// realtime/realtime_manager.cpp:
//   - handleRealtimeMessage() - WebSocket message handling
//
// sync/sync_manager.cpp:
//   - provisionDeviceWithSupabase() - Device provisioning
//
// device/device_info.cpp:
//   - buildStatusJson(), buildTelemetryJson(), buildConfigJson()
