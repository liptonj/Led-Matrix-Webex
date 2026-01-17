/**
 * @file web_server.cpp
 * @brief Async Web Server Implementation
 */

#include "web_server.h"
#include <ArduinoJson.h>
#include <WiFi.h>

// External reference to OTA manager for update functionality
extern class OTAManager ota_manager;

WebServerManager::WebServerManager()
    : server(nullptr), config_manager(nullptr), app_state(nullptr), running(false) {
}

WebServerManager::~WebServerManager() {
    if (server) {
        delete server;
    }
}

void WebServerManager::begin(ConfigManager* config, AppState* state) {
    config_manager = config;
    app_state = state;

    // Initialize LittleFS for static files
    if (!LittleFS.begin(true)) {
        Serial.println("[WEB] Failed to mount LittleFS!");
    }

    // Create server on port 80
    server = new AsyncWebServer(80);

    // Setup routes
    setupRoutes();

    // Start server
    server->begin();
    running = true;

    Serial.println("[WEB] Web server started on port 80");
}

void WebServerManager::loop() {
    // AsyncWebServer handles requests automatically
}

void WebServerManager::setupRoutes() {
    // Serve static files from LittleFS
    server->serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

    // API endpoints
    server->on("/api/status", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleStatus(request);
    });

    server->on("/api/config", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleConfig(request);
    });

    server->on("/api/config", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleSaveConfig(request, data, len);
        }
    );

    server->on("/api/wifi/scan", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleWifiScan(request);
    });

    server->on("/api/wifi/save", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleWifiSave(request);
        }
    );

    server->on("/api/webex/auth", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleWebexAuth(request);
    });

    server->on("/oauth/callback", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleOAuthCallback(request);
    });

    server->on("/api/ota/check", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleCheckUpdate(request);
    });

    server->on("/api/ota/update", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handlePerformUpdate(request);
    });

    server->on("/api/reboot", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleReboot(request);
    });

    server->on("/api/factory-reset", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleFactoryReset(request);
    });

    // 404 handler
    server->onNotFound([](AsyncWebServerRequest* request) {
        request->send(404, "application/json", "{\"error\":\"Not found\"}");
    });
}

