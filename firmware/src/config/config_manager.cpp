/**
 * @file config_manager.cpp
 * @brief NVS-based Configuration Manager - Core Lifecycle Implementation
 */

#include "config_manager.h"
#include "config_macros.h"
#include "common/lookup_tables.h"
#include <ArduinoJson.h>
#include <cstring>
#ifndef NATIVE_BUILD
#include <esp_random.h>
#else
#include <cstdlib>
#endif
#if __has_include("secrets.h")
#include "secrets.h"
#endif

// ESP-specific headers only for actual ESP32 builds
#ifndef NATIVE_BUILD
#include <esp_partition.h>
#include <esp_ota_ops.h>
#endif

#include "../debug/log_system.h"

static const char* TAG = "CONFIG";

ConfigManager::ConfigManager()
    : initialized(false), cached_token_expiry(0), cached_poll_interval(DEFAULT_POLL_INTERVAL),
      cached_brightness(DEFAULT_BRIGHTNESS), cached_scroll_speed_ms(DEFAULT_SCROLL_SPEED_MS),
      cached_page_interval_ms(DEFAULT_PAGE_INTERVAL_MS), cached_sensor_page_enabled(true),
      cached_border_width(DEFAULT_BORDER_WIDTH), cache_loaded(false) {
}

ConfigManager::~ConfigManager() {
    if (initialized) {
        preferences.end();
    }
}

bool ConfigManager::begin() {
    if (!preferences.begin(CONFIG_NAMESPACE, false)) {
        ESP_LOGE(TAG, "Failed to initialize NVS");
        return false;
    }

    initialized = true;
    loadCache();
    migrateLegacyOtaUrl();

#if defined(WEBEX_CLIENT_ID) && defined(WEBEX_CLIENT_SECRET)
    if (cached_client_id.isEmpty() || cached_client_secret.isEmpty()) {
        if (std::strlen(WEBEX_CLIENT_ID) > 0 && std::strlen(WEBEX_CLIENT_SECRET) > 0) {
            setWebexCredentials(String(WEBEX_CLIENT_ID), String(WEBEX_CLIENT_SECRET));
            ESP_LOGI(TAG, "Loaded Webex credentials from build environment");
        }
    }
#endif

#if defined(MQTT_BROKER)
    if (!hasMQTTConfig()) {
        if (std::strlen(MQTT_BROKER) > 0) {
            String topic = getMQTTTopic();
            setMQTTConfig(
                String(MQTT_BROKER),
                MQTT_PORT,
                String(MQTT_USERNAME),
                String(MQTT_PASSWORD),
                topic
            );
            ESP_LOGI(TAG, "Loaded MQTT config from build environment");
        }
    }
#endif

    ESP_LOGI(TAG, "Configuration loaded successfully");
    return true;
}

void ConfigManager::migrateLegacyOtaUrl() {
#ifdef DEFAULT_OTA_URL
    String stored_url = loadString("ota_url");
    if (stored_url.isEmpty()) {
        return;
    }
    String default_url = DEFAULT_OTA_URL;
    if (stored_url == default_url) {
        return;
    }

    bool is_legacy = stored_url == "https://api.github.com/repos/liptonj/Led-Matrix-Webex/releases/latest"
        || stored_url == "https://display.5ls.us/updates/manifest.json"
        || stored_url == "https://display.5ls.us/manifest.json";  // Legacy URL

    if (!is_legacy) {
        return;
    }

    saveString("ota_url", default_url);
    ESP_LOGI(TAG, "OTA URL migrated to %s", default_url.c_str());
#endif
}

