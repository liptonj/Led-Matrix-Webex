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

#include "boot_validator.h"
#include "config/config_manager.h"
#include "debug.h"
#include "display/matrix_display.h"
#include "discovery/mdns_manager.h"
#include "web/web_server.h"
#include "webex/webex_client.h"
#include "webex/xapi_websocket.h"
#include "bridge/bridge_client.h"
#include "bridge/bridge_discovery.h"
#include "bridge/pairing_manager.h"
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
BridgeClient bridge_client;
BridgeDiscovery bridge_discovery;
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
void handleBridgeCommand(const BridgeCommand& cmd);
String buildStatusJson();
String buildConfigJson();

/**
 * @brief Arduino setup function
 */
void setup() {
    Serial.begin(115200);
    delay(1000);

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

    // Initialize configuration
    Serial.println("[INIT] Loading configuration...");
    if (!config_manager.begin()) {
        Serial.println("[ERROR] Failed to initialize configuration!");
        boot_validator.onCriticalFailure("Config", "Failed to load configuration");
        // Won't return - device reboots to bootloader
    }

    // Initialize debug mode from config
    g_debug_mode = config_manager.getDebugMode();
    if (g_debug_mode) {
        Serial.println("[INIT] Debug mode ENABLED - verbose logging active");
    }

    // Initialize display
    Serial.println("[INIT] Initializing LED matrix...");
    Serial.flush();

    // CRITICAL: Feed watchdog before long operation
    delay(10);

    if (!matrix_display.begin()) {
        Serial.println("[WARN] Display initialization failed - continuing without display");
        // Don't fail boot - continue without display
    } else {
        Serial.println("[INIT] Display ready!");
        matrix_display.setBrightness(config_manager.getBrightness());
        matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());
        matrix_display.showStartupScreen(FIRMWARE_VERSION);
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
    web_server.begin(&config_manager, &app_state);

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

    // Set command handler before connecting
    bridge_client.setCommandHandler(handleBridgeCommand);

    // Look for bridge server
    if (app_state.wifi_connected) {
        Serial.println("[INIT] Searching for bridge server...");
        String bridge_host;
        uint16_t bridge_port;
        bool bridge_found = false;
        
        // Try 1: Check for user-configured bridge URL
        String configured_url = config_manager.getBridgeUrl();
        if (!configured_url.isEmpty()) {
            Serial.printf("[INIT] Using configured bridge URL: %s\n", configured_url.c_str());
            bridge_client.beginWithUrl(configured_url, pairing_manager.getCode());
            bridge_found = true;
        }
        
        // Try 2: Check for user-configured bridge host/port
        if (!bridge_found) {
            String configured_host = config_manager.getBridgeHost();
            if (!configured_host.isEmpty()) {
                uint16_t configured_port = config_manager.getBridgePort();
                bool use_ssl = config_manager.getBridgeUseSSL();
                
                // Build URL from host/port/ssl settings
                String manual_url = (use_ssl ? "wss://" : "ws://") + configured_host + ":" + String(configured_port);
                Serial.printf("[INIT] Using configured bridge: %s\n", manual_url.c_str());
                bridge_client.beginWithUrl(manual_url, pairing_manager.getCode());
                bridge_found = true;
            }
        }
        
        // Try 3: Local mDNS discovery
        if (!bridge_found) {
            Serial.println("[INIT] Attempting mDNS discovery for local bridge...");
            if (mdns_manager.discoverBridge(bridge_host, bridge_port)) {
                Serial.printf("[INIT] Found local bridge via mDNS at %s:%d\n", bridge_host.c_str(), bridge_port);
                bridge_client.beginWithPairing(bridge_host, bridge_port, pairing_manager.getCode());
                bridge_found = true;
            } else {
                Serial.println("[INIT] mDNS discovery failed - no local bridge found");
            }
        }
        
        // Try 4: Cloud bridge via discovery endpoint
        if (!bridge_found) {
            Serial.println("[INIT] No local bridge found, trying cloud bridge...");
            if (bridge_discovery.fetchConfig()) {
                String bridge_url = bridge_discovery.getBridgeUrl();
                Serial.printf("[INIT] Using cloud bridge: %s\n", bridge_url.c_str());
                bridge_client.beginWithUrl(bridge_url, pairing_manager.getCode());
                bridge_found = true;
            } else {
                // Use hardcoded fallback
                Serial.println("[INIT] Discovery failed, using default cloud bridge");
                bridge_client.beginWithUrl("wss://bridge.5ls.us", pairing_manager.getCode());
                bridge_found = true;
            }
        }
        
        // Try 5: Fallback URL from discovery config (if cloud fails to connect)
        // This provides a configurable local network fallback
        if (!bridge_found) {
            String fallback_url = bridge_discovery.getFallbackUrl();
            if (!fallback_url.isEmpty()) {
                Serial.printf("[INIT] Trying fallback bridge: %s\n", fallback_url.c_str());
                bridge_client.beginWithUrl(fallback_url, pairing_manager.getCode());
                bridge_found = true;
            }
        }
        
        if (bridge_found) {
            app_state.bridge_connected = false;  // Will be set true on successful connection
        }
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

    Serial.println("[INIT] Setup complete!");
    Serial.println();

    // Mark boot as successful - this cancels OTA rollback
    // Only do this after all critical initialization succeeded
    boot_validator.markBootSuccessful();

    // Show connection info briefly on display
    if (app_state.wifi_connected) {
        String hostname = mdns_manager.getHostname();
        matrix_display.showConnected(WiFi.localIP().toString());
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

    // Handle WiFi connection
    wifi_manager.handleConnection(&mdns_manager);

    // Refresh mDNS periodically to prevent TTL expiry
    if (app_state.wifi_connected) {
        mdns_manager.refresh();
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

    // Check if bridge configuration was changed via web interface
    // Add periodic logging to verify this check is running
    static unsigned long last_check_log = 0;
    unsigned long now = millis();
    if (now - last_check_log > 10000) {  // Log every 10 seconds
        Serial.printf("[MAIN] Bridge config check: changed=%d wifi=%d\n", 
                      app_state.bridge_config_changed, app_state.wifi_connected);
        last_check_log = now;
    }
    
    if (app_state.bridge_config_changed && app_state.wifi_connected) {
        Serial.println("[MAIN] Bridge configuration changed - reconnecting...");
        app_state.bridge_config_changed = false;
        
        // Disconnect current connection
        bridge_client.disconnect();
        
        // Reconnect with new configuration
        String configured_url = config_manager.getBridgeUrl();
        if (!configured_url.isEmpty()) {
            Serial.printf("[MAIN] Connecting to new bridge URL: %s\n", configured_url.c_str());
            bridge_client.beginWithUrl(configured_url, pairing_manager.getCode());
        } else {
            // Check for host/port configuration
            String configured_host = config_manager.getBridgeHost();
            if (!configured_host.isEmpty()) {
                uint16_t configured_port = config_manager.getBridgePort();
                bool use_ssl = config_manager.getBridgeUseSSL();
                
                String manual_url = (use_ssl ? "wss://" : "ws://") + configured_host + ":" + String(configured_port);
                Serial.printf("[MAIN] Connecting to new bridge: %s\n", manual_url.c_str());
                bridge_client.beginWithUrl(manual_url, pairing_manager.getCode());
            } else {
                Serial.println("[MAIN] No bridge configuration found after change");
            }
        }
    }

    // Process bridge client (skip during OTA to save resources)
    if (matrix_display.isOTALocked()) {
        // Skip bridge processing during OTA update
    } else if (app_state.wifi_connected) {
        // Initialize bridge if not yet done
        if (!bridge_client.isInitialized()) {
            Serial.println("[BRIDGE] WiFi connected, initializing bridge connection...");
            
            // Try 1: Check for user-configured bridge URL
            String configured_url = config_manager.getBridgeUrl();
            if (!configured_url.isEmpty()) {
                Serial.printf("[BRIDGE] Using configured bridge URL: %s\n", configured_url.c_str());
                bridge_client.beginWithUrl(configured_url, pairing_manager.getCode());
            } else {
                // Try 2: Check for user-configured bridge host/port
                String configured_host = config_manager.getBridgeHost();
                if (!configured_host.isEmpty()) {
                    uint16_t configured_port = config_manager.getBridgePort();
                    bool use_ssl = config_manager.getBridgeUseSSL();
                    
                    String manual_url = (use_ssl ? "wss://" : "ws://") + configured_host + ":" + String(configured_port);
                    Serial.printf("[BRIDGE] Using configured bridge: %s\n", manual_url.c_str());
                    bridge_client.beginWithUrl(manual_url, pairing_manager.getCode());
                } else {
                    // Try cloud bridge via discovery endpoint
                    if (bridge_discovery.fetchConfig()) {
                        String bridge_url = bridge_discovery.getBridgeUrl();
                        Serial.printf("[BRIDGE] Using cloud bridge: %s\n", bridge_url.c_str());
                        bridge_client.beginWithUrl(bridge_url, pairing_manager.getCode());
                    } else {
                        // Use hardcoded fallback
                        Serial.println("[BRIDGE] Discovery failed, using default cloud bridge");
                        bridge_client.beginWithUrl("wss://bridge.5ls.us", pairing_manager.getCode());
                    }
                }
            }
        }
        
        // CRITICAL: Always call loop() when initialized - this is required for
        // the WebSocketsClient library to complete handshakes and process messages
        if (bridge_client.isInitialized()) {
            bridge_client.loop();
        }
        
        // Update connection state
        if (bridge_client.isConnected()) {
            app_state.bridge_connected = bridge_client.isJoined();
            app_state.embedded_app_connected = bridge_client.isPeerConnected();

            // Check for presence updates from bridge
            if (bridge_client.hasUpdate()) {
                BridgeUpdate update = bridge_client.getUpdate();
                app_state.webex_status = update.status;
                app_state.last_bridge_status_time = millis();  // Track when we received status
                // Derive in_call from status if not connected to xAPI
                if (!app_state.xapi_connected) {
                    app_state.in_call = (update.status == "meeting" || update.status == "busy" ||
                                         update.status == "call" || update.status == "presenting");
                }
            }
        } else {
            app_state.bridge_connected = false;
            app_state.embedded_app_connected = false;
            app_state.last_bridge_status_time = 0;  // Reset so we don't use stale threshold
        }
    } else {
        // WiFi not connected
        app_state.bridge_connected = false;
        app_state.embedded_app_connected = false;
        app_state.last_bridge_status_time = 0;  // Reset so we don't use stale threshold
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

    // Poll Webex API as fallback when bridge status is unavailable or stale
    // Conditions for fallback polling:
    // 1. Bridge not connected at all, OR
    // 2. Bridge connected but embedded app not connected, OR  
    // 3. Bridge connected but status is stale (no update in 60+ seconds)
    const unsigned long BRIDGE_STALE_THRESHOLD = 60000UL;  // 60 seconds
    bool bridge_status_stale = (app_state.last_bridge_status_time > 0) && 
                               (current_time - app_state.last_bridge_status_time > BRIDGE_STALE_THRESHOLD);
    bool need_api_fallback = !app_state.bridge_connected || 
                             !app_state.embedded_app_connected ||
                             bridge_status_stale;
    
    if (need_api_fallback && app_state.webex_authenticated) {
        unsigned long poll_interval = config_manager.getWebexPollInterval() * 1000UL;

        if (current_time - app_state.last_poll_time >= poll_interval) {
            app_state.last_poll_time = current_time;
            
            // Log why we're polling (for debugging)
            if (bridge_status_stale) {
                Serial.println("[WEBEX] Bridge status stale, polling API directly");
            } else if (!app_state.embedded_app_connected && app_state.bridge_connected) {
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
            const char* status_source = "API";
            if (app_state.bridge_connected && app_state.embedded_app_connected) {
                status_source = "Bridge/App";
            } else if (app_state.bridge_connected) {
                status_source = "Bridge (no app)";
            }
            
            Serial.println();
            Serial.println("=== WEBEX STATUS DISPLAY ===");
            Serial.printf("IP: %s | mDNS: %s.local\n",
                          WiFi.localIP().toString().c_str(),
                          mdns_manager.getHostname().c_str());
            Serial.printf("Status: %s (via %s) | MQTT: %s\n",
                          app_state.webex_status.c_str(),
                          status_source,
                          app_state.mqtt_connected ? "Yes" : "No");
            Serial.printf("Bridge: %s | App: %s | API Auth: %s\n",
                          app_state.bridge_connected ? "Yes" : "No",
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

    // Show updating screen during OTA file upload
    if (web_server.isOTAUploadInProgress()) {
        matrix_display.showUpdating("Uploading...");
        return;
    }

    // If Webex is unavailable, keep showing a generic screen with IP
    if (!app_state.wifi_connected) {
        matrix_display.showWifiDisconnected();
        return;
    }

    // If Webex is unavailable, keep showing a generic screen with IP
    if (app_state.wifi_connected &&
        !app_state.bridge_connected &&
        !app_state.xapi_connected &&
        !app_state.webex_authenticated &&
        !app_state.mqtt_connected) {
        matrix_display.showUnconfigured(WiFi.localIP().toString());
        return;
    }

    // Build display data
    DisplayData data;
    data.webex_status = app_state.webex_status;
    data.display_name = config_manager.getDisplayName();
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

    // Connection indicators
    data.wifi_connected = app_state.wifi_connected;
    data.bridge_connected = app_state.bridge_connected;

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
    doc["bridge_connected"] = app_state.bridge_connected;
    doc["webex_status"] = app_state.webex_status;
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
 * @brief Build JSON string with current device config
 */
String buildConfigJson() {
    JsonDocument doc;
    
    doc["device_name"] = config_manager.getDeviceName();
    doc["display_name"] = config_manager.getDisplayName();
    doc["brightness"] = config_manager.getBrightness();
    doc["scroll_speed_ms"] = config_manager.getScrollSpeedMs();
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
    
    String result;
    serializeJson(doc, result);
    return result;
}

/**
 * @brief Handle commands received from embedded app via bridge
 */
void handleBridgeCommand(const BridgeCommand& cmd) {
    Serial.printf("[CMD] Processing command: %s\n", cmd.command.c_str());
    
    if (cmd.command == "get_status") {
        // Send current status
        bridge_client.sendStatus(buildStatusJson());
        
    } else if (cmd.command == "get_config") {
        // Send current config
        bridge_client.sendConfig(buildConfigJson());
        
    } else if (cmd.command == "set_config") {
        // Parse and apply config changes
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, cmd.payload);
        
        if (error) {
            bridge_client.sendCommandResponse(cmd.requestId, false, "", "Invalid JSON");
            return;
        }
        
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
        
        bridge_client.sendCommandResponse(cmd.requestId, true, buildConfigJson(), "");
        Serial.println("[CMD] Config updated");
        
    } else if (cmd.command == "set_brightness") {
        JsonDocument doc;
        deserializeJson(doc, cmd.payload);
        uint8_t brightness = doc["value"] | 128;
        config_manager.setBrightness(brightness);
        matrix_display.setBrightness(brightness);
        bridge_client.sendCommandResponse(cmd.requestId, true, "", "");
        
    } else if (cmd.command == "regenerate_pairing") {
        String newCode = pairing_manager.generateCode(true);
        JsonDocument resp;
        resp["code"] = newCode;
        String respStr;
        serializeJson(resp, respStr);
        bridge_client.sendCommandResponse(cmd.requestId, true, respStr, "");
        
    } else if (cmd.command == "reboot") {
        bridge_client.sendCommandResponse(cmd.requestId, true, "", "");
        delay(500);
        ESP.restart();
        
    } else if (cmd.command == "factory_reset") {
        bridge_client.sendCommandResponse(cmd.requestId, true, "", "");
        config_manager.factoryReset();
        delay(500);
        ESP.restart();
        
    } else {
        bridge_client.sendCommandResponse(cmd.requestId, false, "", 
            "Unknown command: " + cmd.command);
    }
}
