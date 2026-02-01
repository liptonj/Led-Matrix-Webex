/**
 * @file config_manager.cpp
 * @brief NVS-based Configuration Manager Implementation
 */

#include "config_manager.h"
#include "config_macros.h"
#include "common/lookup_tables.h"
#include <ArduinoJson.h>
#include <cstring>
#if __has_include("secrets.h")
#include "secrets.h"
#endif

// ESP-specific headers only for actual ESP32 builds
#ifndef NATIVE_BUILD
#include <esp_partition.h>
#include <esp_ota_ops.h>
#endif

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
        Serial.println("[CONFIG] Failed to initialize NVS!");
        return false;
    }

    initialized = true;
    loadCache();
    migrateLegacyOtaUrl();

#if defined(WEBEX_CLIENT_ID) && defined(WEBEX_CLIENT_SECRET)
    if (cached_client_id.isEmpty() || cached_client_secret.isEmpty()) {
        if (std::strlen(WEBEX_CLIENT_ID) > 0 && std::strlen(WEBEX_CLIENT_SECRET) > 0) {
            setWebexCredentials(String(WEBEX_CLIENT_ID), String(WEBEX_CLIENT_SECRET));
            Serial.println("[CONFIG] Loaded Webex credentials from build environment");
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
            Serial.println("[CONFIG] Loaded MQTT config from build environment");
        }
    }
#endif

    Serial.println("[CONFIG] Configuration loaded successfully");
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
    Serial.printf("[CONFIG] OTA URL migrated to %s\n", default_url.c_str());
#endif
}

void ConfigManager::loadCache() const {
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
    cached_tls_verify = loadBool("tls_verify", true);
    
    // Load debug flags
    cached_debug_display = loadBool("debug_display", false);
    cached_debug_realtime = loadBool("debug_realtime", false);

    cache_loaded = true;
}

// WiFi Configuration

CONFIG_CACHED_STRING_GETTER(WiFiSSID, "wifi_ssid", cached_ssid, "")
CONFIG_CACHED_STRING_GETTER(WiFiPassword, "wifi_pass", cached_password, "")

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

CONFIG_CACHED_STRING_GETTER(DeviceName, "device_name", cached_device_name, DEFAULT_DEVICE_NAME)

void ConfigManager::setDeviceName(const String& name) {
    saveString("device_name", name);
    cached_device_name = name;
}

CONFIG_CACHED_STRING_GETTER(DisplayName, "display_name", cached_display_name, "")

void ConfigManager::setDisplayName(const String& name) {
    saveString("display_name", name);
    cached_display_name = name;
}

CONFIG_CACHED_UINT8_GETTER(Brightness, "brightness", cached_brightness, DEFAULT_BRIGHTNESS)
CONFIG_CACHED_UINT8_SETTER(Brightness, "brightness", cached_brightness)

CONFIG_CACHED_UINT16_GETTER(ScrollSpeedMs, "scroll_speed_ms", cached_scroll_speed_ms, DEFAULT_SCROLL_SPEED_MS)
CONFIG_CACHED_UINT16_SETTER(ScrollSpeedMs, "scroll_speed_ms", cached_scroll_speed_ms)

CONFIG_CACHED_UINT16_GETTER(PageIntervalMs, "page_interval", cached_page_interval_ms, DEFAULT_PAGE_INTERVAL_MS)

void ConfigManager::setPageIntervalMs(uint16_t interval_ms) {
    // Enforce minimum of 3 seconds, maximum of 30 seconds
    if (interval_ms < 3000) {
        interval_ms = 3000;
    }
    if (interval_ms > 30000) {
        interval_ms = 30000;
    }
    saveUInt("page_interval", interval_ms);
    cached_page_interval_ms = interval_ms;
    Serial.printf("[CONFIG] Page interval set to %d ms\n", interval_ms);
}

CONFIG_CACHED_BOOL_GETTER(SensorPageEnabled, "sensor_page", cached_sensor_page_enabled, true)

void ConfigManager::setSensorPageEnabled(bool enabled) {
    saveBool("sensor_page", enabled);
    cached_sensor_page_enabled = enabled;
    cached_display_pages = enabled ? String("rotate") : String("status");
    saveString("display_pages", cached_display_pages);
    Serial.printf("[CONFIG] Sensor page %s\n", enabled ? "enabled" : "disabled");
}

