/**
 * @file config_manager.h
 * @brief NVS-based Configuration Manager Header
 */

#ifndef CONFIG_MANAGER_H
#define CONFIG_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include "pin_config.h"

// Configuration namespace
#define CONFIG_NAMESPACE "webex-display"

// Default values
#define DEFAULT_POLL_INTERVAL 30    // seconds
#define MIN_POLL_INTERVAL 20        // seconds (rate limit safe)
#define MAX_POLL_INTERVAL 120       // seconds
#define DEFAULT_BRIGHTNESS 128      // 0-255
#define DEFAULT_SCROLL_SPEED_MS 250 // ms per step
#define DEFAULT_PAGE_INTERVAL_MS 5000 // ms between page switches
#define DEFAULT_BORDER_WIDTH 1      // 1-3 pixels for status border
#define DEFAULT_DEVICE_NAME "webex-display"
#define DEFAULT_DATE_COLOR "#00FFFF"
#define DEFAULT_TIME_COLOR "#FFFFFF"
#define DEFAULT_NAME_COLOR "#FFA500"
#define DEFAULT_METRIC_COLOR "#00BFFF"
#define DEFAULT_DISPLAY_PAGES "rotate"
#define DEFAULT_STATUS_LAYOUT "sensors"

/**
 * @brief Configuration Manager Class
 *
 * Handles persistent storage of configuration in ESP32 NVS.
 */
class ConfigManager {
public:
    ConfigManager();
    ~ConfigManager();

    /**
     * @brief Initialize the configuration manager
     * @return true on success
     */
    bool begin();

    // WiFi Configuration
    String getWiFiSSID() const;
    String getWiFiPassword() const;
    void setWiFiCredentials(const String& ssid, const String& password);
    bool hasWiFiCredentials() const;

    // Device Configuration
    String getDeviceName() const;
    void setDeviceName(const String& name);
    String getDisplayName() const;
    void setDisplayName(const String& name);
    uint8_t getBrightness() const;
    void setBrightness(uint8_t brightness);
    uint16_t getScrollSpeedMs() const;
    void setScrollSpeedMs(uint16_t speed_ms);
    uint16_t getPageIntervalMs() const;
    void setPageIntervalMs(uint16_t interval_ms);
    bool getSensorPageEnabled() const;
    void setSensorPageEnabled(bool enabled);
    String getDisplayPages() const;
    void setDisplayPages(const String& mode);
    String getStatusLayout() const;
    void setStatusLayout(const String& layout);
    uint8_t getBorderWidth() const;
    void setBorderWidth(uint8_t width);
    String getDateColor() const;
    void setDateColor(const String& color);
    String getTimeColor() const;
    void setTimeColor(const String& color);
    String getNameColor() const;
    void setNameColor(const String& color);
    String getMetricColor() const;
    void setMetricColor(const String& color);

    // Webex Configuration
    String getWebexClientId() const;
    String getWebexClientSecret() const;
    void setWebexCredentials(const String& client_id, const String& client_secret);
    bool hasWebexCredentials() const;

    String getWebexAccessToken() const;
    String getWebexRefreshToken() const;
    unsigned long getWebexTokenExpiry() const;
    void setWebexTokens(const String& access_token, const String& refresh_token, unsigned long expiry);
    bool hasWebexTokens() const;
    void clearWebexTokens();

    uint16_t getWebexPollInterval() const;
    void setWebexPollInterval(uint16_t seconds);

    // xAPI Configuration
    String getXAPIDeviceId() const;
    void setXAPIDeviceId(const String& device_id);
    bool hasXAPIDevice() const;
    uint16_t getXAPIPollInterval() const;
    void setXAPIPollInterval(uint16_t seconds);

    // MQTT Configuration
    String getMQTTBroker() const;
    uint16_t getMQTTPort() const;
    String getMQTTUsername() const;
    String getMQTTPassword() const;
    String getMQTTTopic() const;
    bool getMQTTUseTLS() const;
    String getSensorSerial() const;
    String getSensorMacs() const;
    String getSensorMacsRaw() const;
    String getDisplaySensorMac() const;
    String getDisplayMetric() const;
    void setMQTTConfig(const String& broker, uint16_t port,
                       const String& username, const String& password,
                       const String& topic, bool use_tls = false);
    void updateMQTTConfig(const String& broker, uint16_t port,
                          const String& username, const String& password,
                          bool updatePassword, const String& topic, bool use_tls = false);
    void setMQTTUseTLS(bool use_tls);
    void setSensorSerial(const String& serial);
    void setSensorMacs(const String& macs);
    void setDisplaySensorMac(const String& mac);
    void setDisplayMetric(const String& metric);
    bool hasMQTTConfig() const;

