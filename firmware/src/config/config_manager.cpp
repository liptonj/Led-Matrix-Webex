/**
 * @file config_manager.cpp
 * @brief NVS-based Configuration Manager Implementation
 */

#include "config_manager.h"
#include <ArduinoJson.h>

ConfigManager::ConfigManager() 
    : initialized(false), cached_token_expiry(0), cached_poll_interval(DEFAULT_POLL_INTERVAL),
      cached_brightness(DEFAULT_BRIGHTNESS), cache_loaded(false) {
}

ConfigManager::~ConfigManager() {
    if (initialized) {
        preferences.end();
    }
}

bool ConfigManager::begin() {
    if (!preferences.begin(CONFIG_NAMESPACE, false)) {
        Serial.println("[CONFIG] Failed to initialize NVS!");
        return false;
    }
    
    initialized = true;
    loadCache();
    
    Serial.println("[CONFIG] Configuration loaded successfully");
    return true;
}

void ConfigManager::loadCache() {
    cached_ssid = loadString("wifi_ssid");
    cached_password = loadString("wifi_pass");
    cached_device_name = loadString("device_name", DEFAULT_DEVICE_NAME);
    cached_display_name = loadString("display_name");
    cached_client_id = loadString("webex_client");
    cached_client_secret = loadString("webex_secret");
    cached_access_token = loadString("webex_access");
    cached_refresh_token = loadString("webex_refresh");
    cached_token_expiry = loadUInt("webex_expiry", 0);
    cached_poll_interval = loadUInt("poll_interval", DEFAULT_POLL_INTERVAL);
    cached_brightness = loadUInt("brightness", DEFAULT_BRIGHTNESS);
    cache_loaded = true;
}

// WiFi Configuration

String ConfigManager::getWiFiSSID() const {
    if (!cache_loaded) {
        return loadString("wifi_ssid");
    }
    return cached_ssid;
}

String ConfigManager::getWiFiPassword() const {
    if (!cache_loaded) {
        return loadString("wifi_pass");
    }
    return cached_password;
}

void ConfigManager::setWiFiCredentials(const String& ssid, const String& password) {
    saveString("wifi_ssid", ssid);
    saveString("wifi_pass", password);
    cached_ssid = ssid;
    cached_password = password;
    Serial.printf("[CONFIG] WiFi credentials saved for SSID: %s\n", ssid.c_str());
}

bool ConfigManager::hasWiFiCredentials() const {
    return !getWiFiSSID().isEmpty();
}

// Device Configuration

String ConfigManager::getDeviceName() const {
    if (!cache_loaded) {
        return loadString("device_name", DEFAULT_DEVICE_NAME);
    }
    return cached_device_name;
}

void ConfigManager::setDeviceName(const String& name) {
    saveString("device_name", name);
    cached_device_name = name;
}

String ConfigManager::getDisplayName() const {
    if (!cache_loaded) {
        return loadString("display_name");
    }
    return cached_display_name;
}

void ConfigManager::setDisplayName(const String& name) {
    saveString("display_name", name);
    cached_display_name = name;
}

uint8_t ConfigManager::getBrightness() const {
    if (!cache_loaded) {
        return loadUInt("brightness", DEFAULT_BRIGHTNESS);
    }
    return cached_brightness;
}

void ConfigManager::setBrightness(uint8_t brightness) {
    saveUInt("brightness", brightness);
    cached_brightness = brightness;
}

// Webex Configuration

String ConfigManager::getWebexClientId() const {
    if (!cache_loaded) {
        return loadString("webex_client");
    }
    return cached_client_id;
}

String ConfigManager::getWebexClientSecret() const {
    if (!cache_loaded) {
        return loadString("webex_secret");
    }
    return cached_client_secret;
}

void ConfigManager::setWebexCredentials(const String& client_id, const String& client_secret) {
    saveString("webex_client", client_id);
    saveString("webex_secret", client_secret);
    cached_client_id = client_id;
    cached_client_secret = client_secret;
    Serial.println("[CONFIG] Webex credentials saved");
}

bool ConfigManager::hasWebexCredentials() const {
    return !getWebexClientId().isEmpty() && !getWebexClientSecret().isEmpty();
}

String ConfigManager::getWebexAccessToken() const {
    if (!cache_loaded) {
        return loadString("webex_access");
    }
    return cached_access_token;
}

String ConfigManager::getWebexRefreshToken() const {
    if (!cache_loaded) {
        return loadString("webex_refresh");
    }
    return cached_refresh_token;
}

unsigned long ConfigManager::getWebexTokenExpiry() const {
    if (!cache_loaded) {
        return loadUInt("webex_expiry", 0);
    }
    return cached_token_expiry;
}

void ConfigManager::setWebexTokens(const String& access_token, const String& refresh_token, unsigned long expiry) {
    saveString("webex_access", access_token);
    saveString("webex_refresh", refresh_token);
    saveUInt("webex_expiry", expiry);
    cached_access_token = access_token;
    cached_refresh_token = refresh_token;
    cached_token_expiry = expiry;
    Serial.println("[CONFIG] Webex tokens saved");
}

bool ConfigManager::hasWebexTokens() const {
    return !getWebexRefreshToken().isEmpty();
}

void ConfigManager::clearWebexTokens() {
    saveString("webex_access", "");
    saveString("webex_refresh", "");
    saveUInt("webex_expiry", 0);
    cached_access_token = "";
    cached_refresh_token = "";
    cached_token_expiry = 0;
    Serial.println("[CONFIG] Webex tokens cleared");
}

uint16_t ConfigManager::getWebexPollInterval() const {
    if (!cache_loaded) {
        return loadUInt("poll_interval", DEFAULT_POLL_INTERVAL);
    }
    return cached_poll_interval;
}