String ConfigManager::getDisplayPages() const {
    String mode;
    if (!cache_loaded) {
        mode = loadString("display_pages", "");
    } else {
        mode = cached_display_pages;
    }
    mode.trim();
    mode.toLowerCase();
    if (mode.isEmpty()) {
        const bool sensor_enabled = cache_loaded ? cached_sensor_page_enabled : loadBool("sensor_page", true);
        return sensor_enabled ? String(DEFAULT_DISPLAY_PAGES) : String("status");
    }
    if (mode != "status" && mode != "sensors" && mode != "rotate") {
        mode = DEFAULT_DISPLAY_PAGES;
    }
    return mode;
}

void ConfigManager::setDisplayPages(const String& mode) {
    String normalized = mode;
    normalized.trim();
    normalized.toLowerCase();
    if (normalized != "status" && normalized != "sensors" && normalized != "rotate") {
        normalized = DEFAULT_DISPLAY_PAGES;
    }
    saveString("display_pages", normalized);
    cached_display_pages = normalized;
    cached_sensor_page_enabled = (normalized == "rotate");
    saveBool("sensor_page", cached_sensor_page_enabled);
    Serial.printf("[CONFIG] Display pages set to %s\n", normalized.c_str());
}

String ConfigManager::getStatusLayout() const {
    String layout;
    if (!cache_loaded) {
        layout = loadString("status_layout", DEFAULT_STATUS_LAYOUT);
    } else {
        layout = cached_status_layout;
    }
    layout.trim();
    layout.toLowerCase();
    if (layout != "name" && layout != "sensors") {
        layout = DEFAULT_STATUS_LAYOUT;
    }
    return layout;
}

void ConfigManager::setStatusLayout(const String& layout) {
    String normalized = layout;
    normalized.trim();
    normalized.toLowerCase();
    if (normalized != "name" && normalized != "sensors") {
        normalized = DEFAULT_STATUS_LAYOUT;
    }
    saveString("status_layout", normalized);
    cached_status_layout = normalized;
    Serial.printf("[CONFIG] Status layout set to %s\n", normalized.c_str());
}

CONFIG_CACHED_UINT8_GETTER(BorderWidth, "border_width", cached_border_width, DEFAULT_BORDER_WIDTH)

void ConfigManager::setBorderWidth(uint8_t width) {
    // Clamp to valid range: 1-3 pixels
    if (width < 1) width = 1;
    if (width > 3) width = 3;
    saveUInt("border_width", width);
    cached_border_width = width;
    Serial.printf("[CONFIG] Border width set to %d pixels\n", width);
}

CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(DateColor, "date_color", cached_date_color, DEFAULT_DATE_COLOR)
CONFIG_CACHED_STRING_SETTER(DateColor, "date_color", cached_date_color)

CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(TimeColor, "time_color", cached_time_color, DEFAULT_TIME_COLOR)
CONFIG_CACHED_STRING_SETTER(TimeColor, "time_color", cached_time_color)

CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(NameColor, "name_color", cached_name_color, DEFAULT_NAME_COLOR)
CONFIG_CACHED_STRING_SETTER(NameColor, "name_color", cached_name_color)

CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(MetricColor, "metric_color", cached_metric_color, DEFAULT_METRIC_COLOR)
CONFIG_CACHED_STRING_SETTER(MetricColor, "metric_color", cached_metric_color)

// Webex Configuration

CONFIG_CACHED_STRING_GETTER(WebexClientId, "webex_client", cached_client_id, "")
CONFIG_CACHED_STRING_GETTER(WebexClientSecret, "webex_secret", cached_client_secret, "")

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

CONFIG_CACHED_STRING_GETTER(WebexAccessToken, "webex_access", cached_access_token, "")
CONFIG_CACHED_STRING_GETTER(WebexRefreshToken, "webex_refresh", cached_refresh_token, "")
CONFIG_CACHED_ULONG_GETTER(WebexTokenExpiry, "webex_expiry", cached_token_expiry, 0)

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

CONFIG_CACHED_UINT16_GETTER(WebexPollInterval, "poll_interval", cached_poll_interval, DEFAULT_POLL_INTERVAL)

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

CONFIG_UNCACHED_STRING_GETTER(XAPIDeviceId, "xapi_device", "")
CONFIG_UNCACHED_STRING_SETTER(XAPIDeviceId, "xapi_device")

bool ConfigManager::hasXAPIDevice() const {
    return !getXAPIDeviceId().isEmpty();
}

