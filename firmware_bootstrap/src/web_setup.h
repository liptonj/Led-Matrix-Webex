/**
 * @file web_setup.h
 * @brief Minimal Web Server for Bootstrap Configuration
 *
 * Provides a simple web interface for WiFi configuration and OTA updates.
 * Includes captive portal support for automatic redirect on connection.
 */

#ifndef WEB_SETUP_H
#define WEB_SETUP_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include "config_store.h"
#include "wifi_provisioner.h"
#include "ota_downloader.h"

// DNS port for captive portal
#define DNS_PORT 53

/**
 * @brief Web Setup Server Class
 *
 * Hosts a minimal web interface for bootstrap configuration.
 */
class WebSetup {
public:
    typedef void (*OTAUploadProgressCallback)(int progress, const char* status);

    WebSetup();
    ~WebSetup();

    /**
     * @brief Initialize and start the web server
     * @param config Pointer to ConfigStore
     * @param wifi Pointer to WiFiProvisioner
     * @param ota Pointer to OTADownloader
     */
    void begin(ConfigStore* config, WiFiProvisioner* wifi, OTADownloader* ota);

    /**
     * @brief Process web server (not needed for async, but kept for consistency)
     */
    void loop();

    /**
     * @brief Stop the web server and cleanup resources
     */
    void stop();

    /**
     * @brief Check if an OTA update was requested via web
     * @return true if OTA was triggered
     */
    bool isOTAPending() const;

    /**
     * @brief Clear OTA pending flag
     */
    void clearOTAPending();

    /**
     * @brief Check if WiFi credentials were just saved
     * @return true if new credentials were saved
     */
    bool isWiFiPending() const;

    /**
     * @brief Clear WiFi pending flag
     */
    void clearWiFiPending();

    /**
     * @brief Get selected release index for OTA
     * @return Release index, or -1 for auto (latest stable)
     */
    int getSelectedReleaseIndex() const { return selected_release_index; }

    /**
     * @brief Set callback for OTA upload progress updates
     * @param callback Progress callback
     */
    void setOTAUploadProgressCallback(OTAUploadProgressCallback callback);

private:
    AsyncWebServer* server;
    DNSServer* dns_server;
    ConfigStore* config_store;
    WiFiProvisioner* wifi_provisioner;
    OTADownloader* ota_downloader;
    bool ota_pending;
    bool wifi_pending;
    bool running;
    bool captive_portal_active;
    String ota_upload_error;
    size_t ota_upload_size;
    size_t ota_upload_written;
    size_t ota_upload_next_log;
    size_t ota_upload_received;
    bool ota_upload_in_progress;
    bool ota_bundle_mode;
    bool ota_bundle_header_flushed;
    size_t ota_bundle_header_filled;
    size_t ota_bundle_app_size;
    size_t ota_bundle_fs_size;
    size_t ota_bundle_app_written;
    size_t ota_bundle_fs_written;
    bool ota_bundle_fs_started;
    uint8_t ota_bundle_header[16];
    OTAUploadProgressCallback ota_upload_progress_callback;
    int ota_upload_last_progress;
    size_t ota_upload_expected_size;

    void setupRoutes();
    void setupCaptivePortal();
    void reportOTAUploadProgress(int progress, const char* status);

    // Request handlers
    void handleRoot(AsyncWebServerRequest* request);
    void handleStatus(AsyncWebServerRequest* request);
    void handleConfig(AsyncWebServerRequest* request);
    void handleScan(AsyncWebServerRequest* request);
    void handleWifiSave(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleOTAUrl(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleOTAUploadChunk(
        AsyncWebServerRequest* request,
        const String& filename,
        size_t index,
        uint8_t* data,
        size_t len,
        bool final,
        size_t total
    );
    void handleStartOTA(AsyncWebServerRequest* request);
    void handleOTAProgress(AsyncWebServerRequest* request);
    void handleGetReleases(AsyncWebServerRequest* request);
    void handleInstallRelease(AsyncWebServerRequest* request, uint8_t* data, size_t len);

    // State for selected release
    int selected_release_index;
};

#endif // WEB_SETUP_H