    // OTA Configuration
    String getOTAUrl() const;
    void setOTAUrl(const String& url);
    bool getAutoUpdate() const;
    void setAutoUpdate(bool enabled);
    String getFailedOTAVersion() const;
    void setFailedOTAVersion(const String& version);
    void clearFailedOTAVersion();

    // Supabase Configuration
    String getSupabaseUrl() const;
    void setSupabaseUrl(const String& url);
    String getSupabaseAnonKey() const;
    void setSupabaseAnonKey(const String& key);

    // Partition Version Tracking (for OTA version display)
    String getPartitionVersion(const String& partition_label) const;
    void setPartitionVersion(const String& partition_label, const String& version);
    void clearPartitionVersion(const String& partition_label);

    // Debug Configuration
    bool getDebugMode() const;
    void setDebugMode(bool enabled);
    bool getPairingRealtimeDebug() const;
    void setPairingRealtimeDebug(bool enabled);
    bool getDebugDisplay() const;
    void setDebugDisplay(bool enabled);
    bool getDebugRealtime() const;
    void setDebugRealtime(bool enabled);

    // TLS Configuration
    bool getTlsVerify() const;
    void setTlsVerify(bool enabled);

    // Pin Configuration (for HUB75 display adapter)
    PinPreset getPinPreset() const;
    void setPinPreset(PinPreset preset);
    PinConfig getCustomPins() const;
    void setCustomPins(const PinConfig& pins);
    PinConfig getPinConfig() const;  // Returns effective pins (preset or custom)
    bool hasCustomPins() const;

    // Time Configuration
    String getTimeZone() const;
    void setTimeZone(const String& time_zone);
    String getNtpServer() const;
    void setNtpServer(const String& server);
    String getTimeFormat() const;
    void setTimeFormat(const String& format);
    bool use24HourTime() const;
    String getDateFormat() const;
    void setDateFormat(const String& format);
    uint8_t getDateFormatCode() const;

    // Factory reset
    void factoryReset();

    // Export/Import configuration as JSON
    String exportConfig() const;
    bool importConfig(const String& json);

private:
    mutable Preferences preferences;  // mutable to allow const getter methods
    bool initialized;

    // Cached values for faster access
    mutable String cached_ssid;
    mutable String cached_password;
    mutable String cached_device_name;
    mutable String cached_display_name;
    mutable String cached_client_id;
    mutable String cached_client_secret;
    mutable String cached_access_token;
    mutable String cached_refresh_token;
    mutable unsigned long cached_token_expiry;
    mutable uint16_t cached_poll_interval;
    mutable uint8_t cached_brightness;
    mutable uint16_t cached_scroll_speed_ms;
    mutable uint16_t cached_page_interval_ms;
    mutable bool cached_sensor_page_enabled;
    mutable String cached_display_pages;
    mutable String cached_status_layout;
    mutable uint8_t cached_border_width;
    mutable String cached_date_color;
    mutable String cached_time_color;
    mutable String cached_name_color;
    mutable String cached_metric_color;
    mutable String cached_mqtt_broker;
    mutable uint16_t cached_mqtt_port;
    mutable String cached_mqtt_username;
    mutable String cached_mqtt_password;
    mutable String cached_mqtt_topic;
    mutable bool cached_mqtt_use_tls;
    mutable String cached_sensor_macs;
    mutable String cached_display_sensor_mac;
    mutable String cached_display_metric;
    mutable String cached_time_zone;
    mutable String cached_ntp_server;
    mutable String cached_time_format;
    mutable String cached_date_format;
    mutable String cached_supabase_url;
    mutable String cached_supabase_anon_key;
    mutable bool cached_tls_verify;
    mutable bool cached_debug_display;
    mutable bool cached_debug_realtime;
    mutable PinPreset cached_pin_preset;
    mutable PinConfig cached_custom_pins;
    mutable bool cached_has_custom_pins;
    mutable bool cache_loaded;

    void loadCache() const;
    void saveString(const char* key, const String& value);
    String loadString(const char* key, const String& default_value = "") const;
    void saveUInt(const char* key, uint32_t value);
    uint32_t loadUInt(const char* key, uint32_t default_value = 0) const;
    void saveBool(const char* key, bool value);
    bool loadBool(const char* key, bool default_value = false) const;
    void migrateLegacyOtaUrl();
};

#endif // CONFIG_MANAGER_H
