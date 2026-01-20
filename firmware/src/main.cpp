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
#include "display/matrix_display.h"
#include "discovery/mdns_manager.h"
#include "web/web_server.h"
#include "webex/webex_client.h"
#include "webex/xapi_websocket.h"
#include "bridge/bridge_client.h"
#include "meraki/mqtt_client.h"
#include "ota/ota_manager.h"

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
MerakiMQTTClient mqtt_client;
OTAManager ota_manager;

// Application state (defined in app_state.h)
#include "app_state.h"
AppState app_state;

// Forward declarations
void setup_wifi();
void setup_time();
void handle_wifi_connection();
void update_display();
void check_for_updates();

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
        matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());
        matrix_display.showStartupScreen(FIRMWARE_VERSION);
    }

    // Setup WiFi (includes AP mode fallback if connection fails)
    Serial.println("[INIT] Setting up WiFi...");
    setup_wifi();

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

    // Look for bridge server
    if (app_state.wifi_connected) {
        Serial.println("[INIT] Searching for bridge server...");
        String bridge_host;
        uint16_t bridge_port;
        if (mdns_manager.discoverBridge(bridge_host, bridge_port)) {
            Serial.printf("[INIT] Found bridge at %s:%d\n", bridge_host.c_str(), bridge_port);
            bridge_client.begin(bridge_host, bridge_port);
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
    ota_manager.begin(config_manager.getOTAUrl(), FIRMWARE_VERSION);

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
    handle_wifi_connection();

    // Process web server requests
    web_server.loop();

    // Complete OAuth flow if callback was received
    if (web_server.hasPendingOAuthCode()) {
        String code = web_server.consumePendingOAuthCode();
        String redirect_uri = web_server.getPendingOAuthRedirectUri();
        bool auth_ok = webex_client.handleOAuthCallback(code, redirect_uri);
        app_state.webex_authenticated = auth_ok;
        web_server.clearPendingOAuth();
        Serial.printf("[WEBEX] OAuth exchange %s\n", auth_ok ? "successful" : "failed");
    }

    // Process bridge client
    if (bridge_client.isConnected()) {
        bridge_client.loop();

        // Check for presence updates from bridge
        if (bridge_client.hasUpdate()) {
            BridgeUpdate update = bridge_client.getUpdate();
            app_state.webex_status = update.status;
            app_state.bridge_connected = true;
        }
    } else if (app_state.wifi_connected && mdns_manager.hasBridge()) {
        // Try to reconnect to bridge
        bridge_client.reconnect();
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

    // Poll Webex API if bridge not connected (fallback)
    if (!app_state.bridge_connected && app_state.webex_authenticated) {
        unsigned long poll_interval = config_manager.getWebexPollInterval() * 1000UL;

        if (current_time - app_state.last_poll_time >= poll_interval) {
            app_state.last_poll_time = current_time;

            WebexPresence presence;
            if (webex_client.getPresence(presence)) {
                app_state.webex_status = presence.status;
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
            Serial.println();
            Serial.println("=== WEBEX STATUS DISPLAY ===");
            Serial.printf("IP: %s | mDNS: %s.local\n", 
                          WiFi.localIP().toString().c_str(),
                          mdns_manager.getHostname().c_str());
            Serial.printf("Status: %s | Bridge: %s | MQTT: %s\n",
                          app_state.webex_status.c_str(),
                          app_state.bridge_connected ? "Yes" : "No",
                          app_state.mqtt_connected ? "Yes" : "No");
            Serial.println("============================");
        }
    }

    // Update display
    update_display();

    // Small delay to prevent watchdog issues
    delay(10);
}

/**
 * @brief Setup WiFi connection
 */
void setup_wifi() {
    String ssid = config_manager.getWiFiSSID();
    String password = config_manager.getWiFiPassword();
    matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());

    // Always scan for networks first so they're available in the web interface
    Serial.println("[WIFI] Scanning for networks...");
    WiFi.mode(WIFI_STA);
    delay(100);
    int network_count = WiFi.scanNetworks();
    Serial.printf("[WIFI] Found %d networks\n", network_count);
    
    // List networks found
    for (int i = 0; i < min(network_count, 10); i++) {
        Serial.printf("[WIFI]   %d. %s (%d dBm)\n", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i));
    }

    if (ssid.isEmpty()) {
        // Start AP mode for configuration
        Serial.println("[WIFI] No WiFi configured, starting AP mode...");
        WiFi.mode(WIFI_AP);
        WiFi.softAP("Webex-Display-Setup");
        Serial.printf("[WIFI] AP started (open): SSID='Webex-Display-Setup', IP=%s\n",
                      WiFi.softAPIP().toString().c_str());
        matrix_display.showAPMode(WiFi.softAPIP().toString());
        return;
    }

    // Check if configured network was found in scan
    bool network_found = false;
    for (int i = 0; i < network_count; i++) {
        if (WiFi.SSID(i) == ssid) {
            network_found = true;
            Serial.printf("[WIFI] Configured network '%s' found (signal: %d dBm)\n", 
                          ssid.c_str(), WiFi.RSSI(i));
            break;
        }
    }
    
    if (!network_found) {
        Serial.printf("[WIFI] Configured network '%s' NOT found! Starting AP mode...\n", ssid.c_str());
        WiFi.mode(WIFI_AP_STA);
        WiFi.softAP("Webex-Display-Setup");
        Serial.printf("[WIFI] AP started (open) for reconfiguration: IP=%s\n", WiFi.softAPIP().toString().c_str());
        matrix_display.showAPMode(WiFi.softAPIP().toString());
        return;
    }

    // Connect to WiFi
    Serial.printf("[WIFI] Connecting to '%s'...\n", ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), password.c_str());

    matrix_display.showConnecting(ssid);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        app_state.wifi_connected = true;
        Serial.printf("[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        matrix_display.showConnected(WiFi.localIP().toString());
    } else {
        Serial.println("[WIFI] Connection failed, starting AP mode for reconfiguration...");
        WiFi.mode(WIFI_AP_STA);
        WiFi.softAP("Webex-Display-Setup");
        Serial.printf("[WIFI] AP started (open): IP=%s\n", WiFi.softAPIP().toString().c_str());
        matrix_display.showAPMode(WiFi.softAPIP().toString());
    }
}

