/**
 * @file wifi_provisioner.cpp
 * @brief WiFi Provisioner Implementation
 */

#include "wifi_provisioner.h"

WiFiProvisioner::WiFiProvisioner()
    : config_store(nullptr)
    , ap_active(false)
    , smartconfig_active(false)
    , smartconfig_done(false)
    , smartconfig_start_time(0)
    , scanned_network_count(0)
    , connection_callback(nullptr) {
}

WiFiProvisioner::~WiFiProvisioner() {
    stopProvisioning();
}

void WiFiProvisioner::begin(ConfigStore* config) {
    config_store = config;
    Serial.println("[WIFI] Provisioner initialized");
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

    // Disconnect from any current network
    WiFi.disconnect(true);
    delay(100);

    // Set station mode
    WiFi.mode(WIFI_STA);
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

    // Fully reset WiFi
    WiFi.disconnect(true);
    WiFi.softAPdisconnect(true);
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

    // Skip SmartConfig for now - AP-only mode is more reliable
    // SmartConfig can be enabled later if needed
    smartconfig_active = false;
    smartconfig_done = false;
    smartconfig_start_time = 0;

    Serial.println("[WIFI] AP mode ready (SmartConfig disabled for reliability)");
}

void WiFiProvisioner::stopProvisioning() {
    if (smartconfig_active) {
        WiFi.stopSmartConfig();
        smartconfig_active = false;
        Serial.println("[WIFI] SmartConfig stopped");
    }

    if (ap_active) {
        WiFi.softAPdisconnect(true);
        ap_active = false;
        Serial.println("[WIFI] AP stopped");
    }
}

void WiFiProvisioner::loop() {
    // Check SmartConfig status
    if (smartconfig_active && !smartconfig_done) {
        if (WiFi.smartConfigDone()) {
            smartconfig_done = true;
            handleSmartConfigResult();
        } else if (millis() - smartconfig_start_time > SMARTCONFIG_TIMEOUT_MS) {
            // SmartConfig timeout - just keep AP running
            Serial.println("[WIFI] SmartConfig timeout, AP still active");
            WiFi.stopSmartConfig();
            smartconfig_active = false;
        }
    }
}

void WiFiProvisioner::handleSmartConfigResult() {
    Serial.println("[WIFI] SmartConfig received credentials!");

    // Wait for connection
    unsigned long start_time = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - start_time > WIFI_CONNECT_TIMEOUT_MS) {
            Serial.println("[WIFI] SmartConfig: Connection failed");
            return;
        }
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.printf("[WIFI] SmartConfig connected! IP: %s\n", WiFi.localIP().toString().c_str());

    // Save credentials
    if (config_store) {
        config_store->setWiFiCredentials(WiFi.SSID(), WiFi.psk());
    }

    // Stop provisioning mode
    stopProvisioning();

    // Switch to station-only mode
    WiFi.mode(WIFI_STA);

    // Notify callback
    if (connection_callback) {
        connection_callback(true);
    }
}

bool WiFiProvisioner::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

bool WiFiProvisioner::isAPActive() const {
    return ap_active;
}

bool WiFiProvisioner::isSmartConfigActive() const {
    return smartconfig_active && !smartconfig_done;
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
    Serial.println("[WIFI] Scanning networks...");
    scanned_network_count = WiFi.scanNetworks();
    Serial.printf("[WIFI] Found %d networks\n", scanned_network_count);
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

void WiFiProvisioner::setConnectionCallback(ConnectionCallback callback) {
    connection_callback = callback;
}
