/**
 * @file web_server.h
 * @brief Async Web Server Header
 */

#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <esp_partition.h>
#include "../config/config_manager.h"
#include "../app_state.h"
#include "../modules/module_manager.h"

class MDNSManager;

/**
 * @brief Web Server Manager Class
 */
class WebServerManager {
public:
    WebServerManager();
    ~WebServerManager();
    
    /**
     * @brief Initialize and start the web server
     * @param config Pointer to configuration manager
     * @param state Pointer to application state
     * @param modules Pointer to module manager (optional)
     */
    void begin(ConfigManager* config, AppState* state, ModuleManager* modules = nullptr, MDNSManager* mdns = nullptr);
    
    /**
     * @brief Process web server events (called in loop)
     */
    void loop();
    
    /**
     * @brief Stop the web server and cleanup resources
     * 
     * Call this before OTA updates to properly unmount LittleFS
     * and prevent async file access conflicts.
     */
    void stop();
    
    /**
     * @brief Check if server is running
     * @return true if server is running
     */
    bool isRunning() const { return running; }

    /**
     * @brief Check if OTA upload is in progress
     * @return true if OTA upload is active
     */
    bool isOTAUploadInProgress() const { return ota_upload_in_progress; }

private:
    AsyncWebServer* server;
    DNSServer* dns_server;
    ConfigManager* config_manager;
    AppState* app_state;
    ModuleManager* module_manager;
    bool running;
    bool captive_portal_active;
    bool ota_upload_in_progress;
    String ota_upload_error;
    size_t ota_upload_size;
    String last_oauth_state;
    String last_oauth_redirect_uri;
    String pending_oauth_code;
    String pending_oauth_redirect_uri;
    
    // OTA bundle handling
    uint8_t ota_bundle_header[16];
    size_t ota_bundle_header_filled;
    bool ota_bundle_mode;
    bool ota_bundle_header_flushed;
    size_t ota_bundle_app_size;
    size_t ota_bundle_fs_size;
    size_t ota_bundle_app_written;
    size_t ota_bundle_fs_written;
    bool ota_bundle_fs_started;
    String config_body_buffer;
    size_t config_body_expected;
    String embedded_body_buffer;
    size_t embedded_body_expected;
    const esp_partition_t* ota_upload_target;
    
    // Pending reboot handling
    bool pending_reboot;
    unsigned long pending_reboot_time;
    const esp_partition_t* pending_boot_partition;
    MDNSManager* mdns_manager;

    void setupCaptivePortal();
    String buildRedirectUri() const;
    
    // Route handlers
    void setupRoutes();
    void handleRoot(AsyncWebServerRequest* request);
    void handleStatus(AsyncWebServerRequest* request);
    void handleConfig(AsyncWebServerRequest* request);
    void handleSaveConfig(AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total);
    void handleWifiScan(AsyncWebServerRequest* request);
    void handleWifiSave(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleWebexAuth(AsyncWebServerRequest* request);
    void handleOAuthCallback(AsyncWebServerRequest* request);
    void handleCheckUpdate(AsyncWebServerRequest* request);
    void handlePerformUpdate(AsyncWebServerRequest* request);
    void handleBootToFactory(AsyncWebServerRequest* request);
    void handleReboot(AsyncWebServerRequest* request);
    void handleFactoryReset(AsyncWebServerRequest* request);
    void handleMdnsRestart(AsyncWebServerRequest* request);
    void handleClearMQTT(AsyncWebServerRequest* request);
    void handleMQTTDebug(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleRegeneratePairingCode(AsyncWebServerRequest* request);
    
    // Embedded app API handlers
    void handleEmbeddedStatus(AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total);
    void handleEmbeddedStatusGet(AsyncWebServerRequest* request);
    
    // Module management API handlers
    void handleGetModules(AsyncWebServerRequest* request);
    void handleGetVariants(AsyncWebServerRequest* request);
    void handleSetModuleEnabled(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleInstallVariant(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    
    // Utility
    String getContentType(const String& filename);
    
    // CORS support for cloud-hosted embedded app
    void addCorsHeaders(AsyncWebServerResponse* response);
    void handleCorsPreflightRequest(AsyncWebServerRequest* request);
    void handleOTAUploadChunk(AsyncWebServerRequest* request,
                              const String& filename,
                              size_t index,
                              uint8_t* data,
                              size_t len,
                              bool final,
                              size_t total);

public:
    bool hasPendingOAuthCode() const { return !pending_oauth_code.isEmpty(); }
    String consumePendingOAuthCode() {
        String code = pending_oauth_code;
        pending_oauth_code = "";
        return code;
    }
    String getPendingOAuthRedirectUri() const { return pending_oauth_redirect_uri; }
    void clearPendingOAuth() { pending_oauth_code = ""; pending_oauth_redirect_uri = ""; }
    
    /**
     * @brief Check if a reboot is pending and perform it if delay has elapsed
     * @return true if reboot was triggered
     */
    bool checkPendingReboot();
};

#endif // WEB_SERVER_H
