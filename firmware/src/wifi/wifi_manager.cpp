/**
 * @file wifi_manager.cpp
 * @brief WiFi Connection Manager Implementation
 */

#include "wifi_manager.h"
#include "../display/matrix_display.h"
#include "../discovery/mdns_manager.h"
#include "../debug/log_system.h"
#include "../common/board_utils.h"
#include <esp_heap_caps.h>

static const char* TAG = "WIFI";

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
        ESP_LOGI(TAG, "AP mode already active");
        return;
    }
    
    ESP_LOGI(TAG, "Starting AP mode: %s", reason.c_str());
    
    // Use AP+STA mode instead of AP-only to allow WiFi scanning while AP is active
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP("Webex-Display-Setup");
    ap_mode_active = true;
    
    // Update app state to reflect WiFi disconnection
    if (app_state) {
        app_state->wifi_connected = false;
    }
    
    ESP_LOGI(TAG, "AP started (open): SSID='Webex-Display-Setup', IP=%s",
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
        ESP_LOGE(TAG, "WiFi manager not initialized!");
        return;
    }
    
    // CRITICAL: Disable WiFi power save FIRST to prevent display interference
    // WiFi power save causes timing issues with I2S DMA used for LED matrix
    WiFi.setSleep(WIFI_PS_NONE);
    ESP_LOGI(TAG, "WiFi power save disabled (prevents display interference)");
    
    // Apply chip-specific WiFi configuration
    String board = getBoardType();
    if (board == "esp32s2") {
        // ESP32-S2 may need explicit TX power for stability
        // The S2 has known WiFi issues that benefit from maximum TX power
        WiFi.setTxPower(WIFI_POWER_19_5dBm);
        ESP_LOGI(TAG, "ESP32-S2: Set maximum TX power for stability");
        
        // Allow radio to stabilize before connection attempts
        delay(100);
        ESP_LOGI(TAG, "ESP32-S2: Radio stabilization delay complete");
    }
    ESP_LOGI(TAG, "Board type: %s", board.c_str());
    
    String ssid = config_manager->getWiFiSSID();
    String password = config_manager->getWiFiPassword();
    
    if (matrix_display) {
        matrix_display->setScrollSpeedMs(config_manager->getScrollSpeedMs());
    }

    // Clean up any stale scan state before starting new scan
    int16_t scan_status = WiFi.scanComplete();
    if (scan_status == WIFI_SCAN_RUNNING) {
        ESP_LOGI(TAG, "Cleaning up running scan...");
    }
    WiFi.scanDelete();  // Clear any previous scan results
    
    // WiFi should already be in STA mode from initWiFiAndImprov()
    // Only set mode if not already in STA mode
    wifi_mode_t current_mode = WiFi.getMode();
    if (current_mode != WIFI_STA && current_mode != WIFI_AP_STA) {
        ESP_LOGI(TAG, "Setting WiFi to STA mode...");
        WiFi.mode(WIFI_STA);
        vTaskDelay(pdMS_TO_TICKS(100));  // Brief delay for mode switch
    }

    // Start async network scan (non-blocking)
    ESP_LOGI(TAG, "Starting async network scan...");
    int16_t result = WiFi.scanNetworks(true, false);  // Async scan, no hidden networks
    if (result == WIFI_SCAN_RUNNING) {
        ESP_LOGI(TAG, "Network scan started (async)");
        scan_in_progress = true;
        scan_start_time = millis();
    } else if (result < 0) {
        ESP_LOGE(TAG, "Scan failed to start: %d", result);
        scan_in_progress = false;
        scan_completed = false;
    }

    // Wait for scan completion with timeout (non-blocking poll)
    while (scan_in_progress && !scan_completed) {
        int16_t scan_result = WiFi.scanComplete();
        if (scan_result >= 0) {
            // Scan completed successfully
            ESP_LOGI(TAG, "Found %d networks", scan_result);
            scan_completed = true;
            scan_in_progress = false;
            
            // List networks found
            int max_to_show = (scan_result < 10) ? scan_result : 10;
            for (int i = 0; i < max_to_show; i++) {
                ESP_LOGD(TAG, "  %d. %s (%d dBm)", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i));
            }
        } else if (scan_result == WIFI_SCAN_FAILED) {
            ESP_LOGE(TAG, "Scan failed");
            scan_in_progress = false;
            scan_completed = false;
            break;
        } else if (millis() - scan_start_time > SCAN_TIMEOUT_MS) {
            ESP_LOGW(TAG, "Scan timeout");
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
        ESP_LOGW(TAG, "Async scan failed, trying blocking scan...");
        WiFi.scanDelete();  // Clear any partial results
        int blocking_result = WiFi.scanNetworks(false, false);  // Blocking scan
        if (blocking_result > 0) {
            ESP_LOGI(TAG, "Blocking scan found %d networks", blocking_result);
            scan_completed = true;
            
            // List networks found
            int max_to_show = (blocking_result < 10) ? blocking_result : 10;
            for (int i = 0; i < max_to_show; i++) {
                ESP_LOGD(TAG, "  %d. %s (%d dBm)", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i));
            }
        } else {
            ESP_LOGE(TAG, "Blocking scan also failed: %d", blocking_result);
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
            ESP_LOGI(TAG, "Configured network '%s' found (signal: %d dBm)",
                          ssid.c_str(), WiFi.RSSI(i));
            break;
        }
    }

    if (!network_found) {
        // Network not found in scan, but try direct connect anyway
        // Many networks can be connected to even when scanning fails
        ESP_LOGW(TAG, "Configured network '%s' NOT found in scan!", ssid.c_str());
        ESP_LOGI(TAG, "Attempting direct connect anyway...");
    }

    // Connect to WiFi (attempt even if scan didn't find the network)
    ESP_LOGI(TAG, "Connecting to '%s'...", ssid.c_str());
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
        attempts++;
        
        // Check for timeout (extra safety)
        if (millis() - connect_start > 15000) {
            ESP_LOGW(TAG, "Connection timeout");
            break;
        }
    }

    if (WiFi.status() == WL_CONNECTED) {
        // Synchronize app state with actual WiFi status
        if (app_state) {
            app_state->wifi_connected = true;
        }
        
        // Disable AP mode now that we're connected
        if (ap_mode_active) {
            ESP_LOGI(TAG, "Connected to network, disabling AP mode...");
            WiFi.softAPdisconnect(true);
            WiFi.mode(WIFI_STA);
            ap_mode_active = false;
        }
        
        ESP_LOGI(TAG, "Connected! IP: %s", WiFi.localIP().toString().c_str());
        ESP_LOGI(TAG, "Connected to network, IP: %s, RSSI: %d dBm",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
        // Note: hostname shown later after mDNS is initialized
        if (matrix_display) {
            matrix_display->showUnconfigured(WiFi.localIP().toString(), "");
        }
    } else {
        ESP_LOGE(TAG, "Connection failed");
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
        ESP_LOGI(TAG, "State synchronized: %s", is_connected ? "connected" : "disconnected");
        if (is_connected) {
            ESP_LOGI(TAG, "Reconnected, IP: %s, RSSI: %d dBm",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
        } else {
            ESP_LOGW(TAG, "Connection lost");
        }
    }

    if (!is_connected && !config_manager->getWiFiSSID().isEmpty()) {
        reconnect_attempts++;
        
        if (reconnect_attempts == 1) {
            ESP_LOGI(TAG, "Connection lost, reconnecting...");
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
            ESP_LOGI(TAG, "Stopping mDNS due to WiFi disconnect...");
            mdns_manager->end();
        }
    } else if (is_connected) {
        const bool was_connected = !state_changed || app_state->wifi_connected;
        if (state_changed && !was_connected) {
            ESP_LOGI(TAG, "Reconnected. IP: %s", WiFi.localIP().toString().c_str());
        }
        reconnect_attempts = 0;  // Reset counter on successful connection
        
        // Disable AP mode after successful connection/reconnection
        if (ap_mode_active) {
            ESP_LOGI(TAG, "Disabling AP mode after reconnect...");
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
                ESP_LOGD(TAG, "Skipping start (heap=%lu, largest=%lu)",
                              ESP.getFreeHeap(),
                              heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
                return;
            }

            ESP_LOGI(TAG, "(Re)starting mDNS after WiFi connect...");
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
        ESP_LOGI(TAG, "Disabling AP mode...");
        WiFi.softAPdisconnect(true);
        WiFi.mode(WIFI_STA);
        ap_mode_active = false;
        ESP_LOGI(TAG, "AP mode disabled");
    }
}
