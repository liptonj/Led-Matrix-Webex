/**
 * @file wifi_manager.h
 * @brief WiFi Connection Manager Header
 * 
 * Handles WiFi setup, connection, AP mode fallback, and reconnection.
 */

#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include "../config/config_manager.h"
#include "../app_state.h"

// Forward declarations
class MatrixDisplay;
class MDNSManager;

/**
 * @brief WiFi Connection Manager
 * 
 * Manages WiFi connectivity including:
 * - Initial connection setup
 * - AP mode for configuration
 * - Automatic reconnection
 * - Network scanning
 */
class WiFiManager {
public:
    WiFiManager();
    
    /**
     * @brief Initialize the WiFi manager
     * @param config Pointer to configuration manager
     * @param state Pointer to application state
     * @param display Pointer to display (for status updates)
     */
    void begin(ConfigManager* config, AppState* state, MatrixDisplay* display);
    
    /**
     * @brief Setup initial WiFi connection
     * 
     * Scans for networks, attempts connection to configured SSID,
     * or falls back to AP mode for configuration.
     */
    void setupWiFi();
    
    /**
     * @brief Handle WiFi reconnection in main loop
     * 
     * Checks connection status periodically and reconnects if needed.
     * Also manages mDNS restart after reconnection.
     * 
     * @param mdns_manager Pointer to mDNS manager for restart
     */
    void handleConnection(MDNSManager* mdns_manager);
    
    /**
     * @brief Check if WiFi is connected
     * @return true if connected to a network
     */
    bool isConnected() const;
    
    /**
     * @brief Check if AP mode is active
     * @return true if AP mode is enabled
     */
    bool isAPModeActive() const;
    
    /**
     * @brief Get the current IP address
     * @return IP address as string
     */
    String getIPAddress() const;
    
    /**
     * @brief Get the AP IP address
     * @return AP IP address as string (if AP mode active)
     */
    String getAPIPAddress() const;
    
    /**
     * @brief Disable AP mode
     * 
     * Call this after successfully connecting to WiFi to disable
     * the provisioning AP. Safe to call even if AP is not active.
     */
    void disableAP();

private:
    /**
     * @brief Start AP mode for configuration
     * 
     * Starts AP mode only if not already active (prevents duplication).
     * Updates app state to reflect WiFi disconnection.
     * 
     * @param reason Reason for starting AP mode (for logging)
     */
    void startAPMode(const String& reason);

    ConfigManager* config_manager;
    AppState* app_state;
    MatrixDisplay* matrix_display;
    
    unsigned long last_connection_check;
    unsigned long last_mdns_start_attempt;
    bool ap_mode_active;
    uint8_t reconnect_attempts = 0;  // Counter for failed reconnection attempts
    
    // Async WiFi scan state
    unsigned long scan_start_time = 0;
    bool scan_in_progress = false;
    bool scan_completed = false;
    
    static const unsigned long CONNECTION_CHECK_INTERVAL = 10000;  // 10 seconds
    static const unsigned long MDNS_RETRY_INTERVAL = 30000;  // 30 seconds
    static const unsigned long SCAN_TIMEOUT_MS = 10000;  // 10 second timeout for scan
};

#endif // WIFI_MANAGER_H
