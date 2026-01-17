/**
 * @file web_setup.h
 * @brief Minimal Web Server for Bootstrap Configuration
 * 
 * Provides a simple web interface for WiFi configuration and OTA updates.
 */

#ifndef WEB_SETUP_H
#define WEB_SETUP_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include "config_store.h"
#include "wifi_provisioner.h"
#include "ota_downloader.h"

/**
 * @brief Web Setup Server Class
 * 
 * Hosts a minimal web interface for bootstrap configuration.
 */
class WebSetup {
public:
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

private:
    AsyncWebServer* server;
    ConfigStore* config_store;
    WiFiProvisioner* wifi_provisioner;
    OTADownloader* ota_downloader;
    bool ota_pending;
    bool wifi_pending;
    bool running;

    void setupRoutes();
    
    // Request handlers
    void handleRoot(AsyncWebServerRequest* request);
    void handleStatus(AsyncWebServerRequest* request);
    void handleConfig(AsyncWebServerRequest* request);
    void handleScan(AsyncWebServerRequest* request);
    void handleWifiSave(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleOTAUrl(AsyncWebServerRequest* request, uint8_t* data, size_t len);
    void handleStartOTA(AsyncWebServerRequest* request);
    void handleOTAProgress(AsyncWebServerRequest* request);
};

#endif // WEB_SETUP_H
