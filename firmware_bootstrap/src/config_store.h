/**
 * @file config_store.h
 * @brief NVS Configuration Store for Bootstrap Firmware
 * 
 * Minimal configuration storage for WiFi credentials and OTA URL.
 * Uses the same NVS namespace as the main firmware for compatibility.
 */

#ifndef CONFIG_STORE_H
#define CONFIG_STORE_H

#include <Arduino.h>
#include <Preferences.h>

// Use same namespace as main firmware for compatibility
#define CONFIG_NAMESPACE "webex-display"

// NVS Keys
#define KEY_WIFI_SSID "wifi_ssid"
#define KEY_WIFI_PASS "wifi_pass"
#define KEY_OTA_URL "ota_url"
#define KEY_BOOTSTRAP_OTA_PENDING "bootstrap_ota_pending"

/**
 * @brief Configuration Store Class
 * 
 * Provides persistent storage for bootstrap configuration using ESP32 NVS.
 */
class ConfigStore {
public:
    ConfigStore();
    ~ConfigStore();

    /**
     * @brief Initialize the configuration store
     * @return true on success
     */
    bool begin();

    /**
     * @brief Check if WiFi credentials are stored
     * @return true if SSID is configured
     */
    bool hasWiFi() const;

    /**
     * @brief Get stored WiFi SSID
     * @return SSID string (empty if not set)
     */
    String getWiFiSSID() const;

    /**
     * @brief Get stored WiFi password
     * @return Password string (empty if not set)
     */
    String getWiFiPassword() const;

    /**
     * @brief Save WiFi credentials
     * @param ssid Network SSID
     * @param password Network password
     */
    void setWiFiCredentials(const String& ssid, const String& password);

    /**
     * @brief Get OTA update URL
     * @return URL string (returns default if not set)
     */
    String getOTAUrl() const;

    /**
     * @brief Set custom OTA update URL
     * @param url GitHub releases API URL or direct firmware URL
     */
    void setOTAUrl(const String& url);

    /**
     * @brief Check if a custom OTA URL is configured
     * @return true if custom URL is set
     */
    bool hasCustomOTAUrl() const;

    /**
     * @brief Check if a bootstrap OTA is pending
     * @return true if pending
     */
    bool isBootstrapOtaPending() const;

    /**
     * @brief Set or clear bootstrap OTA pending flag
     * @param pending true to set, false to clear
     */
    void setBootstrapOtaPending(bool pending);

    /**
     * @brief Consume bootstrap OTA pending flag (read + clear)
     * @return true if flag was set
     */
    bool consumeBootstrapOtaPending();

    /**
     * @brief Clear all stored configuration
     */
    void ensureDefaults();

private:
    mutable Preferences preferences;  // mutable to allow getString in const methods
    bool initialized;

    // Cached values
    mutable String cached_ssid;
    mutable String cached_password;
    mutable String cached_ota_url;
    mutable bool cache_loaded;

    void loadCache() const;
};

#endif // CONFIG_STORE_H
