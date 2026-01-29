/**
 * @file config_manager.cpp
 * @brief NVS-based Configuration Manager Implementation
 */

#include "config_manager.h"
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
      cache_loaded(false) {
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

    // Load MQTT config using existing preferences handle
    cached_mqtt_broker = loadString("mqtt_broker");
    cached_mqtt_port = loadUInt("mqtt_port", 1883);
    cached_mqtt_username = loadString("mqtt_user");
    cached_mqtt_password = loadString("mqtt_pass");
    cached_mqtt_topic = loadString("mqtt_topic");
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

uint16_t ConfigManager::getScrollSpeedMs() const {
    if (!cache_loaded) {
        return loadUInt("scroll_speed_ms", DEFAULT_SCROLL_SPEED_MS);
    }
    return cached_scroll_speed_ms;
}

void ConfigManager::setScrollSpeedMs(uint16_t speed_ms) {
    saveUInt("scroll_speed_ms", speed_ms);
    cached_scroll_speed_ms = speed_ms;
}

uint16_t ConfigManager::getPageIntervalMs() const {
    if (!cache_loaded) {
        return loadUInt("page_interval", DEFAULT_PAGE_INTERVAL_MS);
    }
    return cached_page_interval_ms;
}

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

bool ConfigManager::getSensorPageEnabled() const {
    if (!cache_loaded) {
        return loadBool("sensor_page", true);
    }
    return cached_sensor_page_enabled;
}

void ConfigManager::setSensorPageEnabled(bool enabled) {
    saveBool("sensor_page", enabled);
    cached_sensor_page_enabled = enabled;
    Serial.printf("[CONFIG] Sensor page %s\n", enabled ? "enabled" : "disabled");
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
    if (!cache_loaded) {
        loadCache();
    }
    return cached_mqtt_broker;
}

uint16_t ConfigManager::getMQTTPort() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_mqtt_port;
}

String ConfigManager::getMQTTUsername() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_mqtt_username;
}

String ConfigManager::getMQTTPassword() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_mqtt_password;
}

String ConfigManager::getMQTTTopic() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_mqtt_topic.isEmpty() ? "meraki/v1/mt/#" : cached_mqtt_topic;
}

void ConfigManager::setMQTTConfig(const String& broker, uint16_t port,
                                  const String& username, const String& password,
                                  const String& topic) {
    saveString("mqtt_broker", broker);
    saveUInt("mqtt_port", port);
    saveString("mqtt_user", username);
    saveString("mqtt_pass", password);
    saveString("mqtt_topic", topic);
    cached_mqtt_broker = broker;
    cached_mqtt_port = port;
    cached_mqtt_username = username;
    cached_mqtt_password = password;
    cached_mqtt_topic = topic;
    Serial.printf("[CONFIG] MQTT config saved: %s:%d\n", broker.c_str(), port);
}

bool ConfigManager::hasMQTTConfig() const {
    return !getMQTTBroker().isEmpty();
}

String ConfigManager::getSensorSerial() const {
    return loadString("sensor_serial");
}

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

bool ConfigManager::getAutoUpdate() const {
    return loadBool("auto_update", false);
}

void ConfigManager::setAutoUpdate(bool enabled) {
    saveBool("auto_update", enabled);
}

String ConfigManager::getFailedOTAVersion() const {
    return loadString("fail_ota_ver", "");
}

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

bool ConfigManager::getDebugMode() const {
    return loadBool("debug_mode", false);
}

void ConfigManager::setDebugMode(bool enabled) {
    saveBool("debug_mode", enabled);
    Serial.printf("[CONFIG] Debug mode %s\n", enabled ? "enabled" : "disabled");
}

bool ConfigManager::getPairingRealtimeDebug() const {
    return loadBool("pairing_rt_debug", false);
}

void ConfigManager::setPairingRealtimeDebug(bool enabled) {
    saveBool("pairing_rt_debug", enabled);
    Serial.printf("[CONFIG] Pairing realtime debug %s\n", enabled ? "enabled" : "disabled");
}

// TLS Configuration

bool ConfigManager::getTlsVerify() const {
    if (!cache_loaded) {
        return loadBool("tls_verify", true);
    }
    return cached_tls_verify;
}

void ConfigManager::setTlsVerify(bool enabled) {
    saveBool("tls_verify", enabled);
    cached_tls_verify = enabled;
    Serial.printf("[CONFIG] TLS verify %s\n", enabled ? "enabled" : "disabled");
}

// Time Configuration

String ConfigManager::getTimeZone() const {
    if (!cache_loaded) {
        return loadString("time_zone", "UTC");
    }
    return cached_time_zone;
}

void ConfigManager::setTimeZone(const String& time_zone) {
    saveString("time_zone", time_zone);
    cached_time_zone = time_zone;
}

String ConfigManager::getNtpServer() const {
    if (!cache_loaded) {
        return loadString("ntp_server", "pool.ntp.org");
    }
    return cached_ntp_server;
}

void ConfigManager::setNtpServer(const String& server) {
    saveString("ntp_server", server);
    cached_ntp_server = server;
}

String ConfigManager::getTimeFormat() const {
    if (!cache_loaded) {
        return loadString("time_format", "24h");
    }
    return cached_time_format;
}

void ConfigManager::setTimeFormat(const String& format) {
    saveString("time_format", format);
    cached_time_format = format;
}

bool ConfigManager::use24HourTime() const {
    String format = getTimeFormat();
    format.toLowerCase();
    format.trim();
    if (format == "12h" || format == "12" || format == "am/pm" || format == "ampm") {
        return false;
    }
    return true;
}

String ConfigManager::getDateFormat() const {
    if (!cache_loaded) {
        return loadString("date_format", "mdy");
    }
    return cached_date_format;
}

void ConfigManager::setDateFormat(const String& format) {
    saveString("date_format", format);
    cached_date_format = format;
}

uint8_t ConfigManager::getDateFormatCode() const {
    String format = getDateFormat();
    format.toLowerCase();
    format.trim();
    if (format == "dmy" || format == "dd/mm" || format == "dd-mm") {
        return 1;
    }
    if (format == "numeric" || format == "num" || format == "mm/dd" || format == "mm-dd") {
        return 2;
    }
    return 0;
}

// Factory Reset

void ConfigManager::factoryReset() {
    Serial.println("[CONFIG] =========================================");
    Serial.println("[CONFIG] PERFORMING FULL FACTORY RESET");
    Serial.println("[CONFIG] =========================================");

    // Step 1: Clear all NVS configuration
    Serial.println("[CONFIG] Step 1: Clearing NVS configuration...");
    preferences.clear();
    cache_loaded = false;
    loadCache();
    Serial.println("[CONFIG] ✓ NVS cleared");

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
