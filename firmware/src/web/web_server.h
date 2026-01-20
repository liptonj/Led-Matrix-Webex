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
#include "../config/config_manager.h"
#include "../app_state.h"
#include "../modules/module_manager.h"

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
    void begin(ConfigManager* config, AppState* state, ModuleManager* modules = nullptr);
    
    /**
     * @brief Process web server events (called in loop)
     */
    void loop();
    
    /**
     * @brief Check if server is running
     * @return true if server is running
     */
    bool isRunning() const { return running; }

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

    void setupCaptivePortal();
    String buildRedirectUri() const;
    
    // Route handlers
    void setupRoutes();
    void handleRoot(AsyncWebServerRequest* request);
    void handleStatus(AsyncWebServerRequest* request);
    void handleConfig(AsyncWebServerRequest* request);
    void handleSaveConfig(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleWifiScan(AsyncWebServerRequest* request);
    void handleWifiSave(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleWebexAuth(AsyncWebServerRequest* request);
    void handleOAuthCallback(AsyncWebServerRequest* request);
    void handleCheckUpdate(AsyncWebServerRequest* request);
    void handlePerformUpdate(AsyncWebServerRequest* request);
    void handleReboot(AsyncWebServerRequest* request);
    void handleFactoryReset(AsyncWebServerRequest* request);
    
    // Embedded app API handlers
    void handleEmbeddedStatus(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleEmbeddedStatusGet(AsyncWebServerRequest* request);
    
    // Module management API handlers
    void handleGetModules(AsyncWebServerRequest* request);
    void handleGetVariants(AsyncWebServerRequest* request);
    void handleSetModuleEnabled(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleInstallVariant(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    
    // Utility
    String getContentType(const String& filename);

public:
    bool hasPendingOAuthCode() const { return !pending_oauth_code.isEmpty(); }
    String consumePendingOAuthCode() {
        String code = pending_oauth_code;
        pending_oauth_code = "";
        return code;
    }
    String getPendingOAuthRedirectUri() const { return pending_oauth_redirect_uri; }
    void clearPendingOAuth() { pending_oauth_code = ""; pending_oauth_redirect_uri = ""; }
};

#endif // WEB_SERVER_H
