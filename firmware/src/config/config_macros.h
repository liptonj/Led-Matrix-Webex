/**
 * @file config_macros.h
 * @brief Helper macros for ConfigManager getter/setter deduplication
 * 
 * This file provides C++ preprocessor macros to eliminate repetitive code
 * in ConfigManager getter/setter methods. Each macro pattern handles a
 * specific type and caching strategy.
 */

#ifndef CONFIG_MACROS_H
#define CONFIG_MACROS_H

/**
 * @brief Macro for simple cached String getter
 * @param method_name Public method name (e.g., WiFiSSID)
 * @param nvs_key NVS storage key (e.g., "wifi_ssid")
 * @param cached_var Cached variable name (e.g., cached_ssid)
 * @param default_val Default value if not set (e.g., "")
 */
#define CONFIG_CACHED_STRING_GETTER(method_name, nvs_key, cached_var, default_val) \
    String ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            return loadString(nvs_key, default_val); \
        } \
        return cached_var; \
    }

/**
 * @brief Macro for simple cached String setter
 * @param method_name Public method name (e.g., WiFiSSID)
 * @param nvs_key NVS storage key (e.g., "wifi_ssid")
 * @param cached_var Cached variable name (e.g., cached_ssid)
 */
#define CONFIG_CACHED_STRING_SETTER(method_name, nvs_key, cached_var) \
    void ConfigManager::set##method_name(const String& value) { \
        saveString(nvs_key, value); \
        cached_var = value; \
    }

/**
 * @brief Macro for cached String getter with default fallback (for colors, etc.)
 * @param method_name Public method name (e.g., DateColor)
 * @param nvs_key NVS storage key (e.g., "date_color")
 * @param cached_var Cached variable name (e.g., cached_date_color)
 * @param default_const Default constant name (e.g., DEFAULT_DATE_COLOR)
 */
#define CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(method_name, nvs_key, cached_var, default_const) \
    String ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            return loadString(nvs_key, default_const); \
        } \
        return cached_var.isEmpty() ? String(default_const) : cached_var; \
    }

/**
 * @brief Macro for cached uint8_t getter
 * @param method_name Public method name (e.g., Brightness)
 * @param nvs_key NVS storage key (e.g., "brightness")
 * @param cached_var Cached variable name (e.g., cached_brightness)
 * @param default_const Default constant name (e.g., DEFAULT_BRIGHTNESS)
 */
#define CONFIG_CACHED_UINT8_GETTER(method_name, nvs_key, cached_var, default_const) \
    uint8_t ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            return loadUInt(nvs_key, default_const); \
        } \
        return cached_var; \
    }

/**
 * @brief Macro for cached uint8_t setter
 * @param method_name Public method name (e.g., Brightness)
 * @param nvs_key NVS storage key (e.g., "brightness")
 * @param cached_var Cached variable name (e.g., cached_brightness)
 */
#define CONFIG_CACHED_UINT8_SETTER(method_name, nvs_key, cached_var) \
    void ConfigManager::set##method_name(uint8_t value) { \
        saveUInt(nvs_key, value); \
        cached_var = value; \
    }

/**
 * @brief Macro for cached uint16_t getter
 * @param method_name Public method name (e.g., ScrollSpeedMs)
 * @param nvs_key NVS storage key (e.g., "scroll_speed_ms")
 * @param cached_var Cached variable name (e.g., cached_scroll_speed_ms)
 * @param default_const Default constant name (e.g., DEFAULT_SCROLL_SPEED_MS)
 */
#define CONFIG_CACHED_UINT16_GETTER(method_name, nvs_key, cached_var, default_const) \
    uint16_t ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            return loadUInt(nvs_key, default_const); \
        } \
        return cached_var; \
    }

/**
 * @brief Macro for cached uint16_t setter
 * @param method_name Public method name (e.g., ScrollSpeedMs)
 * @param nvs_key NVS storage key (e.g., "scroll_speed_ms")
 * @param cached_var Cached variable name (e.g., cached_scroll_speed_ms)
 */
#define CONFIG_CACHED_UINT16_SETTER(method_name, nvs_key, cached_var) \
    void ConfigManager::set##method_name(uint16_t value) { \
        saveUInt(nvs_key, value); \
        cached_var = value; \
    }

/**
 * @brief Macro for cached bool getter
 * @param method_name Public method name (e.g., SensorPageEnabled)
 * @param nvs_key NVS storage key (e.g., "sensor_page")
 * @param cached_var Cached variable name (e.g., cached_sensor_page_enabled)
 * @param default_val Default value (true/false)
 */
#define CONFIG_CACHED_BOOL_GETTER(method_name, nvs_key, cached_var, default_val) \
    bool ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            return loadBool(nvs_key, default_val); \
        } \
        return cached_var; \
    }

