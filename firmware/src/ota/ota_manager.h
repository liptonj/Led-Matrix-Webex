/**
 * @file ota_manager.h
 * @brief OTA Update Manager Header
 */

#ifndef OTA_MANAGER_H
#define OTA_MANAGER_H

#include <Arduino.h>

/**
 * @brief OTA Update Manager Class
 * 
 * Handles checking for and performing firmware updates from GitHub Releases.
 */
class OTAManager {
public:
    OTAManager();
    ~OTAManager();
    
    /**
     * @brief Initialize the OTA manager
     * @param update_url GitHub releases API URL
     * @param current_version Current firmware version
     */
    void begin(const String& update_url, const String& current_version);
    
    /**
     * @brief Check for available updates
     * @return true if update is available
     */
    bool checkForUpdate();
    
    /**
     * @brief Perform the firmware update
     * @return true if update started successfully
     */
    bool performUpdate();
    
    /**
     * @brief Get the latest available version
     * @return Version string
     */
    String getLatestVersion() const { return latest_version; }
    
    /**
     * @brief Get the download URL for the latest firmware
     * @return URL string
     */
    String getDownloadUrl() const { return download_url; }
    
    /**
     * @brief Check if an update is available
     * @return true if update available
     */
    bool isUpdateAvailable() const { return update_available; }
    
    /**
     * @brief Get the current firmware version
     * @return Version string
     */
    String getCurrentVersion() const { return current_version; }
    
    /**
     * @brief Set the update URL
     * @param url GitHub releases API URL
     */
    void setUpdateUrl(const String& url) { update_url = url; }

private:
    String update_url;
    String current_version;
    String latest_version;
    String download_url;
    bool update_available;
    
    bool compareVersions(const String& v1, const String& v2);
    String extractVersion(const String& tag);
};

#endif // OTA_MANAGER_H