/**
 * @brief Handle WiFi reconnection
 */
void handle_wifi_connection() {
    static unsigned long last_check = 0;

    if (millis() - last_check < 10000) {
        return;
    }
    last_check = millis();

    if (WiFi.status() != WL_CONNECTED && !config_manager.getWiFiSSID().isEmpty()) {
        Serial.println("[WIFI] Connection lost, reconnecting...");
        app_state.wifi_connected = false;
        WiFi.reconnect();
        if (mdns_manager.isInitialized()) {
            Serial.println("[MDNS] Stopping mDNS due to WiFi disconnect...");
            mdns_manager.end();
        }
    } else if (WiFi.status() == WL_CONNECTED) {
        if (!app_state.wifi_connected) {
            Serial.printf("[WIFI] Reconnected. IP: %s\n", WiFi.localIP().toString().c_str());
        }
        app_state.wifi_connected = true;

        if (!mdns_manager.isInitialized()) {
            Serial.println("[MDNS] Starting mDNS after reconnect...");
            if (mdns_manager.begin(config_manager.getDeviceName())) {
                mdns_manager.advertiseHTTP(80);
            }
        }

        if (!app_state.time_synced) {
            setup_time();
        }
    }
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
    matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());

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
    data.show_call_status = app_state.xapi_connected;
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

    // Get current time
    if (app_state.time_synced) {
        struct tm timeinfo;
        if (getLocalTime(&timeinfo)) {
            data.hour = timeinfo.tm_hour;
            data.minute = timeinfo.tm_min;
            data.day = timeinfo.tm_mday;
            data.month = timeinfo.tm_mon + 1;  // tm_mon is 0-11
            data.time_valid = true;
        }
    }

    matrix_display.update(data);
}

/**
 * @brief Setup NTP time synchronization
 */
void setup_time() {
    // Configure NTP with timezone (default to UTC, can be configured later)
    configTime(0, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");

    // Wait for time to sync (up to 10 seconds)
    Serial.println("[TIME] Waiting for NTP sync...");
    struct tm timeinfo;
    int attempts = 0;
    while (!getLocalTime(&timeinfo) && attempts < 20) {
        delay(500);
        attempts++;
    }

    if (getLocalTime(&timeinfo)) {
        app_state.time_synced = true;
        Serial.printf("[TIME] Time synced: %02d:%02d:%02d\n",
                      timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    } else {
        Serial.println("[TIME] Failed to sync time");
    }
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
            Serial.println("[OTA] Auto-update enabled, installing...");
            matrix_display.showUpdating(new_version);

            if (ota_manager.performUpdate()) {
                Serial.println("[OTA] Update successful, rebooting...");
                ESP.restart();
            } else {
                Serial.println("[OTA] Update failed!");
            }
        }
    } else {
        Serial.println("[OTA] No updates available.");
    }
}
