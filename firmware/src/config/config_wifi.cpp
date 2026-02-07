/**
 * @file config_wifi.cpp
 * @brief WiFi Configuration Domain Implementation
 */

#include "config_manager.h"
#include "config_macros.h"
#include "../debug/log_system.h"

static const char* TAG = "CFG_WIFI";

// WiFi Configuration

CONFIG_CACHED_STRING_GETTER(WiFiSSID, "wifi_ssid", cached_ssid, "")
CONFIG_CACHED_STRING_GETTER(WiFiPassword, "wifi_pass", cached_password, "")

void ConfigManager::setWiFiCredentials(const String& ssid, const String& password) {
    saveString("wifi_ssid", ssid);
    saveString("wifi_pass", password);
    cached_ssid = ssid;
    cached_password = password;
    ESP_LOGI(TAG, "WiFi credentials saved for SSID: %s", ssid.c_str());
}

bool ConfigManager::hasWiFiCredentials() const {
    return !getWiFiSSID().isEmpty();
}