void ConfigManager::setWebexPollInterval(uint16_t seconds) {
    // Enforce minimum interval
    if (seconds < MIN_POLL_INTERVAL) {
        seconds = MIN_POLL_INTERVAL;
        Serial.printf("[CONFIG] Poll interval clamped to minimum: %d seconds\n", MIN_POLL_INTERVAL);
    }
    if (seconds > MAX_POLL_INTERVAL) {
        seconds = MAX_POLL_INTERVAL;
    }
    
    saveUInt("poll_interval", seconds);
    cached_poll_interval = seconds;
    Serial.printf("[CONFIG] Poll interval set to %d seconds\n", seconds);
}

// xAPI Configuration

String ConfigManager::getXAPIDeviceId() const {
    return loadString("xapi_device");
}

void ConfigManager::setXAPIDeviceId(const String& device_id) {
    saveString("xapi_device", device_id);
}

bool ConfigManager::hasXAPIDevice() const {
    return !getXAPIDeviceId().isEmpty();
}

uint16_t ConfigManager::getXAPIPollInterval() const {
    return loadUInt("xapi_poll", 10);
}

void ConfigManager::setXAPIPollInterval(uint16_t seconds) {
    if (seconds < 5) seconds = 5;
    if (seconds > 60) seconds = 60;
    saveUInt("xapi_poll", seconds);
}

// MQTT Configuration

String ConfigManager::getMQTTBroker() const {
    return loadString("mqtt_broker");
}

uint16_t ConfigManager::getMQTTPort() const {
    return loadUInt("mqtt_port", 1883);
}

String ConfigManager::getMQTTUsername() const {
    return loadString("mqtt_user");
}

String ConfigManager::getMQTTPassword() const {
    return loadString("mqtt_pass");
}

String ConfigManager::getMQTTTopic() const {
    return loadString("mqtt_topic", "meraki/v1/mt/#");
}

void ConfigManager::setMQTTConfig(const String& broker, uint16_t port,
                                  const String& username, const String& password,
                                  const String& topic) {
    saveString("mqtt_broker", broker);
    saveUInt("mqtt_port", port);
    saveString("mqtt_user", username);
    saveString("mqtt_pass", password);
    saveString("mqtt_topic", topic);
    Serial.printf("[CONFIG] MQTT config saved: %s:%d\n", broker.c_str(), port);
}

bool ConfigManager::hasMQTTConfig() const {
    return !getMQTTBroker().isEmpty();
}

// OTA Configuration

String ConfigManager::getOTAUrl() const {
    String url = loadString("ota_url", "");
    if (url.isEmpty()) {
        #ifdef DEFAULT_OTA_URL
        return DEFAULT_OTA_URL;
        #endif
    }
    return url;
}

void ConfigManager::setOTAUrl(const String& url) {
    saveString("ota_url", url);
}

bool ConfigManager::getAutoUpdate() const {
    return loadBool("auto_update", false);
}

void ConfigManager::setAutoUpdate(bool enabled) {
    saveBool("auto_update", enabled);
}

// Factory Reset

void ConfigManager::factoryReset() {
    Serial.println("[CONFIG] Performing factory reset...");
    preferences.clear();
    cache_loaded = false;
    loadCache();
    Serial.println("[CONFIG] Factory reset complete");
}

// Export/Import Configuration

String ConfigManager::exportConfig() const {
    JsonDocument doc;
    
    doc["device_name"] = getDeviceName();
    doc["display_name"] = getDisplayName();
    doc["brightness"] = getBrightness();
    doc["poll_interval"] = getWebexPollInterval();
    doc["xapi_poll"] = getXAPIPollInterval();
    doc["mqtt_broker"] = getMQTTBroker();
    doc["mqtt_port"] = getMQTTPort();
    doc["mqtt_topic"] = getMQTTTopic();
    doc["ota_url"] = getOTAUrl();
    doc["auto_update"] = getAutoUpdate();
    
    String output;
    serializeJson(doc, output);
    return output;
}

bool ConfigManager::importConfig(const String& json) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json.c_str());
    
    if (error) {
        Serial.printf("[CONFIG] Failed to parse config JSON: %s\n", error.c_str());
        return false;
    }
    
    if (doc["device_name"].is<const char*>()) {
        setDeviceName(doc["device_name"].as<const char*>());
    }
    if (doc["display_name"].is<const char*>()) {
        setDisplayName(doc["display_name"].as<const char*>());
    }
    if (doc["brightness"].is<int>()) {
        setBrightness(doc["brightness"].as<uint8_t>());
    }
    if (doc["poll_interval"].is<int>()) {
        setWebexPollInterval(doc["poll_interval"].as<uint16_t>());
    }
    if (doc["xapi_poll"].is<int>()) {
        setXAPIPollInterval(doc["xapi_poll"].as<uint16_t>());
    }
    
    Serial.println("[CONFIG] Configuration imported successfully");
    return true;
}

// Private helper methods

void ConfigManager::saveString(const char* key, const String& value) {
    if (!initialized) return;
    preferences.putString(key, value);
}

String ConfigManager::loadString(const char* key, const String& default_value) const {
    if (!initialized) return default_value;
    return preferences.getString(key, default_value);
}

void ConfigManager::saveUInt(const char* key, uint32_t value) {
    if (!initialized) return;
    preferences.putUInt(key, value);
}

uint32_t ConfigManager::loadUInt(const char* key, uint32_t default_value) const {
    if (!initialized) return default_value;
    return preferences.getUInt(key, default_value);
}

void ConfigManager::saveBool(const char* key, bool value) {
    if (!initialized) return;
    preferences.putBool(key, value);
}

bool ConfigManager::loadBool(const char* key, bool default_value) const {
    if (!initialized) return default_value;
    return preferences.getBool(key, default_value);
}
