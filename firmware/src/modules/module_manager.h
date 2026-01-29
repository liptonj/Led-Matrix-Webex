/**
 * @file module_manager.h
 * @brief Module Manager for dynamic feature installation
 * 
 * Manages optional feature modules that can be installed/removed via OTA.
 * Each module is a separate firmware build that extends the core functionality.
 * 
 * Module Architecture:
 * - Core: WiFi, Display, Web Server, OTA, Module Manager (always present)
 * - Modules: Webex Polling, MQTT Sensors, xAPI, etc.
 */

#ifndef MODULE_MANAGER_H
#define MODULE_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include <vector>

// Module identifiers
#define MODULE_CORE           0x01  // Always installed
#define MODULE_WEBEX_POLLING  0x02  // Direct Webex API polling
#define MODULE_MQTT_SENSORS   0x04  // MQTT client for Meraki sensors
#define MODULE_XAPI_CLIENT    0x10  // RoomOS xAPI WebSocket
#define MODULE_EMBEDDED_APP   0x20  // Webex Embedded App (can be minimal)

// Current firmware's installed modules (set at compile time)
#ifndef INSTALLED_MODULES
#define INSTALLED_MODULES (MODULE_CORE | MODULE_EMBEDDED_APP)
#endif

/**
 * @brief Module information structure
 */
struct ModuleInfo {
    uint8_t id;
    const char* name;
    const char* description;
    const char* version;
    size_t size_kb;          // Approximate size in KB
    bool installed;          // Currently installed in firmware
    bool enabled;            // User-enabled (stored in preferences)
    const char* ota_filename; // Firmware filename for OTA
};

/**
 * @brief Available modules registry
 */
const ModuleInfo AVAILABLE_MODULES[] = {
    {
        MODULE_CORE,
        "core",
        "Core system (WiFi, Display, Web Server, OTA)",
        "1.0.0",
        180,
        true,  // Always installed
        true,  // Always enabled
        "firmware-core.bin"
    },
    {
        MODULE_EMBEDDED_APP,
        "embedded_app",
        "Webex Embedded App with configuration UI",
        "1.0.0",
        45,
        (INSTALLED_MODULES & MODULE_EMBEDDED_APP) != 0,
        true,
        "firmware-embedded.bin"
    },
    {
        MODULE_WEBEX_POLLING,
        "webex_polling",
        "Direct Webex API polling for presence status",
        "1.0.0",
        35,
        (INSTALLED_MODULES & MODULE_WEBEX_POLLING) != 0,
        true,
        "firmware-webex.bin"
    },
    {
        MODULE_MQTT_SENSORS,
        "mqtt_sensors",
        "MQTT client for Meraki MT sensor data",
        "1.0.0",
        25,
        (INSTALLED_MODULES & MODULE_MQTT_SENSORS) != 0,
        true,
        "firmware-mqtt.bin"
    },
    {
        MODULE_XAPI_CLIENT,
        "xapi_client",
        "RoomOS xAPI WebSocket for device control",
        "1.0.0",
        30,
        (INSTALLED_MODULES & MODULE_XAPI_CLIENT) != 0,
        true,
        "firmware-xapi.bin"
    }
};

const size_t AVAILABLE_MODULES_COUNT = sizeof(AVAILABLE_MODULES) / sizeof(ModuleInfo);

/**
 * @brief Firmware variant information
 */
struct FirmwareVariant {
    const char* name;
    const char* description;
    uint8_t modules;         // Bitmask of included modules
    const char* filename;
    size_t size_kb;
};

/**
 * @brief Pre-built firmware variants available for OTA
 */
const FirmwareVariant FIRMWARE_VARIANTS[] = {
    {
        "minimal",
        "Core only - WiFi, Display, Web Server",
        MODULE_CORE,
        "firmware-minimal.bin",
        180
    },
    {
        "embedded",
        "Core + Embedded App",
        MODULE_CORE | MODULE_EMBEDDED_APP,
        "firmware-embedded.bin",
        225
    },
    {
        "standard",
        "Core + Embedded App + Webex Polling",
        MODULE_CORE | MODULE_EMBEDDED_APP | MODULE_WEBEX_POLLING,
        "firmware-standard.bin",
        260
    },
    {
        "sensors",
        "Core + Embedded App + MQTT Sensors",
        MODULE_CORE | MODULE_EMBEDDED_APP | MODULE_MQTT_SENSORS,
        "firmware-sensors.bin",
        250
    },
    {
        "full",
        "All features included",
        MODULE_CORE | MODULE_EMBEDDED_APP | MODULE_WEBEX_POLLING | 
        MODULE_MQTT_SENSORS | MODULE_XAPI_CLIENT,
        "firmware-full.bin",
        330
    }
};

const size_t FIRMWARE_VARIANTS_COUNT = sizeof(FIRMWARE_VARIANTS) / sizeof(FirmwareVariant);

/**
 * @brief Module Manager Class
 * 
 * Handles module registration, status tracking, and OTA installation.
 */
class ModuleManager {
public:
    ModuleManager();
    
    /**
     * @brief Initialize the module manager
     * @return true on success
     */
    bool begin();
    
    /**
     * @brief Check if a module is installed in current firmware
     * @param module_id Module ID (MODULE_*)
     * @return true if installed
     */
    bool isInstalled(uint8_t module_id) const;
    
    /**
     * @brief Check if a module is enabled by user
     * @param module_id Module ID
     * @return true if enabled
     */
    bool isEnabled(uint8_t module_id) const;
    
    /**
     * @brief Enable or disable a module
     * @param module_id Module ID
     * @param enabled Enable state
     */
    void setEnabled(uint8_t module_id, bool enabled);
    
    /**
     * @brief Get installed modules bitmask
     * @return Bitmask of installed modules
     */
    uint8_t getInstalledModules() const;
    
    /**
     * @brief Get enabled modules bitmask
     * @return Bitmask of enabled modules
     */
    uint8_t getEnabledModules() const;
    
    /**
     * @brief Get module info by ID
     * @param module_id Module ID
     * @return Pointer to ModuleInfo or nullptr
     */
    const ModuleInfo* getModuleInfo(uint8_t module_id) const;
    
    /**
     * @brief Get firmware variant by name
     * @param name Variant name
     * @return Pointer to FirmwareVariant or nullptr
     */
    const FirmwareVariant* getVariant(const char* name) const;
    
    /**
     * @brief Get recommended variant based on enabled modules
     * @return Pointer to best matching FirmwareVariant
     */
    const FirmwareVariant* getRecommendedVariant() const;
    
    /**
     * @brief Get all available modules
     * @return Vector of ModuleInfo pointers
     */
    std::vector<const ModuleInfo*> getAllModules() const;
    
    /**
     * @brief Get all firmware variants
     * @return Vector of FirmwareVariant pointers
     */
    std::vector<const FirmwareVariant*> getAllVariants() const;
    
    /**
     * @brief Calculate total size of enabled modules
     * @return Size in KB
     */
    size_t calculateEnabledSize() const;
    
    /**
     * @brief Get current firmware variant name
     * @return Variant name or "custom"
     */
    String getCurrentVariant() const;

private:
    Preferences prefs;
    uint8_t enabled_modules;
    
    void loadPreferences();
    void savePreferences();
};

#endif // MODULE_MANAGER_H
