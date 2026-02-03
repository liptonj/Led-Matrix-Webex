/**
 * @file wifi_manager.cpp
 * @brief WiFi Connection Manager Implementation
 */

#include "wifi_manager.h"
#include "../display/matrix_display.h"
#include "../discovery/mdns_manager.h"
#include "../debug/remote_logger.h"
#include <esp_heap_caps.h>

namespace {
// Check if we have sufficient heap to start mDNS service
// mDNS uses network buffers which can be allocated from general heap (internal or PSRAM)
// Unlike TLS/HTTPS which requires internal RAM for DMA, mDNS is less strict
// Threshold: 20KB contiguous block is small enough that internal RAM should satisfy it
bool mdnsMemoryOk() {
    const size_t free_heap = ESP.getFreeHeap();
    const size_t largest_block = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    return free_heap >= 60000 && largest_block >= 20000;
}
}  // namespace

WiFiManager::WiFiManager()
    : config_manager(nullptr), app_state(nullptr), matrix_display(nullptr),
      last_connection_check(0), last_mdns_start_attempt(0), ap_mode_active(false),
      scan_start_time(0), scan_in_progress(false), scan_completed(false) {
}

void WiFiManager::startAPMode(const String& reason) {
    if (ap_mode_active) {
        Serial.println("[WIFI] AP mode already active");
        return;
    }
    
    Serial.printf("[WIFI] Starting AP mode: %s\n", reason.c_str());
    
    // Use AP+STA mode instead of AP-only to allow WiFi scanning while AP is active
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP("Webex-Display-Setup");
    ap_mode_active = true;
    
    // Update app state to reflect WiFi disconnection
    if (app_state) {
        app_state->wifi_connected = false;
    }
    
    Serial.printf("[WIFI] AP started (open): SSID='Webex-Display-Setup', IP=%s\n",
                  WiFi.softAPIP().toString().c_str());
    
    if (matrix_display) {
        matrix_display->showAPMode(WiFi.softAPIP().toString());
    }
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

    // Clean up any stale scan state before starting new scan
    int16_t scan_status = WiFi.scanComplete();
    if (scan_status == WIFI_SCAN_RUNNING) {
        Serial.println("[WIFI] Cleaning up running scan...");
    }
    WiFi.scanDelete();  // Clear any previous scan results
    
    // WiFi should already be in STA mode from initWiFiAndImprov()
    // Only set mode if not already in STA mode
    wifi_mode_t current_mode = WiFi.getMode();
    if (current_mode != WIFI_STA && current_mode != WIFI_AP_STA) {
        Serial.println("[WIFI] Setting WiFi to STA mode...");
        WiFi.mode(WIFI_STA);
        vTaskDelay(pdMS_TO_TICKS(100));  // Brief delay for mode switch
    }

    // Start async network scan (non-blocking)
    Serial.println("[WIFI] Starting async network scan...");
    int16_t result = WiFi.scanNetworks(true, false);  // Async scan, no hidden networks
    if (result == WIFI_SCAN_RUNNING) {
        Serial.println("[WIFI] Network scan started (async)");
        scan_in_progress = true;
        scan_start_time = millis();
    } else if (result < 0) {
        Serial.printf("[WIFI] Scan failed to start: %d\n", result);
        RLOG_ERROR("wifi", "Scan failed to start: %d", result);
        scan_in_progress = false;
        scan_completed = false;
    }

    // Wait for scan completion with timeout (non-blocking poll)
    while (scan_in_progress && !scan_completed) {
        int16_t scan_result = WiFi.scanComplete();
        if (scan_result >= 0) {
            // Scan completed successfully
            Serial.printf("[WIFI] Found %d networks\n", scan_result);
            scan_completed = true;
            scan_in_progress = false;
            
            // List networks found
            int max_to_show = (scan_result < 10) ? scan_result : 10;
            for (int i = 0; i < max_to_show; i++) {
                Serial.printf("[WIFI]   %d. %s (%d dBm)\n", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i));
            }
        } else if (scan_result == WIFI_SCAN_FAILED) {
            Serial.println("[WIFI] Scan failed");
            scan_in_progress = false;
            scan_completed = false;
            break;
        } else if (millis() - scan_start_time > SCAN_TIMEOUT_MS) {
            Serial.println("[WIFI] Scan timeout");
            scan_in_progress = false;
            scan_completed = false;
            break;
        } else {
            // Still running, yield to other tasks
            vTaskDelay(pdMS_TO_TICKS(100));
        }
    }

    // If async scan failed, try blocking scan as fallback
    if (!scan_completed) {
        Serial.println("[WIFI] Async scan failed, trying blocking scan...");
        RLOG_WARN("wifi", "Async scan failed, trying blocking scan");
        WiFi.scanDelete();  // Clear any partial results
        int blocking_result = WiFi.scanNetworks(false, false);  // Blocking scan
        if (blocking_result > 0) {
            Serial.printf("[WIFI] Blocking scan found %d networks\n", blocking_result);
            scan_completed = true;
            
            // List networks found
            int max_to_show = (blocking_result < 10) ? blocking_result : 10;
            for (int i = 0; i < max_to_show; i++) {
                Serial.printf("[WIFI]   %d. %s (%d dBm)\n", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i));
            }
        } else {
            Serial.printf("[WIFI] Blocking scan also failed: %d\n", blocking_result);
        }
    }

    // Get scan result count
    int network_count = scan_completed ? WiFi.scanComplete() : 0;
    if (network_count < 0) network_count = 0;  // Handle error codes
    
    if (ssid.isEmpty()) {
        // Start AP+STA mode for configuration
        startAPMode("No WiFi configured");
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
        Serial.printf("[WIFI] Configured network '%s' NOT found!\n", ssid.c_str());
        startAPMode("Configured network not found");
        return;
    }

    // Connect to WiFi
    Serial.printf("[WIFI] Connecting to '%s'...\n", ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), password.c_str());

    // Use event-driven approach: check connection status without blocking
    // Allow up to 15 seconds for connection (non-blocking checks every 500ms)
    int attempts = 0;
    const int max_attempts = 30;
    unsigned long connect_start = millis();
    
    while (WiFi.status() != WL_CONNECTED && attempts < max_attempts) {
        // Use non-blocking delay to allow other tasks to run
        unsigned long delay_start = millis();
        while (millis() - delay_start < 500) {
            yield();  // Allow other tasks and WiFi stack to run
            delay(10);  // Small delay to prevent tight loop
        }
        Serial.print(".");
        attempts++;
        
        // Check for timeout (extra safety)
        if (millis() - connect_start > 15000) {
            Serial.println("\n[WIFI] Connection timeout");
            break;
        }
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        // Synchronize app state with actual WiFi status
        if (app_state) {
            app_state->wifi_connected = true;
        }
        
        // Disable AP mode now that we're connected
        if (ap_mode_active) {
            Serial.println("[WIFI] Connected to network, disabling AP mode...");
            WiFi.softAPdisconnect(true);
            WiFi.mode(WIFI_STA);
            ap_mode_active = false;
        }
        
        Serial.printf("[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        RLOG_INFO("WiFi", "Connected to network, IP: %s, RSSI: %d dBm",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
        // Note: hostname shown later after mDNS is initialized
        if (matrix_display) {
            matrix_display->showUnconfigured(WiFi.localIP().toString(), "");
        }
    } else {
        Serial.println("[WIFI] Connection failed");
        RLOG_ERROR("wifi", "Connection failed");
        startAPMode("Connection failed");
    }
}

