/**
 * @file delta_ota.h
 * @brief Delta/Differential OTA Update Support
 * 
 * Implements efficient OTA updates by only downloading the differences
 * between firmware versions rather than complete images.
 * 
 * Approaches supported:
 * 1. BSDiff patches - Binary diff patches (~10-30% of full size)
 * 2. Compressed full images - GZIP compressed firmware (~50-60% of full size)
 * 3. Module-only updates - For adding single modules
 * 
 * The server generates patches between firmware versions and the ESP32
 * applies them locally using the dehydrated update mechanism.
 */

#ifndef DELTA_OTA_H
#define DELTA_OTA_H

#include <Arduino.h>
#include <HTTPClient.h>
#include <Update.h>

/**
 * @brief OTA Update Type
 */
enum class OTAUpdateType {
    FULL_IMAGE,      // Complete firmware image
    COMPRESSED,      // GZIP compressed firmware
    DELTA_PATCH,     // BSDiff delta patch
    MODULE_ONLY      // Single module addition (requires base firmware)
};

/**
 * @brief OTA Update Manifest
 * 
 * Downloaded from server to determine best update path
 */
struct OTAManifest {
    String current_version;
    String target_version;
    String target_variant;
    
    // Available update paths (server provides multiple options)
    struct UpdatePath {
        OTAUpdateType type;
        String url;
        size_t size;
        String checksum;  // SHA256
        String base_version;  // For delta patches
    };
    
    UpdatePath paths[4];  // Up to 4 update paths
    uint8_t path_count;
    
    // Recommended path (smallest valid option)
    uint8_t recommended_path;
};

/**
 * @brief Delta OTA Manager
 */
class DeltaOTAManager {
public:
    DeltaOTAManager();
    
    /**
     * @brief Initialize the delta OTA manager
     * @param base_url Base URL for OTA server
     * @return true on success
     */
    bool begin(const String& base_url);
    
    /**
     * @brief Check for available updates
     * @param current_version Current firmware version
     * @param current_variant Current firmware variant
     * @param manifest Output manifest with update options
     * @return true if update available
     */
    bool checkForUpdates(const String& current_version, 
                         const String& current_variant,
                         OTAManifest& manifest);
    
    /**
     * @brief Get the best update path for a target variant
     * @param target_variant Desired variant to install
     * @param manifest Output manifest
     * @return true if path found
     */
    bool getUpdatePath(const String& target_variant, OTAManifest& manifest);
    
    /**
     * @brief Perform the OTA update using best available method
     * @param manifest Update manifest
     * @param progress_callback Optional progress callback (0-100)
     * @return true on success (will reboot)
     */
    bool performUpdate(const OTAManifest& manifest, 
                       void (*progress_callback)(int) = nullptr);
    
    /**
     * @brief Estimate download size for variant change
     * @param from_variant Current variant
     * @param to_variant Target variant
     * @return Estimated download size in bytes
     */
    size_t estimateDownloadSize(const String& from_variant, 
                                 const String& to_variant);
    
    /**
     * @brief Get last error message
     * @return Error message
     */
    String getLastError() const { return last_error; }

private:
    String base_url;
    String last_error;
    
    bool downloadAndApplyFull(const String& url, size_t size, 
                              void (*progress)(int));
    bool downloadAndApplyCompressed(const String& url, size_t size,
                                     void (*progress)(int));
    bool downloadAndApplyDelta(const String& url, size_t size,
                               const String& base_version,
                               void (*progress)(int));
    
    bool verifyChecksum(const String& expected);
    void setError(const String& error);
};

/**
 * @brief Module Delta Information
 * 
 * For module-level updates, we track what code is shared between variants
 * to enable smarter patching.
 */
struct ModuleDelta {
    uint8_t from_modules;   // Current installed modules bitmask
    uint8_t to_modules;     // Target modules bitmask
    uint8_t added_modules;  // Modules being added
    uint8_t removed_modules; // Modules being removed
    size_t estimated_patch_size;
};

/**
 * @brief Calculate module delta between variants
 * @param from_modules Current modules bitmask
 * @param to_modules Target modules bitmask
 * @return ModuleDelta with change information
 */
ModuleDelta calculateModuleDelta(uint8_t from_modules, uint8_t to_modules);

/**
 * @brief Estimate patch size based on module changes
 * 
 * Rough estimates based on typical module sizes:
 * - Adding a module: ~20-40 KB patch
 * - Removing a module: ~5-10 KB patch (mostly metadata)
 * - Same modules, version update: ~10-20 KB patch
 */
size_t estimatePatchSize(const ModuleDelta& delta);

#endif // DELTA_OTA_H
