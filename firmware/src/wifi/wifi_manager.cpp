/**
 * @file wifi_manager.cpp
 * @brief WiFi Connection Manager Implementation
 */

#include "wifi_manager.h"
#include "../display/matrix_display.h"
#include "../discovery/mdns_manager.h"
#include <esp_heap_caps.h>

namespace {
bool mdnsMemoryOk() {
    const size_t free_heap = ESP.getFreeHeap();
    const size_t largest_block = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    return free_heap >= 60000 && largest_block >= 20000;
}
}  // namespace

WiFiManager::WiFiManager()
    : config_manager(nullptr), app_state(nullptr), matrix_display(nullptr),
      last_connection_check(0), last_mdns_start_attempt(0), ap_mode_active(false) {
}

void WiFiManager::begin(ConfigManager* config, AppState* state, MatrixDisplay* display) {
    config_manager = config;
    app_state = state;
    matrix_display = display;
}

void WiFiManager::setupWiFi() {
    if (!config_manager || !app_state) {
        Serial.println("[WIFI] WiFi manager not initialized!");
        return;
    }
    
    // CRITICAL: Disable WiFi power save FIRST to prevent display interference
    // WiFi power save causes timing issues with I2S DMA used for LED matrix
    WiFi.setSleep(WIFI_PS_NONE);
    Serial.println("[WIFI] WiFi power save disabled (prevents display interference)");
    
    String ssid = config_manager->getWiFiSSID();
    String password = config_manager->getWiFiPassword();
    
    if (matrix_display) {
        matrix_display->setScrollSpeedMs(config_manager->getScrollSpeedMs());
    }

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
        // Start AP+STA mode for configuration
        // Using AP_STA instead of AP-only allows WiFi scanning while AP is active
        Serial.println("[WIFI] No WiFi configured, starting AP mode...");
        WiFi.mode(WIFI_AP_STA);
        WiFi.softAP("Webex-Display-Setup");
        ap_mode_active = true;
        Serial.printf("[WIFI] AP started (open): SSID='Webex-Display-Setup', IP=%s\n",
                      WiFi.softAPIP().toString().c_str());
        if (matrix_display) {
            matrix_display->showAPMode(WiFi.softAPIP().toString());
        }
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
        ap_mode_active = true;
        Serial.printf("[WIFI] AP started (open) for reconfiguration: IP=%s\n", WiFi.softAPIP().toString().c_str());
        if (matrix_display) {
            matrix_display->showAPMode(WiFi.softAPIP().toString());
        }
        return;
    }

    // Connect to WiFi
    Serial.printf("[WIFI] Connecting to '%s'...\n", ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), password.c_str());

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        app_state->wifi_connected = true;
        
        // Disable AP mode now that we're connected
        if (ap_mode_active) {
            Serial.println("[WIFI] Connected to network, disabling AP mode...");
            WiFi.softAPdisconnect(true);
            WiFi.mode(WIFI_STA);
            ap_mode_active = false;
        }
        
        Serial.printf("[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        // Note: hostname shown later after mDNS is initialized
        if (matrix_display) {
            matrix_display->showConnected(WiFi.localIP().toString());
        }
    } else {
        Serial.println("[WIFI] Connection failed, starting AP mode for reconfiguration...");
        WiFi.mode(WIFI_AP_STA);
        WiFi.softAP("Webex-Display-Setup");
        ap_mode_active = true;
        Serial.printf("[WIFI] AP started (open): IP=%s\n", WiFi.softAPIP().toString().c_str());
        if (matrix_display) {
            matrix_display->showAPMode(WiFi.softAPIP().toString());
        }
    }
}

void WiFiManager::handleConnection(MDNSManager* mdns_manager) {
    if (!config_manager || !app_state) {
        return;
    }
    
    if (millis() - last_connection_check < CONNECTION_CHECK_INTERVAL) {
        return;
    }
    last_connection_check = millis();

    if (WiFi.status() != WL_CONNECTED && !config_manager->getWiFiSSID().isEmpty()) {
        reconnect_attempts++;
        
        if (reconnect_attempts == 1) {
            Serial.println("[WIFI] Connection lost, reconnecting...");
        }
        
        app_state->wifi_connected = false;
        
        // After 5 failed attempts (about 50 seconds), start AP mode for reconfiguration
        if (reconnect_attempts >= 5 && !ap_mode_active) {
            Serial.println("[WIFI] Multiple reconnection attempts failed, starting AP mode...");
            WiFi.mode(WIFI_AP_STA);  // Keep trying to connect while AP is active
            WiFi.softAP("Webex-Display-Setup");
            ap_mode_active = true;
            Serial.printf("[WIFI] AP started for reconfiguration: IP=%s\n", WiFi.softAPIP().toString().c_str());
            if (matrix_display) {
                matrix_display->showAPMode(WiFi.softAPIP().toString());
            }
        }
        
        WiFi.reconnect();
        
        if (mdns_manager && mdns_manager->isInitialized()) {
            Serial.println("[MDNS] Stopping mDNS due to WiFi disconnect...");
            mdns_manager->end();
        }
    } else if (WiFi.status() == WL_CONNECTED) {
        const bool was_connected = app_state->wifi_connected;
        if (!was_connected) {
            Serial.printf("[WIFI] Reconnected. IP: %s\n", WiFi.localIP().toString().c_str());
        }
        app_state->wifi_connected = true;
        reconnect_attempts = 0;  // Reset counter on successful connection
        
        // Disable AP mode after successful connection/reconnection
        if (ap_mode_active) {
            Serial.println("[WIFI] Disabling AP mode after reconnect...");
            WiFi.softAPdisconnect(true);
            WiFi.mode(WIFI_STA);
            ap_mode_active = false;
        }

        if (mdns_manager && (!mdns_manager->isInitialized() || !was_connected)) {
            const unsigned long now = millis();
            if (now - last_mdns_start_attempt < MDNS_RETRY_INTERVAL) {
                return;
            }
            last_mdns_start_attempt = now;

            if (!mdnsMemoryOk()) {
                Serial.printf("[MDNS] Skipping start (heap=%lu, largest=%lu)\n",
                              ESP.getFreeHeap(),
                              heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
                return;
            }

            Serial.println("[MDNS] (Re)starting mDNS after WiFi connect...");
            mdns_manager->end();
            if (mdns_manager->begin(config_manager->getDeviceName())) {
                mdns_manager->advertiseHTTP(80);
            }
        }
    }
}

bool WiFiManager::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

bool WiFiManager::isAPModeActive() const {
    return ap_mode_active;
}

String WiFiManager::getIPAddress() const {
    return WiFi.localIP().toString();
}

String WiFiManager::getAPIPAddress() const {
    return WiFi.softAPIP().toString();
}

void WiFiManager::disableAP() {
    if (ap_mode_active || WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) {
        Serial.println("[WIFI] Disabling AP mode...");
        WiFi.softAPdisconnect(true);
        WiFi.mode(WIFI_STA);
        ap_mode_active = false;
        Serial.println("[WIFI] AP mode disabled");
    }
}
