/**
 * @file wifi_provisioner.cpp
 * @brief WiFi Provisioner Implementation
 */

#include "wifi_provisioner.h"
#include "debug.h"

WiFiProvisioner::WiFiProvisioner()
    : config_store(nullptr)
    , ap_active(false)
    , scanned_network_count(0)
    , connection_callback(nullptr) {
}

WiFiProvisioner::~WiFiProvisioner() {
    stopProvisioning();
}

void WiFiProvisioner::begin(ConfigStore* config) {
    config_store = config;
    Serial.println("[WIFI] Provisioner initialized");
    
    // Do an initial network scan so results are ready for AP interface
    Serial.println("[WIFI] Performing initial network scan...");
    WiFi.mode(WIFI_STA);
    delay(100);
    scanNetworks();
    
    // Sort results by signal strength (strongest first) - WiFi.scanNetworks does this by default
    Serial.printf("[WIFI] Found %d networks in initial scan\n", scanned_network_count);
}

bool WiFiProvisioner::connectWithStoredCredentials() {
    if (!config_store || !config_store->hasWiFi()) {
        Serial.println("[WIFI] No stored credentials");
        return false;
    }

    String ssid = config_store->getWiFiSSID();
    String password = config_store->getWiFiPassword();

    return connect(ssid, password, false);
}

bool WiFiProvisioner::connect(const String& ssid, const String& password, bool save_credentials) {
    Serial.printf("[WIFI] Connecting to '%s'...\n", ssid.c_str());

    // Avoid writing WiFi credentials to flash; preserve stored settings
    WiFi.persistent(false);

    // Disconnect from any current network
    WiFi.disconnect(false);
    delay(100);

    // Set station mode
    WiFi.mode(WIFI_STA);

    // Ensure reliable DNS resolution when using DHCP
    WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE,
                IPAddress(1, 1, 1, 1), IPAddress(8, 8, 8, 8));
    WiFi.begin(ssid.c_str(), password.c_str());

    // Wait for connection with timeout
    unsigned long start_time = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - start_time > WIFI_CONNECT_TIMEOUT_MS) {
            Serial.println("\n[WIFI] Connection timeout");
            return false;
        }
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.printf("[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());

    // Save credentials on successful connection
    if (save_credentials && config_store) {
        config_store->setWiFiCredentials(ssid, password);
    }

    // Notify callback
    if (connection_callback) {
        connection_callback(true);
    }

    return true;
}

void WiFiProvisioner::startAPWithSmartConfig() {
    Serial.println("[WIFI] Starting AP mode...");

    // Avoid persisting or wiping credentials during AP setup
    WiFi.persistent(false);

    // If we don't have scan results yet, do a quick scan first
    // This ensures the web interface has networks to show
    if (scanned_network_count <= 0) {
        Serial.println("[WIFI] No cached scan results, scanning now...");
        WiFi.mode(WIFI_STA);
        delay(100);
        scanNetworks();
    }

    // Fully reset WiFi (without erasing stored credentials)
    WiFi.disconnect(false);
    WiFi.softAPdisconnect(false);
    delay(100);

    // Use AP-only mode for maximum compatibility
    WiFi.mode(WIFI_AP);
    delay(500);

    // Configure AP settings before starting
    WiFi.softAPConfig(
        IPAddress(192, 168, 4, 1),    // AP IP
        IPAddress(192, 168, 4, 1),    // Gateway
        IPAddress(255, 255, 255, 0)   // Subnet
    );
    delay(100);

    // Start Access Point (open network - no password for easy setup)
    bool ap_result = WiFi.softAP(AP_SSID, nullptr, AP_CHANNEL, 0, AP_MAX_CONNECTIONS);

    if (ap_result) {
        ap_active = true;
        // Give AP time to fully initialize
        delay(1000);
        Serial.printf("[WIFI] AP started successfully!\n");
        Serial.printf("[WIFI] SSID: '%s' (open network)\n", AP_SSID);
        Serial.printf("[WIFI] IP: %s\n", WiFi.softAPIP().toString().c_str());
        Serial.printf("[WIFI] Channel: %d\n", AP_CHANNEL);
        Serial.printf("[WIFI] MAC: %s\n", WiFi.softAPmacAddress().c_str());
    } else {
        Serial.println("[WIFI] ERROR: Failed to start AP!");
        ap_active = false;
        return;
    }

    Serial.println("[WIFI] AP mode ready");
}