CONFIG_UNCACHED_UINT16_GETTER(XAPIPollInterval, "xapi_poll", 10)

void ConfigManager::setXAPIPollInterval(uint16_t seconds) {
    if (seconds < 5) seconds = 5;
    if (seconds > 60) seconds = 60;
    saveUInt("xapi_poll", seconds);
}

// MQTT Configuration

CONFIG_LAZY_CACHED_STRING_GETTER(MQTTBroker, cached_mqtt_broker)
CONFIG_LAZY_CACHED_UINT16_GETTER(MQTTPort, cached_mqtt_port)
CONFIG_LAZY_CACHED_STRING_GETTER(MQTTUsername, cached_mqtt_username)
CONFIG_LAZY_CACHED_STRING_GETTER(MQTTPassword, cached_mqtt_password)

String ConfigManager::getMQTTTopic() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_mqtt_topic.isEmpty() ? "meraki/v1/mt/#" : cached_mqtt_topic;
}

CONFIG_LAZY_CACHED_BOOL_GETTER(MQTTUseTLS, cached_mqtt_use_tls)

void ConfigManager::setMQTTConfig(const String& broker, uint16_t port,
                                  const String& username, const String& password,
                                  const String& topic, bool use_tls) {
    saveString("mqtt_broker", broker);
    saveUInt("mqtt_port", port);
    saveString("mqtt_user", username);
    saveString("mqtt_pass", password);
    saveString("mqtt_topic", topic);
    saveBool("mqtt_tls", use_tls);
    cached_mqtt_broker = broker;
    cached_mqtt_port = port;
    cached_mqtt_username = username;
    cached_mqtt_password = password;
    cached_mqtt_topic = topic;
    cached_mqtt_use_tls = use_tls;
    Serial.printf("[CONFIG] MQTT config saved: %s:%d (TLS: %s)\n", broker.c_str(), port, use_tls ? "enabled" : "disabled");
}

void ConfigManager::updateMQTTConfig(const String& broker, uint16_t port,
                                     const String& username, const String& password,
                                     bool updatePassword, const String& topic, bool use_tls) {
    // Always update broker (required field)
    saveString("mqtt_broker", broker);
    cached_mqtt_broker = broker;
    
    // Update port (always provided, even if same)
    saveUInt("mqtt_port", port);
    cached_mqtt_port = port;
    
    // Update username (always provided, even if empty to clear it)
    saveString("mqtt_user", username);
    cached_mqtt_username = username;
    
    // Only update password if explicitly provided
    if (updatePassword) {
        saveString("mqtt_pass", password);
        cached_mqtt_password = password;
    }
    // else: password remains unchanged
    
    // Update topic (always provided)
    saveString("mqtt_topic", topic);
    cached_mqtt_topic = topic;
    
    // Update TLS setting
    saveBool("mqtt_tls", use_tls);
    cached_mqtt_use_tls = use_tls;
    
    Serial.printf("[CONFIG] MQTT config updated: %s:%d (TLS: %s, password %s)\n", 
                  cached_mqtt_broker.c_str(), cached_mqtt_port,
                  use_tls ? "enabled" : "disabled",
                  updatePassword ? "updated" : "unchanged");
}

void ConfigManager::setMQTTUseTLS(bool use_tls) {
    saveBool("mqtt_tls", use_tls);
    cached_mqtt_use_tls = use_tls;
    Serial.printf("[CONFIG] MQTT TLS %s\n", use_tls ? "enabled" : "disabled");
}

bool ConfigManager::hasMQTTConfig() const {
    return !getMQTTBroker().isEmpty();
}

CONFIG_UNCACHED_STRING_GETTER(SensorSerial, "sensor_serial", "")

void ConfigManager::setSensorSerial(const String& serial) {
    saveString("sensor_serial", serial);
    Serial.printf("[CONFIG] Sensor serial saved: %s\n", serial.c_str());
}

String ConfigManager::getSensorMacs() const {
    if (!cache_loaded) {
        loadCache();
    }
    if (!cached_sensor_macs.isEmpty()) {
        return cached_sensor_macs;
    }
    return getSensorSerial();
}

String ConfigManager::getSensorMacsRaw() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_sensor_macs;
}

String ConfigManager::getDisplaySensorMac() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_display_sensor_mac;
}

