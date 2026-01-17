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

#include "config/config_manager.h"
#include "display/matrix_display.h"
#include "discovery/mdns_manager.h"
#include "web/web_server.h"
#include "webex/webex_client.h"
#include "webex/xapi_websocket.h"
#include "bridge/bridge_client.h"
#include "meraki/mqtt_client.h"
#include "ota/ota_manager.h"

// Firmware version
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
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

    Serial.println();
    Serial.println("===========================================");
    Serial.println("  Webex Status Display - ESP32-S3");
    Serial.printf("  Firmware Version: %s\n", FIRMWARE_VERSION);
    Serial.println("===========================================");
    Serial.println();

    // Initialize configuration
    Serial.println("[INIT] Loading configuration...");
    if (!config_manager.begin()) {
        Serial.println("[ERROR] Failed to initialize configuration!");
    }

    // Initialize display
    Serial.println("[INIT] Initializing LED matrix...");
    if (!matrix_display.begin()) {
        Serial.println("[ERROR] Failed to initialize display!");
    }
    matrix_display.showStartupScreen(FIRMWARE_VERSION);

    // Setup WiFi
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
    if (mqtt_client.isConnected()) {
        mqtt_client.loop();

        // Check for sensor updates
        if (mqtt_client.hasUpdate()) {
            MerakiSensorData data = mqtt_client.getLatestData();
            app_state.temperature = data.temperature;
            app_state.humidity = data.humidity;
            app_state.door_status = data.door_status;
            app_state.air_quality_index = data.air_quality_index;
            app_state.mqtt_connected = true;
        }
    }

    // Check for OTA updates (hourly)
    if (current_time - app_state.last_ota_check >= 3600000UL) {
        app_state.last_ota_check = current_time;
        check_for_updates();
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

    if (ssid.isEmpty()) {
        // Start AP mode for configuration
        Serial.println("[WIFI] No WiFi configured, starting AP mode...");
        WiFi.mode(WIFI_AP);
        WiFi.softAP("Webex-Display-Setup", "webexdisplay");
        Serial.printf("[WIFI] AP started: SSID='Webex-Display-Setup', IP=%s\n",
                      WiFi.softAPIP().toString().c_str());
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
        Serial.println("[WIFI] Connection failed, starting AP mode...");
        WiFi.mode(WIFI_AP_STA);
        WiFi.softAP("Webex-Display-Setup", "webexdisplay");
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
    } else if (WiFi.status() == WL_CONNECTED) {
        app_state.wifi_connected = true;
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