void ConfigManager::loadCache() const {
    cached_ssid = loadString("wifi_ssid");
    cached_password = loadString("wifi_pass");
    cached_device_name = loadString("device_name", DEFAULT_DEVICE_NAME);
    cached_display_name = loadString("display_name");
    cached_device_uuid = loadString("device_uuid");
    cached_user_uuid = loadString("user_uuid");
    cached_last_webex_status = loadString("lst_webex_st");
    cached_client_id = loadString("webex_client");
    cached_client_secret = loadString("webex_secret");
    cached_access_token = loadString("webex_access");
    cached_refresh_token = loadString("webex_refresh");
    cached_token_expiry = loadUInt("webex_expiry", 0);
    cached_poll_interval = loadUInt("poll_interval", DEFAULT_POLL_INTERVAL);
    cached_brightness = loadUInt("brightness", DEFAULT_BRIGHTNESS);
    cached_scroll_speed_ms = loadUInt("scroll_speed_ms", DEFAULT_SCROLL_SPEED_MS);
    cached_page_interval_ms = loadUInt("page_interval", DEFAULT_PAGE_INTERVAL_MS);
    cached_sensor_page_enabled = loadBool("sensor_page", true);
    cached_display_pages = loadString("display_pages", "");
    cached_status_layout = loadString("status_layout", DEFAULT_STATUS_LAYOUT);
    cached_border_width = loadUInt("border_width", DEFAULT_BORDER_WIDTH);
    cached_date_color = loadString("date_color", DEFAULT_DATE_COLOR);
    cached_time_color = loadString("time_color", DEFAULT_TIME_COLOR);
    cached_name_color = loadString("name_color", DEFAULT_NAME_COLOR);
    cached_metric_color = loadString("metric_color", DEFAULT_METRIC_COLOR);

    // Load MQTT config using existing preferences handle
    cached_mqtt_broker = loadString("mqtt_broker");
    cached_mqtt_port = loadUInt("mqtt_port", 1883);
    cached_mqtt_username = loadString("mqtt_user");
    cached_mqtt_password = loadString("mqtt_pass");
    cached_mqtt_topic = loadString("mqtt_topic");
    cached_mqtt_use_tls = loadBool("mqtt_tls", false);
    cached_sensor_macs = loadString("sensor_macs");
    cached_display_sensor_mac = loadString("display_sensor_mac");
    cached_display_metric = loadString("display_metric", "tvoc");

    // Load time config
    cached_time_zone = loadString("time_zone", "UTC");
    cached_ntp_server = loadString("ntp_server", "pool.ntp.org");
    cached_time_format = loadString("time_format", "24h");
    cached_date_format = loadString("date_format", "mdy");

    // Load Supabase config
    cached_supabase_url = loadString("supabase_url", "");
    cached_supabase_anon_key = loadString("supabase_anon", "");
    cached_user_uuid = loadString("user_uuid", "");
    cached_device_uuid = loadString("device_uuid", "");
    cached_tls_verify = loadBool("tls_verify", true);
    
    // Load debug flags
    cached_debug_display = loadBool("debug_display", false);
    cached_debug_realtime = loadBool("debug_realtime", false);

    cache_loaded = true;
}

void ConfigManager::factoryReset() {
    ESP_LOGI(TAG, "=========================================");
    ESP_LOGI(TAG, "PERFORMING FULL FACTORY RESET");
    ESP_LOGI(TAG, "=========================================");
    ESP_LOGI(TAG, "Note: Device credentials are preserved");

    // Step 1: Clear main configuration namespace (webex-display)
    // This clears: WiFi, Webex tokens, MQTT, display settings, etc.
    // This preserves: device_auth (device secret/serial for Supabase auth)
    ESP_LOGI(TAG, "Step 1: Clearing configuration...");
    preferences.clear();
    cache_loaded = false;
    loadCache();
    ESP_LOGI(TAG, "✓ Configuration cleared");
    
    // Step 1b: Clear other namespaces (but NOT device_auth)
    {
        Preferences prefs;
        // Clear pairing code
        if (prefs.begin("pairing", false)) {
            prefs.clear();
            prefs.end();
            ESP_LOGI(TAG, "✓ Pairing code cleared");
        }
        // Clear boot counter
        if (prefs.begin("boot", false)) {
            prefs.clear();
            prefs.end();
            ESP_LOGI(TAG, "✓ Boot counter cleared");
        }
        // Clear module preferences
        if (prefs.begin("modules", false)) {
            prefs.clear();
            prefs.end();
            ESP_LOGI(TAG, "✓ Module preferences cleared");
        }
        // Note: "device_auth" namespace is intentionally NOT cleared
        // to preserve device credentials for Supabase authentication
    }

#ifndef NATIVE_BUILD
    // ESP32-specific partition operations (not available in simulation)

    // Step 2: Erase OTA data partition (forces boot to factory partition)
    ESP_LOGI(TAG, "Step 2: Erasing OTA data partition...");
    const esp_partition_t* otadata_partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA,
        ESP_PARTITION_SUBTYPE_DATA_OTA,
        NULL
    );

    if (otadata_partition != NULL) {
        esp_err_t err = esp_partition_erase_range(otadata_partition, 0, otadata_partition->size);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "✓ OTA data erased - will boot to factory partition");
        } else {
            ESP_LOGW(TAG, "⚠ Failed to erase OTA data: %s", esp_err_to_name(err));
        }
    }

    // Step 3: Erase filesystem partition
    ESP_LOGI(TAG, "Step 3: Erasing filesystem partition...");
    const esp_partition_t* spiffs_partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA,
        ESP_PARTITION_SUBTYPE_DATA_SPIFFS,
        NULL
    );

    if (spiffs_partition != NULL) {
        esp_err_t err = esp_partition_erase_range(spiffs_partition, 0, spiffs_partition->size);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "✓ Filesystem erased");
        } else {
            ESP_LOGW(TAG, "⚠ Failed to erase filesystem: %s", esp_err_to_name(err));
        }
    }

    // Step 4: Optionally erase OTA partitions (free up space)
    ESP_LOGI(TAG, "Step 4: Erasing OTA partitions...");

    const esp_partition_t* ota_0 = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP,
        ESP_PARTITION_SUBTYPE_APP_OTA_0,
        NULL
    );

    if (ota_0 != NULL) {
        esp_err_t err = esp_partition_erase_range(ota_0, 0, ota_0->size);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "✓ OTA_0 partition erased");
        } else {
            ESP_LOGW(TAG, "⚠ Failed to erase OTA_0: %s", esp_err_to_name(err));
        }
    }

    const esp_partition_t* ota_1 = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP,
        ESP_PARTITION_SUBTYPE_APP_OTA_1,
        NULL
    );

    if (ota_1 != NULL) {
        esp_err_t err = esp_partition_erase_range(ota_1, 0, ota_1->size);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "✓ OTA_1 partition erased");
        } else {
            ESP_LOGW(TAG, "⚠ Failed to erase OTA_1: %s", esp_err_to_name(err));
        }
    }
