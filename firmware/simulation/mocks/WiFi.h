/**
 * @file WiFi.h
 * @brief Mock ESP32 WiFi for native simulation
 */

#ifndef WIFI_H
#define WIFI_H

#include "Arduino.h"

// WiFi modes
typedef enum {
    WIFI_OFF = 0,
    WIFI_STA = 1,
    WIFI_AP = 2,
    WIFI_AP_STA = 3
} wifi_mode_t;

// WiFi status
typedef enum {
    WL_NO_SHIELD = 255,
    WL_IDLE_STATUS = 0,
    WL_NO_SSID_AVAIL = 1,
    WL_SCAN_COMPLETED = 2,
    WL_CONNECTED = 3,
    WL_CONNECT_FAILED = 4,
    WL_CONNECTION_LOST = 5,
    WL_DISCONNECTED = 6
} wl_status_t;

// WiFi encryption types
typedef enum {
    WIFI_AUTH_OPEN = 0,
    WIFI_AUTH_WEP = 1,
    WIFI_AUTH_WPA_PSK = 2,
    WIFI_AUTH_WPA2_PSK = 3,
    WIFI_AUTH_WPA_WPA2_PSK = 4,
    WIFI_AUTH_WPA2_ENTERPRISE = 5,
    WIFI_AUTH_WPA3_PSK = 6,
    WIFI_AUTH_WPA2_WPA3_PSK = 7,
    WIFI_AUTH_WAPI_PSK = 8,
    WIFI_AUTH_MAX
} wifi_auth_mode_t;

class WiFiClass {
public:
    WiFiClass() : _status(WL_DISCONNECTED), _mode(WIFI_OFF), _simulateConnected(true) {}
    
    // Mode
    bool mode(wifi_mode_t m) {
        _mode = m;
        printf("[WiFi] Mode set to %d\n", m);
        return true;
    }
    
    wifi_mode_t getMode() { return _mode; }
    
    // Station mode
    wl_status_t begin(const char* ssid, const char* passphrase = nullptr) {
        _ssid = ssid;
        printf("[WiFi] Connecting to '%s'...\n", ssid);
        if (_simulateConnected) {
            _status = WL_CONNECTED;
            printf("[WiFi] Connected! (simulated)\n");
        }
        return _status;
    }
    
    bool disconnect(bool wifioff = false) {
        _status = WL_DISCONNECTED;
        printf("[WiFi] Disconnected\n");
        return true;
    }
    
    bool reconnect() {
        if (_simulateConnected) {
            _status = WL_CONNECTED;
            printf("[WiFi] Reconnected (simulated)\n");
        }
        return _status == WL_CONNECTED;
    }
    
    wl_status_t status() { return _status; }
    
    // AP mode
    bool softAP(const char* ssid, const char* passphrase = nullptr) {
        _apSSID = ssid;
        printf("[WiFi] AP started: SSID='%s'\n", ssid);
        return true;
    }
    
    bool softAPdisconnect(bool wifioff = false) {
        printf("[WiFi] AP stopped\n");
        return true;
    }
    
    IPAddress softAPIP() {
        return IPAddress(192, 168, 4, 1);
    }
    
    // Network info
    IPAddress localIP() {
        return IPAddress(192, 168, 1, 100);  // Simulated IP
    }
    
    IPAddress subnetMask() {
        return IPAddress(255, 255, 255, 0);
    }
    
    IPAddress gatewayIP() {
        return IPAddress(192, 168, 1, 1);
    }
    
    IPAddress dnsIP(uint8_t dns_no = 0) {
        return IPAddress(8, 8, 8, 8);
    }
    
    String macAddress() {
        return "AA:BB:CC:DD:EE:FF";
    }
    
    String SSID() {
        return _ssid;
    }
    
    int32_t RSSI() {
        return -65;  // Simulated signal strength
    }
    
    uint8_t* BSSID() {
        static uint8_t bssid[] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF};
        return bssid;
    }
    
    String BSSIDstr() {
        return "AA:BB:CC:DD:EE:FF";
    }
    
    // Scanning
    int16_t scanNetworks(bool async = false, bool show_hidden = false) {
        (void)show_hidden;  // Unused parameter
        printf("[WiFi] Scanning networks... (simulated, async=%s)\n", async ? "true" : "false");
        return 3;  // Return simulated network count
    }
    
    int16_t scanComplete() {
        return 3;
    }
    
    void scanDelete() {}
    
    String SSID(uint8_t networkItem) {
        const char* networks[] = {"SimNetwork1", "SimNetwork2", "SimNetwork3"};
        if (networkItem < 3) return networks[networkItem];
        return "";
    }
    
    int32_t RSSI(uint8_t networkItem) {
        int32_t rssi[] = {-45, -60, -75};
        if (networkItem < 3) return rssi[networkItem];
        return -100;
    }
    
    wifi_auth_mode_t encryptionType(uint8_t networkItem) {
        return WIFI_AUTH_WPA2_PSK;
    }
    
    uint8_t* BSSID(uint8_t networkItem) {
        static uint8_t bssid[] = {0x00, 0x11, 0x22, 0x33, 0x44, 0x55};
        bssid[5] = networkItem;
        return bssid;
    }
    
    int32_t channel(uint8_t networkItem) {
        return 6;
    }
    
    // Configuration
    bool setHostname(const char* hostname) {
        _hostname = hostname;
        printf("[WiFi] Hostname set to '%s'\n", hostname);
        return true;
    }
    
    const char* getHostname() {
        return _hostname.c_str();
    }
    
    bool setAutoReconnect(bool autoReconnect) {
        return true;
    }
    
    bool getAutoReconnect() {
        return true;
    }
    
    // For testing: control simulation behavior
    void setSimulateConnected(bool connected) {
        _simulateConnected = connected;
        if (connected) {
            _status = WL_CONNECTED;
        } else {
            _status = WL_DISCONNECTED;
        }
    }

private:
    wl_status_t _status;
    wifi_mode_t _mode;
    String _ssid;
    String _apSSID;
    String _hostname;
    bool _simulateConnected;
};

extern WiFiClass WiFi;

#endif // WIFI_H
