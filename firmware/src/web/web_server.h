/**
 * @file web_server.h
 * @brief Async Web Server Header
 */

#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include "../config/config_manager.h"
#include "../app_state.h"

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
     */
    void begin(ConfigManager* config, AppState* state);
    
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
    ConfigManager* config_manager;
    AppState* app_state;
    bool running;
    
    // Route handlers
    void setupRoutes();
    void handleRoot(AsyncWebServerRequest* request);
    void handleStatus(AsyncWebServerRequest* request);
    void handleConfig(AsyncWebServerRequest* request);
    void handleSaveConfig(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleWifiScan(AsyncWebServerRequest* request);
    void handleWifiSave(AsyncWebServerRequest* request);
    void handleWebexAuth(AsyncWebServerRequest* request);
    void handleOAuthCallback(AsyncWebServerRequest* request);
    void handleCheckUpdate(AsyncWebServerRequest* request);
    void handlePerformUpdate(AsyncWebServerRequest* request);
    void handleReboot(AsyncWebServerRequest* request);
    void handleFactoryReset(AsyncWebServerRequest* request);
    
    // Utility
    String getContentType(const String& filename);
};

#endif // WEB_SERVER_H