String ConfigManager::getDisplayMetric() const {
    if (!cache_loaded) {
        loadCache();
    }
    if (!cached_display_metric.isEmpty()) {
        return cached_display_metric;
    }
    return "tvoc";
}

void ConfigManager::setSensorMacs(const String& macs) {
    saveString("sensor_macs", macs);
    cached_sensor_macs = macs;
    if (!macs.isEmpty()) {
        saveString("sensor_serial", "");
    }
    Serial.printf("[CONFIG] Sensor MACs saved: %s\n", macs.c_str());
}

void ConfigManager::setDisplaySensorMac(const String& mac) {
    saveString("display_sensor_mac", mac);
    cached_display_sensor_mac = mac;
    Serial.printf("[CONFIG] Display sensor MAC saved: %s\n", mac.c_str());
}

void ConfigManager::setDisplayMetric(const String& metric) {
    saveString("display_metric", metric);
    cached_display_metric = metric;
    Serial.printf("[CONFIG] Display metric saved: %s\n", metric.c_str());
}

// OTA Configuration

String ConfigManager::getOTAUrl() const {
    String url = loadString("ota_url", "");
    if (url.isEmpty()) {
        // If Supabase URL is configured, use Supabase Edge Function for manifest
        // This allows firmware to point directly to Supabase instead of using a proxy
        String supabaseUrl = getSupabaseUrl();
        if (!supabaseUrl.isEmpty()) {
            return supabaseUrl + "/functions/v1/get-manifest";
        }
        // Fall back to build-time default (may also be Supabase URL if set during build)
        #ifdef DEFAULT_OTA_URL
        return DEFAULT_OTA_URL;
        #endif
    }
    return url;
}

void ConfigManager::setOTAUrl(const String& url) {
    saveString("ota_url", url);
}

// Supabase Configuration

String ConfigManager::getSupabaseUrl() const {
    String url;
    if (!cache_loaded) {
        url = loadString("supabase_url", "");
    } else {
        url = cached_supabase_url;
    }
    
    // Fall back to build-time default if not configured
    #ifdef DEFAULT_SUPABASE_URL
    if (url.isEmpty()) {
        return DEFAULT_SUPABASE_URL;
    }
    #endif
    
    return url;
}

void ConfigManager::setSupabaseUrl(const String& url) {
    saveString("supabase_url", url);
    cached_supabase_url = url;
    Serial.printf("[CONFIG] Supabase URL saved: %s\n", url.isEmpty() ? "(empty)" : url.c_str());
}

String ConfigManager::getSupabaseAnonKey() const {
    String key;
    if (!cache_loaded) {
        key = loadString("supabase_anon", "");
    } else {
        key = cached_supabase_anon_key;
    }
    
    // Fall back to build-time default if not configured
    #ifdef DEFAULT_SUPABASE_ANON_KEY
    if (key.isEmpty()) {
        return DEFAULT_SUPABASE_ANON_KEY;
    }
    #endif
    
    return key;
}

void ConfigManager::setSupabaseAnonKey(const String& key) {
    saveString("supabase_anon", key);
    cached_supabase_anon_key = key;
    Serial.printf("[CONFIG] Supabase anon key saved: %s\n", key.isEmpty() ? "(empty)" : "(set)");
}

CONFIG_UNCACHED_BOOL_GETTER(AutoUpdate, "auto_update", false)
CONFIG_UNCACHED_BOOL_SETTER(AutoUpdate, "auto_update")

CONFIG_UNCACHED_STRING_GETTER(FailedOTAVersion, "fail_ota_ver", "")

void ConfigManager::setFailedOTAVersion(const String& version) {
    saveString("fail_ota_ver", version);
}

void ConfigManager::clearFailedOTAVersion() {
    saveString("fail_ota_ver", "");
}

// Partition Version Tracking

String ConfigManager::getPartitionVersion(const String& partition_label) const {
    String key = "part_ver_" + partition_label;
    return loadString(key.c_str(), "");
}

void ConfigManager::setPartitionVersion(const String& partition_label, const String& version) {
    String key = "part_ver_" + partition_label;
    saveString(key.c_str(), version);
    Serial.printf("[CONFIG] Partition %s version set to %s\n", partition_label.c_str(), version.c_str());
}

void ConfigManager::clearPartitionVersion(const String& partition_label) {
    String key = "part_ver_" + partition_label;
    saveString(key.c_str(), "");
}

// Debug Configuration