/**
 * @brief Macro for cached bool setter
 * @param method_name Public method name (e.g., SensorPageEnabled)
 * @param nvs_key NVS storage key (e.g., "sensor_page")
 * @param cached_var Cached variable name (e.g., cached_sensor_page_enabled)
 */
#define CONFIG_CACHED_BOOL_SETTER(method_name, nvs_key, cached_var) \
    void ConfigManager::set##method_name(bool value) { \
        saveBool(nvs_key, value); \
        cached_var = value; \
    }

/**
 * @brief Macro for cached unsigned long getter
 * @param method_name Public method name (e.g., WebexTokenExpiry)
 * @param nvs_key NVS storage key (e.g., "webex_expiry")
 * @param cached_var Cached variable name (e.g., cached_token_expiry)
 * @param default_val Default value (e.g., 0)
 */
#define CONFIG_CACHED_ULONG_GETTER(method_name, nvs_key, cached_var, default_val) \
    unsigned long ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            return loadUInt(nvs_key, default_val); \
        } \
        return cached_var; \
    }

/**
 * @brief Macro for uncached String getter (not in cache, direct NVS read)
 * @param method_name Public method name (e.g., XAPIDeviceId)
 * @param nvs_key NVS storage key (e.g., "xapi_device")
 * @param default_val Default value if not set (e.g., "")
 */
#define CONFIG_UNCACHED_STRING_GETTER(method_name, nvs_key, default_val) \
    String ConfigManager::get##method_name() const { \
        return loadString(nvs_key, default_val); \
    }

/**
 * @brief Macro for uncached String setter (not in cache, direct NVS write)
 * @param method_name Public method name (e.g., XAPIDeviceId)
 * @param nvs_key NVS storage key (e.g., "xapi_device")
 */
#define CONFIG_UNCACHED_STRING_SETTER(method_name, nvs_key) \
    void ConfigManager::set##method_name(const String& value) { \
        saveString(nvs_key, value); \
    }

/**
 * @brief Macro for uncached uint16_t getter
 * @param method_name Public method name (e.g., XAPIPollInterval)
 * @param nvs_key NVS storage key (e.g., "xapi_poll")
 * @param default_val Default value (e.g., 10)
 */
#define CONFIG_UNCACHED_UINT16_GETTER(method_name, nvs_key, default_val) \
    uint16_t ConfigManager::get##method_name() const { \
        return loadUInt(nvs_key, default_val); \
    }

/**
 * @brief Macro for uncached bool getter
 * @param method_name Public method name (e.g., AutoUpdate)
 * @param nvs_key NVS storage key (e.g., "auto_update")
 * @param default_val Default value (true/false)
 */
#define CONFIG_UNCACHED_BOOL_GETTER(method_name, nvs_key, default_val) \
    bool ConfigManager::get##method_name() const { \
        return loadBool(nvs_key, default_val); \
    }

/**
 * @brief Macro for uncached bool setter
 * @param method_name Public method name (e.g., AutoUpdate)
 * @param nvs_key NVS storage key (e.g., "auto_update")
 */
#define CONFIG_UNCACHED_BOOL_SETTER(method_name, nvs_key) \
    void ConfigManager::set##method_name(bool value) { \
        saveBool(nvs_key, value); \
    }

/**
 * @brief Macro for lazy-loaded cached String getter (loads cache on first access)
 * Used for MQTT settings that aren't loaded in initial cache
 * @param method_name Public method name (e.g., MQTTBroker)
 * @param cached_var Cached variable name (e.g., cached_mqtt_broker)
 */
#define CONFIG_LAZY_CACHED_STRING_GETTER(method_name, cached_var) \
    String ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            loadCache(); \
        } \
        return cached_var; \
    }

/**
 * @brief Macro for lazy-loaded cached uint16_t getter
 * @param method_name Public method name (e.g., MQTTPort)
 * @param cached_var Cached variable name (e.g., cached_mqtt_port)
 */
#define CONFIG_LAZY_CACHED_UINT16_GETTER(method_name, cached_var) \
    uint16_t ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            loadCache(); \
        } \
        return cached_var; \
    }

/**
 * @brief Macro for lazy-loaded cached bool getter
 * @param method_name Public method name (e.g., MQTTUseTLS)
 * @param cached_var Cached variable name (e.g., cached_mqtt_use_tls)
 */
#define CONFIG_LAZY_CACHED_BOOL_GETTER(method_name, cached_var) \
    bool ConfigManager::get##method_name() const { \
        if (!cache_loaded) { \
            loadCache(); \
        } \
        return cached_var; \
    }

#endif // CONFIG_MACROS_H
