/**
 * @file main.cpp
 * @brief ESP32 Webex Status Display - Main Entry Point
 *
 * Displays Webex presence status, camera/mic state, and Meraki MT sensor
 * data on a 64x32 RGB LED matrix. Supports ESP32, ESP32-S2, and ESP32-S3.
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
#include "common/board_utils.h"
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

// Initialization modules (extracted from main.cpp)
#include "boot_manager.h"
#include "improv_provisioner.h"
#include "supabase_init.h"

// Dependency Injection Framework
#include "core/dependencies.h"

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

// External references to global instances defined in other modules
extern BootValidator boot_validator;
extern DeviceCredentials deviceCredentials;
extern SyncManager syncManager;
extern RealtimeManager realtimeManager;
extern CommandProcessor commandProcessor;
extern RemoteLogger remoteLogger;
extern ImprovHandler improv_handler;
extern SupabaseClient supabaseClient;
extern SupabaseRealtime supabaseRealtime;

// Dependency Injection: Global Dependencies instance
// Initialized in setup() after all global instances are ready
static Dependencies* g_dependencies = nullptr;

/**
 * @brief Get the global Dependencies instance
 * 
 * @return Dependencies& Reference to the global Dependencies instance
 * @note Must be called after setup() completes initialization
 * @note Aborts if dependencies not initialized (critical error)
 */
Dependencies& getDependencies() {
    if (g_dependencies == nullptr) {
        Serial.println("[CRITICAL] Dependencies not initialized - setup() failed or not called");
        Serial.flush();
        // Abort - this is a critical programming error
        // On ESP32, this will trigger a watchdog reset
        abort();
    }
    return *g_dependencies;
}

// Display initialization state (tracked across setup functions)
static bool s_display_ok = false;

// Forward declarations
void setup_time();

// Setup initialization functions (preserve order)
void initSerialAndWatchdog();
void initConfigManager();
void initDebugMode();
void initDeviceCredentials();
void initDisplay();
void initWebServer();
void initWebexClient();
void initManagers();
void initRemoteLogger();
void initIntegrations();
void initOTAManager();
void initSerialCommands();
void finalizeBootAndDisplay();
void initDependencies();

// Command queue management moved to command_processor module

/**
 * @brief Arduino setup function
 */
void setup() {
    initSerialAndWatchdog();
    initBootValidation();  // From boot_manager module
    initConfigManager();
    initDebugMode();
    initDeviceCredentials();
    initDisplay();
    initDependencies();  // Initialize DI framework early - before any code that uses getDependencies()
    initWiFiAndImprov(config_manager, app_state, s_display_ok ? &matrix_display : nullptr,
                       mdns_manager, wifi_manager, s_display_ok);  // From improv_provisioner module
    initWebServer();
    initWebexClient();
    initManagers();
    initSupabase(config_manager, app_state, pairing_manager);  // From supabase_init module
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
    
    // ESP32-S2 uses TinyUSB for USB CDC which needs more time to enumerate
    // than native USB on ESP32-S3. Without sufficient delay, USB may not
    // be ready for Improv WiFi provisioning via ESP Web Tools.
    #if defined(ESP32_S2_BOARD)
    delay(1000);  // TinyUSB needs longer to enumerate
    #else
    delay(100);   // Native USB enumerates faster
    #endif

    // CRITICAL: Configure watchdog timeout FIRST to prevent boot loops
    esp_task_wdt_init(30, false);  // 30 second timeout, no panic

    Serial.println();
    Serial.println("===========================================");
    Serial.printf("  Webex Status Display - %s\n", getChipDescription().c_str());
    Serial.printf("  Firmware Version: %s\n", FIRMWARE_VERSION);
    Serial.println("===========================================");
    Serial.println();
}

void initConfigManager() {
    Serial.println("[INIT] Loading configuration...");
    if (!config_manager.begin()) {
        RLOG_ERROR("init", "Failed to initialize configuration");
        boot_validator.onCriticalFailure("Config", "Failed to load configuration");
    }

    // Store version for currently running partition (for OTA version tracking)
    storePartitionVersion(config_manager);  // From boot_manager module
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
        RLOG_WARN("init", "Failed to initialize device credentials - auth disabled");
    } else {
        Serial.printf("[INIT] Device serial: %s\n", deviceCredentials.getSerialNumber().c_str());
        Serial.printf("[INIT] Device ID: %s\n", deviceCredentials.getDeviceId().c_str());
    }
}

void initDisplay() {
    Serial.println("[INIT] Initializing LED matrix...");
    Serial.flush();
    delay(10);  // Feed watchdog before long operation

    // Get pin configuration from ConfigManager (supports runtime presets and custom pins)
    PinConfig pins = config_manager.getPinConfig();
    PinPreset preset = config_manager.getPinPreset();
    Serial.printf("[INIT] Using pin preset: %s\n", getPresetName(preset));
    
    s_display_ok = matrix_display.begin(pins);
    if (!s_display_ok) {
        Serial.println("[WARN] Display initialization failed - continuing without display");
    } else {
        Serial.println("[INIT] Display ready!");
        matrix_display.setBrightness(config_manager.getBrightness());
        matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());
        matrix_display.showStartupScreen(FIRMWARE_VERSION);
    }
}

// initWiFiAndImprov() moved to improv_provisioner.cpp

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

// initSupabase() moved to supabase_init.cpp

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

void initDependencies() {
    Serial.println("[INIT] Initializing dependency injection framework...");
    
    // Initialize the global Dependencies instance with all component references
    // Using static allocation to ensure it persists for the lifetime of the program
    static Dependencies deps = initializeDependencies(
        config_manager,
        app_state,
        g_debug_mode,
        g_debug_display,
        g_debug_realtime,
        matrix_display,
        wifi_manager,
        web_server,
        mdns_manager,
        supabaseClient,
        supabaseRealtime,
        deviceCredentials,
        pairing_manager,
        boot_validator,
        ota_manager,
        mqtt_client,
        syncManager,
        realtimeManager,
        commandProcessor,
        remoteLogger,
        improv_handler,
        webex_client,
        xapi_websocket
    );
    
    g_dependencies = &deps;
    Serial.println("[INIT] Dependency injection framework ready");
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
// boot_manager.cpp:
//   - initBootValidation() - Boot validation and partition version tracking
//   - storePartitionVersion() - Store firmware version for OTA tracking
//
// improv_provisioner.cpp:
//   - initWiFiAndImprov() - Improv WiFi provisioning with detection windows
//
// supabase_init.cpp:
//   - initSupabase() - Supabase initialization, authentication, and error handling
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
