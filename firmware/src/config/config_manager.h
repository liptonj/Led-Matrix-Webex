/**
 * @file config_manager.h
 * @brief NVS-based Configuration Manager Header
 */

#ifndef CONFIG_MANAGER_H
#define CONFIG_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>

// Configuration namespace
#define CONFIG_NAMESPACE "webex-display"

// Default values
#define DEFAULT_POLL_INTERVAL 30    // seconds
#define MIN_POLL_INTERVAL 20        // seconds (rate limit safe)
#define MAX_POLL_INTERVAL 120       // seconds
#define DEFAULT_BRIGHTNESS 128      // 0-255
#define DEFAULT_SCROLL_SPEED_MS 250 // ms per step
#define DEFAULT_DEVICE_NAME "webex-display"

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
    String getSensorSerial() const;
    void setMQTTConfig(const String& broker, uint16_t port,
                       const String& username, const String& password,
                       const String& topic);
    void setSensorSerial(const String& serial);
    bool hasMQTTConfig() const;

    // OTA Configuration
    String getOTAUrl() const;
    void setOTAUrl(const String& url);
    bool getAutoUpdate() const;
    void setAutoUpdate(bool enabled);

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
    mutable String cached_mqtt_broker;
    mutable uint16_t cached_mqtt_port;
    mutable String cached_mqtt_username;
    mutable String cached_mqtt_password;
    mutable String cached_mqtt_topic;
    mutable bool cache_loaded;

    void loadCache();
    void saveString(const char* key, const String& value);
    String loadString(const char* key, const String& default_value = "") const;
    void saveUInt(const char* key, uint32_t value);
    uint32_t loadUInt(const char* key, uint32_t default_value = 0) const;
    void saveBool(const char* key, bool value);
    bool loadBool(const char* key, bool default_value = false) const;
    void migrateLegacyOtaUrl();
};

#endif // CONFIG_MANAGER_H
