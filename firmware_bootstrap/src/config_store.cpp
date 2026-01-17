/**
 * @file config_store.cpp
 * @brief NVS Configuration Store Implementation
 */

#include "config_store.h"

ConfigStore::ConfigStore()
    : initialized(false), cache_loaded(false) {
}

ConfigStore::~ConfigStore() {
    if (initialized) {
        preferences.end();
    }
}

bool ConfigStore::begin() {
    if (initialized) {
        return true;
    }

    if (!preferences.begin(CONFIG_NAMESPACE, false)) {
        Serial.println("[CONFIG] Failed to initialize NVS");
        return false;
    }

    initialized = true;
    loadCache();
    
    Serial.println("[CONFIG] Configuration store initialized");
    return true;
}

void ConfigStore::loadCache() const {
    if (cache_loaded || !initialized) {
        return;
    }

    cached_ssid = preferences.getString(KEY_WIFI_SSID, "");
    cached_password = preferences.getString(KEY_WIFI_PASS, "");
    cached_ota_url = preferences.getString(KEY_OTA_URL, "");
    cache_loaded = true;
}

bool ConfigStore::hasWiFi() const {
    loadCache();
    return !cached_ssid.isEmpty();
}

String ConfigStore::getWiFiSSID() const {
    loadCache();
    return cached_ssid;
}

String ConfigStore::getWiFiPassword() const {
    loadCache();
    return cached_password;
}

void ConfigStore::setWiFiCredentials(const String& ssid, const String& password) {
    if (!initialized) {
        Serial.println("[CONFIG] Error: Not initialized");
        return;
    }

    preferences.putString(KEY_WIFI_SSID, ssid);
    preferences.putString(KEY_WIFI_PASS, password);
    
    // Update cache
    cached_ssid = ssid;
    cached_password = password;
    
    Serial.printf("[CONFIG] WiFi credentials saved for SSID: %s\n", ssid.c_str());
}

String ConfigStore::getOTAUrl() const {
    loadCache();
    
    // Return cached URL if set, otherwise return default
    if (!cached_ota_url.isEmpty()) {
        return cached_ota_url;
    }
    
    #ifdef DEFAULT_OTA_URL
    return DEFAULT_OTA_URL;
    #else
    return "";
    #endif
}

void ConfigStore::setOTAUrl(const String& url) {
    if (!initialized) {
        Serial.println("[CONFIG] Error: Not initialized");
        return;
    }

    preferences.putString(KEY_OTA_URL, url);
    cached_ota_url = url;
    
    Serial.printf("[CONFIG] OTA URL saved: %s\n", url.c_str());
}

bool ConfigStore::hasCustomOTAUrl() const {
    loadCache();
    return !cached_ota_url.isEmpty();
}

void ConfigStore::clear() {
    if (!initialized) {
        return;
    }

    preferences.clear();
    
    // Clear cache
    cached_ssid = "";
    cached_password = "";
    cached_ota_url = "";
    
    Serial.println("[CONFIG] All configuration cleared");
}
