/**
 * @file web_server.cpp
 * @brief Async Web Server Implementation
 */

#include "web_server.h"
#include "../ota/ota_manager.h"
#include <ArduinoJson.h>
#include <WiFi.h>

// External reference to OTA manager for update functionality
extern OTAManager ota_manager;

WebServerManager::WebServerManager()
    : server(nullptr), config_manager(nullptr), app_state(nullptr), module_manager(nullptr), running(false) {
}

WebServerManager::~WebServerManager() {
    if (server) {
        delete server;
    }
}

void WebServerManager::begin(ConfigManager* config, AppState* state, ModuleManager* modules) {
    config_manager = config;
    app_state = state;
    module_manager = modules;

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
    // IMPORTANT: Register API endpoints FIRST, before static file handlers
    // This prevents VFS errors when checking for non-existent static files
    
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

    // Embedded App API endpoints
    server->on("/api/embedded/status", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleEmbeddedStatusGet(request);
    });

    server->on("/api/embedded/status", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleEmbeddedStatus(request, data, len);
        }
    );

    // Module management API endpoints
    server->on("/api/modules", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleGetModules(request);
    });

    server->on("/api/modules/variants", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleGetVariants(request);
    });

    server->on("/api/modules/enable", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleSetModuleEnabled(request, data, len);
        }
    );

    server->on("/api/modules/install", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleInstallVariant(request, data, len);
        }
    );

    // STATIC FILE HANDLERS - Register AFTER all API endpoints
    // This ensures API routes are checked first, preventing VFS errors
    
    // Serve embedded app static files
    server->serveStatic("/embedded/", LittleFS, "/embedded/").setDefaultFile("index.html");
    
    // Serve main app static files (must be last)
    server->serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

    // 404 handler for anything not matched
    server->onNotFound([](AsyncWebServerRequest* request) {
        // Check if it's an API request that wasn't found
        if (request->url().startsWith("/api/")) {
            request->send(404, "application/json", "{\"error\":\"API endpoint not found\"}");
        } else {
            // For non-API requests, try serving index.html (SPA fallback)
            request->send(LittleFS, "/index.html", "text/html");
        }
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
    doc["air_quality"] = app_state->air_quality_index;

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
    JsonDocument doc;
    doc["current_version"] = FIRMWARE_VERSION;
    
    // Check for updates using OTA manager
    Serial.println("[WEB] Checking for OTA updates...");
    bool update_checked = ota_manager.checkForUpdate();
    
    if (update_checked) {
        String latest = ota_manager.getLatestVersion();
        bool available = ota_manager.isUpdateAvailable();
        
        // Ensure we have a valid version string
        if (latest.isEmpty()) {
            doc["latest_version"] = "Unknown";
            doc["update_available"] = false;
            doc["error"] = "No version information available";
        } else {
            doc["latest_version"] = latest;
            doc["update_available"] = available;
            
            if (available) {
                String download_url = ota_manager.getDownloadUrl();
                if (!download_url.isEmpty()) {
                    doc["download_url"] = download_url;
                }
                Serial.printf("[WEB] Update available: %s -> %s\n", 
                             FIRMWARE_VERSION, latest.c_str());
            } else {
                Serial.println("[WEB] Already on latest version");
            }
        }
    } else {
        // Check failed
        doc["latest_version"] = "Check failed";
        doc["update_available"] = false;
        doc["error"] = "Failed to check for updates. Check OTA URL configuration and network connection.";
        Serial.println("[WEB] OTA check failed");
    }

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handlePerformUpdate(AsyncWebServerRequest* request) {
    // Check if an update is available first
    if (!ota_manager.isUpdateAvailable()) {
        request->send(400, "application/json", 
                     "{\"success\":false,\"message\":\"No update available. Check for updates first.\"}");
        return;
    }
    
    Serial.println("[WEB] Starting OTA update...");
    request->send(200, "application/json", 
                 "{\"success\":true,\"message\":\"Update started. Device will restart...\"}");
    
    // Give the response time to be sent
    delay(100);
    
    // Trigger OTA update (this will reboot on success)
    if (!ota_manager.performUpdate()) {
        Serial.println("[WEB] OTA update failed");
        // Note: If we get here, the update failed and didn't reboot
    }
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

void WebServerManager::handleEmbeddedStatusGet(AsyncWebServerRequest* request) {
    // Return current status for embedded app to read
    JsonDocument doc;
    
    doc["status"] = app_state->webex_status;
    doc["camera_on"] = app_state->camera_on;
    doc["mic_muted"] = app_state->mic_muted;
    doc["in_call"] = app_state->in_call;
    doc["display_name"] = config_manager->getDisplayName();
    doc["hostname"] = config_manager->getDeviceName() + ".local";
    doc["embedded_app_enabled"] = true;
    
    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleEmbeddedStatus(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    // Receive status update from Webex Embedded App
    String body = String((char*)data).substring(0, len);
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    
    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }
    
    // Update app state from embedded app
    if (doc["status"].is<const char*>()) {
        String newStatus = doc["status"].as<String>();
        
        // Map embedded app status to internal status
        if (newStatus == "active" || newStatus == "available") {
            app_state->webex_status = "active";
        } else if (newStatus == "away" || newStatus == "inactive") {
            app_state->webex_status = "away";
        } else if (newStatus == "dnd" || newStatus == "donotdisturb") {
            app_state->webex_status = "dnd";
        } else if (newStatus == "meeting" || newStatus == "call" || newStatus == "busy") {
            app_state->webex_status = "meeting";
            app_state->in_call = true;
        } else if (newStatus == "ooo" || newStatus == "outofoffice") {
            app_state->webex_status = "ooo";
        } else if (newStatus == "offline") {
            app_state->webex_status = "offline";
        } else {
            app_state->webex_status = newStatus;
        }
        
        Serial.printf("[WEB] Embedded app status update: %s\n", app_state->webex_status.c_str());
    }
    
    // Handle call state
    if (doc["in_call"].is<bool>()) {
        app_state->in_call = doc["in_call"].as<bool>();
    }
    
    // Handle camera state
    if (doc["camera_on"].is<bool>()) {
        app_state->camera_on = doc["camera_on"].as<bool>();
    }
    
    // Handle mic state
    if (doc["mic_muted"].is<bool>()) {
        app_state->mic_muted = doc["mic_muted"].as<bool>();
    }
    
    // Handle display name update
    if (doc["displayName"].is<const char*>()) {
        config_manager->setDisplayName(doc["displayName"].as<const char*>());
    }
    
    // Mark as connected via embedded app
    app_state->bridge_connected = true;  // Reusing this flag for embedded app connection
    
    JsonDocument response;
    response["success"] = true;
    response["status"] = app_state->webex_status;
    response["message"] = "Status updated from embedded app";
    
    String responseStr;
    serializeJson(response, responseStr);
    request->send(200, "application/json", responseStr);
}

void WebServerManager::handleGetModules(AsyncWebServerRequest* request) {
    JsonDocument doc;
    
    // Current firmware info
    doc["current_variant"] = module_manager ? module_manager->getCurrentVariant() : "unknown";
    doc["installed_modules"] = module_manager ? module_manager->getInstalledModules() : INSTALLED_MODULES;
    doc["enabled_modules"] = module_manager ? module_manager->getEnabledModules() : INSTALLED_MODULES;
    
    // List all available modules
    JsonArray modules = doc["modules"].to<JsonArray>();
    
    if (module_manager) {
        auto allModules = module_manager->getAllModules();
        for (const auto* mod : allModules) {
            JsonObject m = modules.add<JsonObject>();
            m["id"] = mod->id;
            m["name"] = mod->name;
            m["description"] = mod->description;
            m["version"] = mod->version;
            m["size_kb"] = mod->size_kb;
            m["installed"] = module_manager->isInstalled(mod->id);
            m["enabled"] = module_manager->isEnabled(mod->id);
            m["ota_filename"] = mod->ota_filename;
        }
    }
    
    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleGetVariants(AsyncWebServerRequest* request) {
    JsonDocument doc;
    
    doc["current_variant"] = module_manager ? module_manager->getCurrentVariant() : "unknown";
    
    // Recommended variant based on enabled modules
    if (module_manager) {
        const FirmwareVariant* recommended = module_manager->getRecommendedVariant();
        if (recommended) {
            doc["recommended"] = recommended->name;
        }
    }
    
    // List all firmware variants
    JsonArray variants = doc["variants"].to<JsonArray>();
    
    if (module_manager) {
        auto allVariants = module_manager->getAllVariants();
        for (const auto* var : allVariants) {
            JsonObject v = variants.add<JsonObject>();
            v["name"] = var->name;
            v["description"] = var->description;
            v["modules"] = var->modules;
            v["filename"] = var->filename;
            v["size_kb"] = var->size_kb;
            v["is_current"] = (var->modules == module_manager->getInstalledModules());
        }
    }
    
    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleSetModuleEnabled(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    if (!module_manager) {
        request->send(503, "application/json", "{\"error\":\"Module manager not available\"}");
        return;
    }
    
    String body = String((char*)data).substring(0, len);
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    
    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }
    
    if (!doc["module_id"].is<int>() || !doc["enabled"].is<bool>()) {
        request->send(400, "application/json", "{\"error\":\"module_id and enabled required\"}");
        return;
    }
    
    uint8_t moduleId = doc["module_id"].as<uint8_t>();
    bool enabled = doc["enabled"].as<bool>();
    
    // Check if module is installed
    if (!module_manager->isInstalled(moduleId)) {
        request->send(400, "application/json", "{\"error\":\"Module not installed\"}");
        return;
    }
    
    module_manager->setEnabled(moduleId, enabled);
    
    JsonDocument response;
    response["success"] = true;
    response["module_id"] = moduleId;
    response["enabled"] = module_manager->isEnabled(moduleId);
    response["message"] = enabled ? "Module enabled" : "Module disabled";
    
    // Check if firmware variant change is recommended
    const FirmwareVariant* recommended = module_manager->getRecommendedVariant();
    if (recommended && recommended->modules != module_manager->getInstalledModules()) {
        response["recommended_variant"] = recommended->name;
        response["variant_change_suggested"] = true;
    }
    
    String responseStr;
    serializeJson(response, responseStr);
    request->send(200, "application/json", responseStr);
}

void WebServerManager::handleInstallVariant(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    if (!module_manager) {
        request->send(503, "application/json", "{\"error\":\"Module manager not available\"}");
        return;
    }
    
    String body = String((char*)data).substring(0, len);
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    
    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }
    
    if (!doc["variant"].is<const char*>()) {
        request->send(400, "application/json", "{\"error\":\"variant name required\"}");
        return;
    }
    
    const char* variantName = doc["variant"].as<const char*>();
    const FirmwareVariant* variant = module_manager->getVariant(variantName);
    
    if (!variant) {
        request->send(404, "application/json", "{\"error\":\"Variant not found\"}");
        return;
    }
    
    // Build the OTA URL for this variant
    String otaBaseUrl = config_manager->getOTAUrl();
    if (otaBaseUrl.isEmpty()) {
        otaBaseUrl = "https://github.com/liptonj/Led-Matrix-Webex/releases/latest/download";
    }
    
    String firmwareUrl = otaBaseUrl + "/" + String(variant->filename);
    
    JsonDocument response;
    response["success"] = true;
    response["variant"] = variantName;
    response["filename"] = variant->filename;
    response["url"] = firmwareUrl;
    response["size_kb"] = variant->size_kb;
    response["modules"] = variant->modules;
    response["message"] = "Starting OTA update...";
    
    String responseStr;
    serializeJson(response, responseStr);
    request->send(200, "application/json", responseStr);
    
    // Trigger OTA update (handled by OTA manager)
    // The OTA manager will be called after this response
    Serial.printf("[WEB] Installing variant: %s from %s\n", variantName, firmwareUrl.c_str());
    
    // Store the URL for OTA manager to pick up
    config_manager->setOTAUrl(firmwareUrl);
    
    // Note: Actual OTA installation would be triggered here
    // This would call ota_manager.installFromUrl(firmwareUrl)
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