CONFIG_UNCACHED_BOOL_GETTER(DebugMode, "debug_mode", false)

void ConfigManager::setDebugMode(bool enabled) {
    saveBool("debug_mode", enabled);
    Serial.printf("[CONFIG] Debug mode %s\n", enabled ? "enabled" : "disabled");
}

CONFIG_UNCACHED_BOOL_GETTER(PairingRealtimeDebug, "pairing_rt_debug", false)

void ConfigManager::setPairingRealtimeDebug(bool enabled) {
    saveBool("pairing_rt_debug", enabled);
    Serial.printf("[CONFIG] Pairing realtime debug %s\n", enabled ? "enabled" : "disabled");
}

CONFIG_CACHED_BOOL_GETTER(DebugDisplay, "debug_display", cached_debug_display, false)

void ConfigManager::setDebugDisplay(bool enabled) {
    saveBool("debug_display", enabled);
    cached_debug_display = enabled;
    Serial.printf("[CONFIG] Display debug %s\n", enabled ? "enabled" : "disabled");
}

CONFIG_CACHED_BOOL_GETTER(DebugRealtime, "debug_realtime", cached_debug_realtime, false)

void ConfigManager::setDebugRealtime(bool enabled) {
    saveBool("debug_realtime", enabled);
    cached_debug_realtime = enabled;
    Serial.printf("[CONFIG] Realtime debug %s\n", enabled ? "enabled" : "disabled");
}

// TLS Configuration

CONFIG_CACHED_BOOL_GETTER(TlsVerify, "tls_verify", cached_tls_verify, true)

void ConfigManager::setTlsVerify(bool enabled) {
    saveBool("tls_verify", enabled);
    cached_tls_verify = enabled;
    Serial.printf("[CONFIG] TLS verify %s\n", enabled ? "enabled" : "disabled");
}

// Time Configuration

CONFIG_CACHED_STRING_GETTER(TimeZone, "time_zone", cached_time_zone, "UTC")
CONFIG_CACHED_STRING_SETTER(TimeZone, "time_zone", cached_time_zone)

CONFIG_CACHED_STRING_GETTER(NtpServer, "ntp_server", cached_ntp_server, "pool.ntp.org")
CONFIG_CACHED_STRING_SETTER(NtpServer, "ntp_server", cached_ntp_server)

CONFIG_CACHED_STRING_GETTER(TimeFormat, "time_format", cached_time_format, "24h")
CONFIG_CACHED_STRING_SETTER(TimeFormat, "time_format", cached_time_format)

bool ConfigManager::use24HourTime() const {
    String format = getTimeFormat();
    format.toLowerCase();
    format.trim();
    // Use lookup table to check for 12-hour format
    return !TimeFormatLookup::is12HourFormat(format.c_str());
}

CONFIG_CACHED_STRING_GETTER(DateFormat, "date_format", cached_date_format, "mdy")
CONFIG_CACHED_STRING_SETTER(DateFormat, "date_format", cached_date_format)

uint8_t ConfigManager::getDateFormatCode() const {
    String format = getDateFormat();
    format.toLowerCase();
    format.trim();
    // Use lookup table for date format code
    return DateFormatLookup::getFormatCode(format.c_str());
}

// Factory Reset