void WebServerManager::handleStatus(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["wifi_connected"] = app_state->wifi_connected;
    doc["webex_authenticated"] = app_state->webex_authenticated;
    doc["bridge_connected"] = app_state->bridge_connected;
    doc["xapi_connected"] = app_state->xapi_connected;
    doc["mqtt_connected"] = app_state->mqtt_connected;
    doc["webex_status"] = app_state->webex_status;
    doc["camera_on"] = app_state->camera_on;
    doc["mic_muted"] = app_state->mic_muted;
    doc["in_call"] = app_state->in_call;
    doc["temperature"] = app_state->temperature;
    doc["humidity"] = app_state->humidity;
    doc["door_status"] = app_state->door_status;
    doc["air_quality"] = app_state->air_quality;

    // System info
    doc["ip_address"] = WiFi.localIP().toString();
    doc["mac_address"] = WiFi.macAddress();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;

    #ifdef FIRMWARE_VERSION
    doc["firmware_version"] = FIRMWARE_VERSION;
    #else
    doc["firmware_version"] = "unknown";
    #endif

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleConfig(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["device_name"] = config_manager->getDeviceName();
    doc["display_name"] = config_manager->getDisplayName();
    doc["brightness"] = config_manager->getBrightness();
    doc["poll_interval"] = config_manager->getWebexPollInterval();
    doc["xapi_poll_interval"] = config_manager->getXAPIPollInterval();
    doc["has_webex_credentials"] = config_manager->hasWebexCredentials();
    doc["has_webex_tokens"] = config_manager->hasWebexTokens();
    doc["has_xapi_device"] = config_manager->hasXAPIDevice();
    doc["xapi_device_id"] = config_manager->getXAPIDeviceId();
    doc["mqtt_broker"] = config_manager->getMQTTBroker();
    doc["mqtt_port"] = config_manager->getMQTTPort();
    doc["mqtt_topic"] = config_manager->getMQTTTopic();
    doc["sensor_serial"] = config_manager->getSensorSerial();
    doc["ota_url"] = config_manager->getOTAUrl();
    doc["auto_update"] = config_manager->getAutoUpdate();

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleSaveConfig(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String body = String((char*)data).substring(0, len);

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }

    // Update configuration
    if (doc["device_name"].is<const char*>()) {
        config_manager->setDeviceName(doc["device_name"].as<const char*>());
    }
    if (doc["display_name"].is<const char*>()) {
        config_manager->setDisplayName(doc["display_name"].as<const char*>());
    }
    if (doc["brightness"].is<int>()) {
        config_manager->setBrightness(doc["brightness"].as<uint8_t>());
    }
    if (doc["poll_interval"].is<int>()) {
        config_manager->setWebexPollInterval(doc["poll_interval"].as<uint16_t>());
    }
    if (doc["xapi_poll_interval"].is<int>()) {
        config_manager->setXAPIPollInterval(doc["xapi_poll_interval"].as<uint16_t>());
    }
    if (doc["xapi_device_id"].is<const char*>()) {
        config_manager->setXAPIDeviceId(doc["xapi_device_id"].as<const char*>());
    }
    if (doc["webex_client_id"].is<const char*>() && doc["webex_client_secret"].is<const char*>()) {
        config_manager->setWebexCredentials(
            doc["webex_client_id"].as<const char*>(),
            doc["webex_client_secret"].as<const char*>()
        );
    }
    if (doc["mqtt_broker"].is<const char*>()) {
        config_manager->setMQTTConfig(
            doc["mqtt_broker"].as<const char*>(),
            doc["mqtt_port"] | 1883,
            doc["mqtt_username"] | "",
            doc["mqtt_password"] | "",
            doc["mqtt_topic"] | "meraki/v1/mt/#"
        );
    }
    if (doc["sensor_serial"].is<const char*>()) {
        config_manager->setSensorSerial(doc["sensor_serial"].as<const char*>());
    }
    if (doc["ota_url"].is<const char*>()) {
        config_manager->setOTAUrl(doc["ota_url"].as<const char*>());
    }
    if (doc["auto_update"].is<bool>()) {
        config_manager->setAutoUpdate(doc["auto_update"].as<bool>());
    }

    request->send(200, "application/json", "{\"success\":true}");
}

void WebServerManager::handleWifiScan(AsyncWebServerRequest* request) {
    int n = WiFi.scanNetworks();

    JsonDocument doc;
    JsonArray networks = doc["networks"].to<JsonArray>();

    for (int i = 0; i < n; i++) {
        JsonObject network = networks.add<JsonObject>();
        network["ssid"] = WiFi.SSID(i);
        network["rssi"] = WiFi.RSSI(i);
        network["encrypted"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    }

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleWifiSave(AsyncWebServerRequest* request) {
    if (!request->hasParam("ssid", true) || !request->hasParam("password", true)) {
        request->send(400, "application/json", "{\"error\":\"Missing ssid or password\"}");
        return;
    }

    String ssid = request->getParam("ssid", true)->value();
    String password = request->getParam("password", true)->value();

    config_manager->setWiFiCredentials(ssid, password);

    request->send(200, "application/json", "{\"success\":true,\"message\":\"WiFi saved. Rebooting...\"}");

    // Reboot after short delay
    delay(1000);
    ESP.restart();
}

void WebServerManager::handleWebexAuth(AsyncWebServerRequest* request) {
    String client_id = config_manager->getWebexClientId();

    if (client_id.isEmpty()) {
        request->send(400, "application/json", "{\"error\":\"Webex client ID not configured\"}");
        return;
    }

    // Build OAuth authorization URL
    String redirect_uri = "http://" + WiFi.localIP().toString() + "/oauth/callback";
    String state = String(random(100000, 999999));

    String auth_url = "https://webexapis.com/v1/authorize";
    auth_url += "?client_id=" + client_id;
    auth_url += "&response_type=code";
    auth_url += "&redirect_uri=" + redirect_uri;
    auth_url += "&scope=spark:people_read%20spark:xapi_statuses";
    auth_url += "&state=" + state;

    // Store state for verification
    // In production, store this securely

    JsonDocument doc;
    doc["auth_url"] = auth_url;
    doc["state"] = state;

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleOAuthCallback(AsyncWebServerRequest* request) {
    if (!request->hasParam("code")) {
        request->send(400, "text/html", "<html><body><h1>Error</h1><p>Authorization code not received.</p></body></html>");
        return;
    }

    String code = request->getParam("code")->value();

    // Store the auth code for the Webex client to exchange
    // This will be handled by the main loop
    // For now, we just acknowledge receipt

    String html = "<html><head>";
    html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
    html += "<style>body{font-family:sans-serif;text-align:center;padding:50px;}</style>";
    html += "</head><body>";
    html += "<h1>Authorization Successful!</h1>";
    html += "<p>You can close this window.</p>";
    html += "<p>The display will update shortly.</p>";
    html += "</body></html>";

    request->send(200, "text/html", html);

    // Trigger token exchange in main loop
    // This would be handled by storing the code and processing it
    Serial.printf("[WEB] OAuth callback received, code: %s\n", code.substring(0, 10).c_str());
}

void WebServerManager::handleCheckUpdate(AsyncWebServerRequest* request) {
    // This will be filled in by OTA manager
    JsonDocument doc;
    doc["current_version"] = FIRMWARE_VERSION;
    doc["checking"] = true;

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handlePerformUpdate(AsyncWebServerRequest* request) {
    request->send(200, "application/json", "{\"success\":true,\"message\":\"Update started...\"}");

    // Trigger OTA update
    // This would call ota_manager.performUpdate()
}

void WebServerManager::handleReboot(AsyncWebServerRequest* request) {
    request->send(200, "application/json", "{\"success\":true,\"message\":\"Rebooting...\"}");
    delay(1000);
    ESP.restart();
}

void WebServerManager::handleFactoryReset(AsyncWebServerRequest* request) {
    config_manager->factoryReset();
    request->send(200, "application/json", "{\"success\":true,\"message\":\"Factory reset complete. Rebooting...\"}");
    delay(1000);
    ESP.restart();
}

String WebServerManager::getContentType(const String& filename) {
    if (filename.endsWith(".html")) return "text/html";
    if (filename.endsWith(".css")) return "text/css";
    if (filename.endsWith(".js")) return "application/javascript";
    if (filename.endsWith(".json")) return "application/json";
    if (filename.endsWith(".ico")) return "image/x-icon";
    if (filename.endsWith(".png")) return "image/png";
    if (filename.endsWith(".svg")) return "image/svg+xml";
    return "text/plain";
}