void WiFiProvisioner::stopProvisioning() {
    if (ap_active) {
        WiFi.softAPdisconnect(true);
        ap_active = false;
        Serial.println("[WIFI] AP stopped");
    }
}

void WiFiProvisioner::loop() {
    // No-op for AP-only provisioning
}

bool WiFiProvisioner::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

bool WiFiProvisioner::isAPActive() const {
    return ap_active;
}

IPAddress WiFiProvisioner::getIPAddress() const {
    if (WiFi.status() == WL_CONNECTED) {
        return WiFi.localIP();
    }
    return WiFi.softAPIP();
}

IPAddress WiFiProvisioner::getAPIPAddress() const {
    return WiFi.softAPIP();
}

int WiFiProvisioner::scanNetworks() {
    LOG_FUNC_ENTRY(WIFI_TAG);
    LOG_INFO(WIFI_TAG, "Scanning networks...");
    
    // Delete any previous scan results
    WiFi.scanDelete();
    LOG_DEBUG(WIFI_TAG, "Previous scan results deleted");
    
    // Perform synchronous scan (blocking but reliable)
    // Pass false for async, true for show_hidden
    LOG_DEBUG(WIFI_TAG, "Starting synchronous scan (async=false, show_hidden=true)");
    int result = WiFi.scanNetworks(false, true);
    LOG_DEBUG(WIFI_TAG, "Scan returned: %d", result);
    
    if (result < 0) {
        // Error codes: -1 = scan already in progress, -2 = scan failed
        LOG_ERROR(WIFI_TAG, "Scan failed with error: %d", result);
        scanned_network_count = 0;
        return 0;
    }
    
    scanned_network_count = result;
    LOG_INFO(WIFI_TAG, "Found %d networks", scanned_network_count);
    
    // Log the networks found
    for (int i = 0; i < min(scanned_network_count, 10); i++) {
        LOG_DEBUG(WIFI_TAG, "  %d: %s (%d dBm, enc=%d)", 
                  i, WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.encryptionType(i));
    }
    
    LOG_FUNC_EXIT(WIFI_TAG);
    return scanned_network_count;
}

String WiFiProvisioner::getScannedSSID(int index) const {
    if (index < 0 || index >= scanned_network_count) {
        return "";
    }
    return WiFi.SSID(index);
}

int WiFiProvisioner::getScannedRSSI(int index) const {
    if (index < 0 || index >= scanned_network_count) {
        return 0;
    }
    return WiFi.RSSI(index);
}

bool WiFiProvisioner::isScannedNetworkEncrypted(int index) const {
    if (index < 0 || index >= scanned_network_count) {
        return true;
    }
    return WiFi.encryptionType(index) != WIFI_AUTH_OPEN;
}

int WiFiProvisioner::getScannedNetworkCount() const {
    return scanned_network_count;
}

bool WiFiProvisioner::isNetworkInScanResults(const String& ssid) const {
    for (int i = 0; i < scanned_network_count; i++) {
        if (WiFi.SSID(i) == ssid) {
            Serial.printf("[WIFI] Network '%s' found in scan (signal: %d dBm)\n", 
                          ssid.c_str(), WiFi.RSSI(i));
            return true;
        }
    }
    Serial.printf("[WIFI] Network '%s' NOT found in scan results\n", ssid.c_str());
    return false;
}

void WiFiProvisioner::setConnectionCallback(ConnectionCallback callback) {
    connection_callback = callback;
}
