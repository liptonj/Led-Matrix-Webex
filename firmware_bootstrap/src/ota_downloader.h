/**
 * @file ota_downloader.h
 * @brief OTA Firmware Downloader
 * 
 * Downloads firmware from GitHub Releases and flashes it to the OTA partition.
 */

#ifndef OTA_DOWNLOADER_H
#define OTA_DOWNLOADER_H

#include <Arduino.h>
#include "config_store.h"

// OTA Configuration
#define OTA_DOWNLOAD_TIMEOUT_MS 300000UL  // 5 minutes (unsigned long)
#define OTA_BUFFER_SIZE 1024  // Reduced from 4096 to prevent stack overflow
#define MAX_RELEASES 10  // Maximum number of releases to track

/**
 * @brief OTA Download Status
 */
enum class OTAStatus {
    IDLE,
    CHECKING,
    DOWNLOADING,
    FLASHING,
    SUCCESS,
    ERROR_NO_URL,
    ERROR_NETWORK,
    ERROR_PARSE,
    ERROR_NO_FIRMWARE,
    ERROR_DOWNLOAD,
    ERROR_FLASH,
    ERROR_VERIFY
};

/**
 * @brief Release info structure
 */
struct ReleaseInfo {
    String version;
    String firmware_url;
    bool is_prerelease;
    String published_at;
    bool valid;
};

/**
 * @brief OTA Progress Callback
 * @param progress Download progress (0-100)
 * @param status Current status message
 */
typedef void (*OTAProgressCallback)(int progress, const char* status);

/**
 * @brief OTA Downloader Class
 * 
 * Handles checking for and downloading firmware updates from GitHub Releases.
 */
class OTADownloader {
public:
    OTADownloader();
    ~OTADownloader();

    /**
     * @brief Initialize the OTA downloader
     * @param config Pointer to ConfigStore for OTA URL
     */
    void begin(ConfigStore* config);

    /**
     * @brief Check for and install firmware from OTA URL
     * 
     * This is the main entry point. It will:
     * 1. Fetch the GitHub releases JSON
     * 2. Parse to find the .bin firmware asset
     * 3. Download and flash the firmware
     * 4. Reboot on success
     * 
     * @return true if update started successfully (will reboot)
     */
    bool checkAndInstall();

    /**
     * @brief Get current OTA status
     * @return Current status enum
     */
    OTAStatus getStatus() const;

    /**
     * @brief Get status message
     * @return Human-readable status message
     */
    String getStatusMessage() const;

    /**
     * @brief Get download progress
     * @return Progress percentage (0-100)
     */
    int getProgress() const;

    /**
     * @brief Set progress callback
     * @param callback Function to call with progress updates
     */
    void setProgressCallback(OTAProgressCallback callback);

    /**
     * @brief Download and install firmware from direct URL
     * @param firmware_url Direct URL to .bin file
     * @return true if successful
     */
    bool downloadAndInstall(const String& firmware_url);
    
    /**
     * @brief Fetch available releases from GitHub
     * @param include_prereleases Include beta/prerelease versions
     * @return Number of releases found
     */
    int fetchAvailableReleases(bool include_prereleases = true);
    
    /**
     * @brief Get number of available releases
     * @return Count of releases
     */
    int getReleaseCount() const { return release_count; }
    
    /**
     * @brief Get release info by index
     * @param index Release index (0 = newest)
     * @return ReleaseInfo structure
     */
    ReleaseInfo getRelease(int index) const;
    
    /**
     * @brief Install a specific release by index
     * @param index Release index
     * @return true if install started
     */
    bool installRelease(int index);
    
    /**
     * @brief Check if a version is a beta/prerelease
     * @param version Version string
     * @return true if beta/prerelease
     */
    static bool isBetaVersion(const String& version);

private:
    ConfigStore* config_store;
    OTAStatus status;
    int progress;
    String status_message;
    OTAProgressCallback progress_callback;
    
    // Available releases
    ReleaseInfo releases[MAX_RELEASES];
    int release_count;

    /**
     * @brief Fetch and parse GitHub releases JSON
     * @param releases_url GitHub API URL for releases
     * @param firmware_url Output: URL to firmware binary
     * @return true if firmware URL found
     */
    bool fetchFirmwareUrl(const String& releases_url, String& firmware_url);

    /**
     * @brief Download firmware and flash to OTA partition
     * @param firmware_url Direct URL to firmware binary
     * @return true if successful
     */
    bool downloadFirmware(const String& firmware_url);

    void updateStatus(OTAStatus new_status, const String& message);
    void updateProgress(int new_progress, const String& message);
};

#endif // OTA_DOWNLOADER_H