void WiFiManager::handleConnection(MDNSManager* mdns_manager) {
    if (!config_manager || !app_state) {
        return;
    }
    
    unsigned long now = millis();
    // FIXED: Handle millis() wraparound properly
    unsigned long elapsed = now - last_connection_check;
    if (elapsed < CONNECTION_CHECK_INTERVAL) {
        return;
    }
    last_connection_check = now;

    // Check current WiFi status
    wl_status_t wifi_status = WiFi.status();
    bool is_connected = (wifi_status == WL_CONNECTED);
    
    // Synchronize app state with actual WiFi status
    bool state_changed = (app_state->wifi_connected != is_connected);
    if (state_changed) {
        app_state->wifi_connected = is_connected;
        Serial.printf("[WIFI] State synchronized: %s\n", is_connected ? "connected" : "disconnected");
        if (is_connected) {
            RLOG_INFO("WiFi", "Reconnected, IP: %s, RSSI: %d dBm",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
        } else {
            RLOG_WARN("WiFi", "Connection lost");
        }
    }

    if (!is_connected && !config_manager->getWiFiSSID().isEmpty()) {
        reconnect_attempts++;
        
        if (reconnect_attempts == 1) {
            Serial.println("[WIFI] Connection lost, reconnecting...");
        }
        
        // After 5 failed attempts (about 50 seconds), start AP mode for reconfiguration
        if (reconnect_attempts >= 5 && !ap_mode_active) {
            startAPMode("Multiple reconnection attempts failed");
        }
        
        // Use WiFi.begin() instead of WiFi.reconnect() for reliability
        // WiFi.reconnect() only works if there was a previous successful connection
        // If the network was never found (scan failed), reconnect() will fail
        String ssid = config_manager->getWiFiSSID();
        String password = config_manager->getWiFiPassword();
        WiFi.begin(ssid.c_str(), password.c_str());
        
        if (mdns_manager && mdns_manager->isInitialized()) {
            Serial.println("[MDNS] Stopping mDNS due to WiFi disconnect...");
            mdns_manager->end();
        }
    } else if (is_connected) {
        const bool was_connected = !state_changed || app_state->wifi_connected;
        if (state_changed && !was_connected) {
            Serial.printf("[WIFI] Reconnected. IP: %s\n", WiFi.localIP().toString().c_str());
        }
        reconnect_attempts = 0;  // Reset counter on successful connection
        
        // Disable AP mode after successful connection/reconnection
        if (ap_mode_active) {
            Serial.println("[WIFI] Disabling AP mode after reconnect...");
            WiFi.softAPdisconnect(true);
            WiFi.mode(WIFI_STA);
            ap_mode_active = false;
        }

        if (mdns_manager && (!mdns_manager->isInitialized() || state_changed)) {
            const unsigned long now_mdns = millis();
            // FIXED: Handle millis() wraparound properly
            unsigned long elapsed_mdns = now_mdns - last_mdns_start_attempt;
            if (elapsed_mdns < MDNS_RETRY_INTERVAL) {
                return;
            }
            last_mdns_start_attempt = now_mdns;

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
