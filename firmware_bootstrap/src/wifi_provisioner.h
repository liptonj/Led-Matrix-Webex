/**
 * @file wifi_provisioner.h
 * @brief WiFi Provisioner with AP Mode and SmartConfig
 *
 * Handles WiFi provisioning using two methods simultaneously:
 * - AP Mode: Creates a hotspot for web-based configuration
 * - SmartConfig: Listens for credentials from ESP Touch app
 */

#ifndef WIFI_PROVISIONER_H
#define WIFI_PROVISIONER_H

#include <Arduino.h>
#include <WiFi.h>
#include "config_store.h"

// AP Mode Configuration
#define AP_SSID "Webex-Display-Setup"
#define AP_CHANNEL 6  // Channel 6 for better compatibility
#define AP_MAX_CONNECTIONS 4

// Connection timeouts
#define WIFI_CONNECT_TIMEOUT_MS 15000
#define SMARTCONFIG_TIMEOUT_MS 120000

/**
 * @brief WiFi Provisioner Class
 *
 * Manages WiFi connection and provisioning for the bootstrap firmware.
 */
class WiFiProvisioner {
public:
    WiFiProvisioner();
    ~WiFiProvisioner();

    /**
     * @brief Initialize the provisioner with config store reference
     * @param config Pointer to ConfigStore for saving credentials
     */
    void begin(ConfigStore* config);

    /**
     * @brief Attempt to connect using stored credentials
     * @return true if connection successful
     */
    bool connectWithStoredCredentials();

    /**
     * @brief Connect to a specific network
     * @param ssid Network SSID
     * @param password Network password
     * @param save_credentials Whether to save credentials on success
     * @return true if connection successful
     */
    bool connect(const String& ssid, const String& password, bool save_credentials = true);

    /**
     * @brief Start AP mode with SmartConfig listener
     *
     * Creates a WiFi hotspot for web configuration while also
     * listening for SmartConfig provisioning from mobile app.
     */
    void startAPWithSmartConfig();

    /**
     * @brief Stop AP mode and SmartConfig
     */
    void stopProvisioning();

    /**
     * @brief Process provisioning events (call in loop)
     *
     * Checks for SmartConfig completion and handles events.
     */
    void loop();

    /**
     * @brief Check if connected to WiFi network
     * @return true if connected
     */
    bool isConnected() const;

    /**
     * @brief Check if AP mode is active
     * @return true if AP is running
     */
    bool isAPActive() const;

    /**
     * @brief Check if SmartConfig is running
     * @return true if SmartConfig is active
     */
    bool isSmartConfigActive() const;

    /**
     * @brief Get local IP address
     * @return IP address (AP or Station mode)
     */
    IPAddress getIPAddress() const;

    /**
     * @brief Get AP IP address
     * @return AP IP address
     */
    IPAddress getAPIPAddress() const;

    /**
     * @brief Scan for available networks
     * @return Number of networks found
     */
    int scanNetworks();

    /**
     * @brief Get scanned network SSID
     * @param index Network index
     * @return SSID string
     */
    String getScannedSSID(int index) const;

    /**
     * @brief Get scanned network RSSI
     * @param index Network index
     * @return Signal strength in dBm
     */
    int getScannedRSSI(int index) const;

    /**
     * @brief Check if scanned network is encrypted
     * @param index Network index
     * @return true if network requires password
     */
    bool isScannedNetworkEncrypted(int index) const;

    /**
     * @brief Get number of scanned networks
     * @return Network count
     */
    int getScannedNetworkCount() const;
    
    /**
     * @brief Check if a specific SSID was found in the last scan
     * @param ssid SSID to search for
     * @return true if network was found
     */
    bool isNetworkInScanResults(const String& ssid) const;
    
    /**
     * @brief Check if scan results are available
     * @return true if networks have been scanned
     */
    bool hasScanResults() const { return scanned_network_count > 0; }

    /**
     * @brief Callback type for connection events
     */
    typedef void (*ConnectionCallback)(bool connected);

    /**
     * @brief Set callback for connection state changes
     * @param callback Function to call on connection change
     */
    void setConnectionCallback(ConnectionCallback callback);

private:
    ConfigStore* config_store;
    bool ap_active;
    bool smartconfig_active;
    bool smartconfig_done;
    unsigned long smartconfig_start_time;
    int scanned_network_count;
    ConnectionCallback connection_callback;

    void handleSmartConfigResult();
};

#endif // WIFI_PROVISIONER_H