void ConfigManager::factoryReset() {
    Serial.println("[CONFIG] =========================================");
    Serial.println("[CONFIG] PERFORMING FULL FACTORY RESET");
    Serial.println("[CONFIG] =========================================");
    Serial.println("[CONFIG] Note: Device credentials are preserved");

    // Step 1: Clear main configuration namespace (webex-display)
    // This clears: WiFi, Webex tokens, MQTT, display settings, etc.
    // This preserves: device_auth (device secret/serial for Supabase auth)
    Serial.println("[CONFIG] Step 1: Clearing configuration...");
    preferences.clear();
    cache_loaded = false;
    loadCache();
    Serial.println("[CONFIG] ✓ Configuration cleared");
    
    // Step 1b: Clear other namespaces (but NOT device_auth)
    {
        Preferences prefs;
        // Clear pairing code
        if (prefs.begin("pairing", false)) {
            prefs.clear();
            prefs.end();
            Serial.println("[CONFIG] ✓ Pairing code cleared");
        }
        // Clear boot counter
        if (prefs.begin("boot", false)) {
            prefs.clear();
            prefs.end();
            Serial.println("[CONFIG] ✓ Boot counter cleared");
        }
        // Clear module preferences
        if (prefs.begin("modules", false)) {
            prefs.clear();
            prefs.end();
            Serial.println("[CONFIG] ✓ Module preferences cleared");
        }
        // Note: "device_auth" namespace is intentionally NOT cleared
        // to preserve device credentials for Supabase authentication
    }

#ifndef NATIVE_BUILD
    // ESP32-specific partition operations (not available in simulation)

    // Step 2: Erase OTA data partition (forces boot to factory partition)
    Serial.println("[CONFIG] Step 2: Erasing OTA data partition...");
    const esp_partition_t* otadata_partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA,
        ESP_PARTITION_SUBTYPE_DATA_OTA,
        NULL
    );

    if (otadata_partition != NULL) {
        esp_err_t err = esp_partition_erase_range(otadata_partition, 0, otadata_partition->size);
        if (err == ESP_OK) {
            Serial.println("[CONFIG] ✓ OTA data erased - will boot to factory partition");
        } else {
            Serial.printf("[CONFIG] ⚠ Failed to erase OTA data: %s\n", esp_err_to_name(err));
        }
    }

    // Step 3: Erase filesystem partition
    Serial.println("[CONFIG] Step 3: Erasing filesystem partition...");
    const esp_partition_t* spiffs_partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA,
        ESP_PARTITION_SUBTYPE_DATA_SPIFFS,
        NULL
    );

    if (spiffs_partition != NULL) {
        esp_err_t err = esp_partition_erase_range(spiffs_partition, 0, spiffs_partition->size);
        if (err == ESP_OK) {
            Serial.println("[CONFIG] ✓ Filesystem erased");
        } else {
            Serial.printf("[CONFIG] ⚠ Failed to erase filesystem: %s\n", esp_err_to_name(err));
        }
    }

    // Step 4: Optionally erase OTA partitions (free up space)
    Serial.println("[CONFIG] Step 4: Erasing OTA partitions...");

    const esp_partition_t* ota_0 = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP,
        ESP_PARTITION_SUBTYPE_APP_OTA_0,
        NULL
    );

    if (ota_0 != NULL) {
        esp_err_t err = esp_partition_erase_range(ota_0, 0, ota_0->size);
        if (err == ESP_OK) {
            Serial.println("[CONFIG] ✓ OTA_0 partition erased");
        } else {
            Serial.printf("[CONFIG] ⚠ Failed to erase OTA_0: %s\n", esp_err_to_name(err));
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
            Serial.println("[CONFIG] ✓ OTA_1 partition erased");
        } else {
            Serial.printf("[CONFIG] ⚠ Failed to erase OTA_1: %s\n", esp_err_to_name(err));
        }
    }
#else
    Serial.println("[CONFIG] Note: Partition erase skipped in simulation build");
#endif

    Serial.println("[CONFIG] =========================================");
    Serial.println("[CONFIG] FACTORY RESET COMPLETE");
    Serial.println("[CONFIG] Device will reboot to bootstrap firmware");
    Serial.println("[CONFIG] =========================================");
}

// Export/Import Configuration