#else
    ESP_LOGI(TAG, "Note: Partition erase skipped in simulation build");
#endif

    ESP_LOGI(TAG, "=========================================");
    ESP_LOGI(TAG, "FACTORY RESET COMPLETE");
    ESP_LOGI(TAG, "Device will reboot to bootstrap firmware");
    ESP_LOGI(TAG, "=========================================");
}

// Private helper methods

void ConfigManager::saveString(const char* key, const String& value) {
    if (!initialized) return;
    preferences.putString(key, value);
}

String ConfigManager::loadString(const char* key, const String& default_value) const {
    if (!initialized) return default_value;
    if (!preferences.isKey(key)) {
        return default_value;
    }
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

// Partition Version Tracking

String ConfigManager::getPartitionVersion(const String& partition_label) const {
    String key = "part_ver_" + partition_label;
    return loadString(key.c_str(), "");
}

void ConfigManager::setPartitionVersion(const String& partition_label, const String& version) {
    String key = "part_ver_" + partition_label;
    saveString(key.c_str(), version);
    ESP_LOGI(TAG, "Partition %s version set to %s", partition_label.c_str(), version.c_str());
}

void ConfigManager::clearPartitionVersion(const String& partition_label) {
    String key = "part_ver_" + partition_label;
    saveString(key.c_str(), "");
}

// Debug Configuration

CONFIG_UNCACHED_BOOL_GETTER(DebugMode, "debug_mode", false)

void ConfigManager::setDebugMode(bool enabled) {
    saveBool("debug_mode", enabled);
    ESP_LOGI(TAG, "Debug mode %s", enabled ? "enabled" : "disabled");
}

CONFIG_UNCACHED_BOOL_GETTER(PairingRealtimeDebug, "pairing_rt_debug", false)

void ConfigManager::setPairingRealtimeDebug(bool enabled) {
    saveBool("pairing_rt_debug", enabled);
    ESP_LOGI(TAG, "Pairing realtime debug %s", enabled ? "enabled" : "disabled");
}

CONFIG_CACHED_BOOL_GETTER(DebugDisplay, "debug_display", cached_debug_display, false)

void ConfigManager::setDebugDisplay(bool enabled) {
    saveBool("debug_display", enabled);
    cached_debug_display = enabled;
    ESP_LOGI(TAG, "Display debug %s", enabled ? "enabled" : "disabled");
}

CONFIG_CACHED_BOOL_GETTER(DebugRealtime, "debug_realtime", cached_debug_realtime, false)

void ConfigManager::setDebugRealtime(bool enabled) {
    saveBool("debug_realtime", enabled);
    cached_debug_realtime = enabled;
    ESP_LOGI(TAG, "Realtime debug %s", enabled ? "enabled" : "disabled");
}

// TLS Configuration

CONFIG_CACHED_BOOL_GETTER(TlsVerify, "tls_verify", cached_tls_verify, true)

void ConfigManager::setTlsVerify(bool enabled) {
    saveBool("tls_verify", enabled);
    cached_tls_verify = enabled;
    ESP_LOGI(TAG, "TLS verify %s", enabled ? "enabled" : "disabled");
}

// Pin Configuration

PinPreset ConfigManager::getPinPreset() const {
    if (!initialized) return getDefaultPresetForBoard();
    uint8_t preset = loadUInt("pin_preset", static_cast<uint8_t>(getDefaultPresetForBoard()));
    if (preset >= static_cast<uint8_t>(PinPreset::PRESET_COUNT)) {
        return getDefaultPresetForBoard();
    }
    return static_cast<PinPreset>(preset);
}

void ConfigManager::setPinPreset(PinPreset preset) {
    saveUInt("pin_preset", static_cast<uint8_t>(preset));
    cached_pin_preset = preset;
    ESP_LOGI(TAG, "Pin preset set to: %s", getPresetName(preset));
}

PinConfig ConfigManager::getCustomPins() const {
    if (!initialized || !hasCustomPins()) {
        return getDefaultPinsForBoard();
    }
    
    // Load custom pins from NVS (stored as comma-separated values)
    String pins_str = loadString("custom_pins", "");
    if (pins_str.isEmpty()) {
        return getDefaultPinsForBoard();
    }
    
    // Parse: "r1,g1,b1,r2,g2,b2,a,b,c,d,e,clk,lat,oe"
    PinConfig pins;
    int values[14];
    int idx = 0;
    int start = 0;
    
    for (int i = 0; i <= pins_str.length() && idx < 14; i++) {
        if (i == pins_str.length() || pins_str[i] == ',') {
            String val = pins_str.substring(start, i);
            values[idx++] = val.toInt();
            start = i + 1;
        }
    }
    
    if (idx == 14) {
        pins.r1 = values[0];  pins.g1 = values[1];  pins.b1 = values[2];
        pins.r2 = values[3];  pins.g2 = values[4];  pins.b2 = values[5];
        pins.a  = values[6];  pins.b  = values[7];  pins.c  = values[8];
        pins.d  = values[9];  pins.e  = values[10];
        pins.clk = values[11]; pins.lat = values[12]; pins.oe = values[13];
        return pins;
    }
    
    return getDefaultPinsForBoard();
}

void ConfigManager::setCustomPins(const PinConfig& pins) {
    // Store as comma-separated values
    String pins_str = String(pins.r1) + "," + String(pins.g1) + "," + String(pins.b1) + "," +
                      String(pins.r2) + "," + String(pins.g2) + "," + String(pins.b2) + "," +
                      String(pins.a)  + "," + String(pins.b)  + "," + String(pins.c)  + "," +
                      String(pins.d)  + "," + String(pins.e)  + "," +
                      String(pins.clk) + "," + String(pins.lat) + "," + String(pins.oe);
    
    saveString("custom_pins", pins_str);
    saveBool("has_custom_pins", true);
    cached_custom_pins = pins;
    cached_has_custom_pins = true;
    
    ESP_LOGI(TAG, "Custom pins saved");
}

PinConfig ConfigManager::getPinConfig() const {
    PinPreset preset = getPinPreset();
    if (preset == PinPreset::CUSTOM && hasCustomPins()) {
        return getCustomPins();
    }
    return getPinsForPreset(preset);
}

bool ConfigManager::hasCustomPins() const {
    if (!initialized) return false;
    return loadBool("has_custom_pins", false);
}

// API Token Configuration

String ConfigManager::getApiToken() {
    String token = loadString("api_token", "");
    if (token.isEmpty()) {
        // Generate a new token if none exists
        regenerateApiToken();
        token = loadString("api_token", "");
    }
    return token;
}

void ConfigManager::regenerateApiToken() {
    // Generate a 16-character hex token (64 bits of entropy)
    char token_chars[17];  // 16 hex chars + null terminator
    for (int i = 0; i < 8; i++) {
#ifndef NATIVE_BUILD
        uint32_t rand = esp_random();  // Cryptographically secure on ESP32
#else
        uint32_t rand = (uint32_t)std::rand();  // For testing only
#endif
        snprintf(&token_chars[i * 2], 3, "%02x", (rand >> 16) & 0xFF);
    }
    String token = String(token_chars);
    
    saveString("api_token", token);
    ESP_LOGI(TAG, "API token regenerated");
}
