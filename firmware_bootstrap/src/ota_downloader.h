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
#define OTA_BUFFER_SIZE 4096

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

private:
    ConfigStore* config_store;
    OTAStatus status;
    int progress;
    String status_message;
    OTAProgressCallback progress_callback;

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