String ConfigManager::exportConfig() const {
    JsonDocument doc;

    doc["device_name"] = getDeviceName();
    doc["display_name"] = getDisplayName();
    doc["brightness"] = getBrightness();
    doc["scroll_speed_ms"] = getScrollSpeedMs();
    doc["page_interval_ms"] = getPageIntervalMs();
    doc["sensor_page_enabled"] = getSensorPageEnabled();
    doc["display_pages"] = getDisplayPages();
    doc["status_layout"] = getStatusLayout();
    doc["border_width"] = getBorderWidth();
    doc["date_color"] = getDateColor();
    doc["time_color"] = getTimeColor();
    doc["name_color"] = getNameColor();
    doc["metric_color"] = getMetricColor();
    doc["poll_interval"] = getWebexPollInterval();
    doc["xapi_poll"] = getXAPIPollInterval();
    doc["mqtt_broker"] = getMQTTBroker();
    doc["mqtt_port"] = getMQTTPort();
    doc["mqtt_topic"] = getMQTTTopic();
    doc["sensor_serial"] = getSensorSerial();
    doc["sensor_macs"] = getSensorMacsRaw();
    doc["display_sensor_mac"] = getDisplaySensorMac();
    doc["display_metric"] = getDisplayMetric();
    doc["ota_url"] = getOTAUrl();
    doc["auto_update"] = getAutoUpdate();
    doc["supabase_url"] = getSupabaseUrl();
    doc["supabase_anon_key"] = getSupabaseAnonKey();
    doc["time_zone"] = getTimeZone();
    doc["ntp_server"] = getNtpServer();
    doc["time_format"] = getTimeFormat();
    doc["date_format"] = getDateFormat();
    doc["pairing_realtime_debug"] = getPairingRealtimeDebug();
    doc["tls_verify"] = getTlsVerify();

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
    if (doc["scroll_speed_ms"].is<int>()) {
        setScrollSpeedMs(doc["scroll_speed_ms"].as<uint16_t>());
    }
    if (doc["page_interval_ms"].is<int>()) {
        setPageIntervalMs(doc["page_interval_ms"].as<uint16_t>());
    }
    if (doc["sensor_page_enabled"].is<bool>()) {
        setSensorPageEnabled(doc["sensor_page_enabled"].as<bool>());
    }
    if (doc["display_pages"].is<const char*>()) {
        setDisplayPages(doc["display_pages"].as<const char*>());
    }
    if (doc["status_layout"].is<const char*>()) {
        setStatusLayout(doc["status_layout"].as<const char*>());
    }
    if (doc["border_width"].is<int>()) {
        setBorderWidth(doc["border_width"].as<uint8_t>());
    }
    if (doc["date_color"].is<const char*>()) {
        setDateColor(doc["date_color"].as<const char*>());
    }
    if (doc["time_color"].is<const char*>()) {
        setTimeColor(doc["time_color"].as<const char*>());
    }
    if (doc["name_color"].is<const char*>()) {
        setNameColor(doc["name_color"].as<const char*>());
    }
    if (doc["metric_color"].is<const char*>()) {
        setMetricColor(doc["metric_color"].as<const char*>());
    }
    if (doc["poll_interval"].is<int>()) {
        setWebexPollInterval(doc["poll_interval"].as<uint16_t>());
    }
    if (doc["xapi_poll"].is<int>()) {
        setXAPIPollInterval(doc["xapi_poll"].as<uint16_t>());
    }
    if (doc["mqtt_broker"].is<const char*>()) {
        setMQTTConfig(
            doc["mqtt_broker"].as<const char*>(),
            doc["mqtt_port"] | 1883,
            doc["mqtt_username"] | "",
            doc["mqtt_password"] | "",
            doc["mqtt_topic"] | "meraki/v1/mt/#"
        );
    }
    if (doc["sensor_macs"].is<const char*>()) {
        setSensorMacs(doc["sensor_macs"].as<const char*>());
    } else if (doc["sensor_serial"].is<const char*>()) {
        setSensorSerial(doc["sensor_serial"].as<const char*>());
    }
    if (doc["display_sensor_mac"].is<const char*>()) {
        setDisplaySensorMac(doc["display_sensor_mac"].as<const char*>());
    }
    if (doc["display_metric"].is<const char*>()) {
        setDisplayMetric(doc["display_metric"].as<const char*>());
    }
    if (doc["ota_url"].is<const char*>()) {
        setOTAUrl(doc["ota_url"].as<const char*>());
    }
    if (doc["auto_update"].is<bool>()) {
        setAutoUpdate(doc["auto_update"].as<bool>());
    }
    if (doc["supabase_url"].is<const char*>()) {
        setSupabaseUrl(doc["supabase_url"].as<const char*>());
    }
    if (doc["supabase_anon_key"].is<const char*>()) {
        setSupabaseAnonKey(doc["supabase_anon_key"].as<const char*>());
    }
    if (doc["time_zone"].is<const char*>()) {
        setTimeZone(doc["time_zone"].as<const char*>());
    }
    if (doc["ntp_server"].is<const char*>()) {
        setNtpServer(doc["ntp_server"].as<const char*>());
    }
    if (doc["time_format"].is<const char*>()) {
        setTimeFormat(doc["time_format"].as<const char*>());
    }
    if (doc["date_format"].is<const char*>()) {
        setDateFormat(doc["date_format"].as<const char*>());
    }
    if (doc["pairing_realtime_debug"].is<bool>()) {
        setPairingRealtimeDebug(doc["pairing_realtime_debug"].as<bool>());
    }
    if (doc["tls_verify"].is<bool>()) {
        setTlsVerify(doc["tls_verify"].as<bool>());
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
