/**
 * @file web_server.cpp
 * @brief Async Web Server Core Implementation
 * 
 * This file contains the core web server functionality:
 * - Server initialization and lifecycle
 * - Route setup
 * - Captive portal
 * - Reboot handling
 * 
 * API handlers are split into separate files:
 * - api_status.cpp: Status and configuration handlers
 * - api_wifi.cpp: WiFi scan and save handlers
 * - api_webex.cpp: Webex OAuth handlers
 * - api_ota.cpp: OTA check and update handlers
 * - api_ota_upload.cpp: OTA firmware upload handler
 * - api_embedded.cpp: Embedded app status handlers
 * - api_modules.cpp: Module management handlers
 */

#include "web_server.h"
#include "ota_bundle.h"
#include "embedded_assets.h"
#include "../display/matrix_display.h"
#include "../meraki/mqtt_client.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <Update.h>
#include <esp_ota_ops.h>

// DNS port for captive portal
#define DNS_PORT 53

WebServerManager::WebServerManager()
    : server(nullptr), dns_server(nullptr), config_manager(nullptr), app_state(nullptr),
      module_manager(nullptr), running(false), captive_portal_active(false),
      ota_upload_in_progress(false), ota_upload_error(""), ota_upload_size(0),
      ota_bundle_header_filled(0), ota_bundle_mode(false),
      ota_bundle_header_flushed(false), ota_bundle_app_size(0), ota_bundle_fs_size(0),
      ota_bundle_app_written(0), ota_bundle_fs_written(0), ota_bundle_fs_started(false),
      config_body_buffer(""), config_body_expected(0),
      embedded_body_buffer(""), embedded_body_expected(0),
      ota_upload_target(nullptr),
      pending_reboot(false), pending_reboot_time(0), pending_boot_partition(nullptr) {
    memset(ota_bundle_header, 0, sizeof(ota_bundle_header));
}

WebServerManager::~WebServerManager() {
    stop();
}

void WebServerManager::stop() {
    if (!running) {
        return;
    }
    
    Serial.println("[WEB] Stopping web server...");
    
    if (server) {
        server->end();
        delete server;
        server = nullptr;
    }
    if (dns_server) {
        dns_server->stop();
        delete dns_server;
        dns_server = nullptr;
    }
    
    // Unmount LittleFS since serveStatic() handlers had references to it
    // This ensures clean state for OTA filesystem flashing
    LittleFS.end();
    
    running = false;
    captive_portal_active = false;
    Serial.println("[WEB] Web server stopped, LittleFS unmounted");
}

void WebServerManager::begin(ConfigManager* config, AppState* state, ModuleManager* modules) {
    config_manager = config;
    app_state = state;
    module_manager = modules;

    // Initialize LittleFS for dynamic user content (configs, downloads)
    // Static web assets are now embedded in firmware
    if (!LittleFS.begin(true)) {
        Serial.println("[WEB] Failed to mount LittleFS (dynamic content may be unavailable)");
    }

    // Create server on port 80
    server = new AsyncWebServer(80);

    // Setup routes
    setupRoutes();

    // Setup captive portal if AP is active
    setupCaptivePortal();

    // Start server
    server->begin();
    running = true;

    Serial.println("[WEB] Web server started on port 80");
}

void WebServerManager::loop() {
    // AsyncWebServer handles requests automatically
    if (dns_server && captive_portal_active) {
        dns_server->processNextRequest();
    }
}

void WebServerManager::setupCaptivePortal() {
    IPAddress ap_ip = WiFi.softAPIP();
    if (ap_ip == IPAddress(0, 0, 0, 0)) {
        captive_portal_active = false;
        return;
    }

    dns_server = new DNSServer();
    if (dns_server->start(DNS_PORT, "*", ap_ip)) {
        captive_portal_active = true;
        Serial.println("[WEB] Captive portal DNS started");
    } else {
        Serial.println("[WEB] Failed to start captive portal DNS");
        delete dns_server;
        dns_server = nullptr;
        captive_portal_active = false;
    }
}

String WebServerManager::buildRedirectUri() const {
    String device_name = config_manager ? config_manager->getDeviceName() : "";
    String host = device_name.isEmpty() ? WiFi.localIP().toString() : (device_name + ".local");
    if (host.isEmpty()) {
        host = WiFi.localIP().toString();
    }
    return "http://" + host + "/oauth/callback";
}

void WebServerManager::setupRoutes() {
    // IMPORTANT: Register API endpoints FIRST, before static file handlers
    // This prevents VFS errors when checking for non-existent static files
    
    // CORS preflight handler for all API endpoints
    // This allows the cloud-hosted embedded app to make cross-origin requests
    server->on("/api/*", HTTP_OPTIONS, [this](AsyncWebServerRequest* request) {
        handleCorsPreflightRequest(request);
    });
    
    // API endpoints - Status and Config
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
            handleSaveConfig(request, data, len, index, total);
        }
    );

    // API endpoints - WiFi
    server->on("/api/wifi/scan", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleWifiScan(request);
    });

    server->on("/api/wifi/save", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleWifiSave(request, data, len);
        }
    );

    // API endpoints - Webex OAuth
    server->on("/api/webex/auth", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleWebexAuth(request);
    });

    server->on("/oauth/callback", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleOAuthCallback(request);
    });

    // API endpoints - OTA
    server->on("/api/ota/check", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleCheckUpdate(request);
    });

    server->on("/api/ota/update", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handlePerformUpdate(request);
    });

    server->on("/api/ota/bootloader", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleBootToFactory(request);
    });

    server->on("/api/ota/upload", HTTP_POST,
        [this](AsyncWebServerRequest* request) {
            bool success = ota_upload_error.isEmpty() && !Update.hasError();
            JsonDocument doc;
            doc["success"] = success;
            doc["message"] = success
                ? "Upload complete. Rebooting..."
                : (ota_upload_error.isEmpty() ? "Upload failed" : ota_upload_error);

            String response;
            serializeJson(doc, response);

            request->send(success ? 200 : 400, "application/json", response);

            if (success) {
                pending_reboot = true;
                pending_reboot_time = millis() + 500;
                pending_boot_partition = nullptr;
            }
        },
        [this](AsyncWebServerRequest* request, String filename, size_t index, uint8_t* data, size_t len, bool final) {
            handleOTAUploadChunk(request, filename, index, data, len, final, 0);
        },
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            if (request->contentType().startsWith("multipart/")) {
                return;
            }
            bool final = total > 0 && (index + len) >= total;
            handleOTAUploadChunk(request, "raw.bin", index, data, len, final, total);
        }
    );

    server->on("/api/ota/upload-fs", HTTP_POST,
        [this](AsyncWebServerRequest* request) {
            bool success = ota_upload_error.isEmpty() && !Update.hasError();
            JsonDocument doc;
            doc["success"] = success;
            doc["message"] = success
                ? "LittleFS upload complete. Rebooting..."
                : (ota_upload_error.isEmpty() ? "LittleFS upload failed" : ota_upload_error);

            String response;
            serializeJson(doc, response);

            request->send(success ? 200 : 400, "application/json", response);

            if (success) {
                pending_reboot = true;
                pending_reboot_time = millis() + 500;
                pending_boot_partition = nullptr;
            }
        },
        [this](AsyncWebServerRequest* request, String filename, size_t index, uint8_t* data, size_t len, bool final) {
            if (index == 0) {
                ota_upload_in_progress = true;
                ota_upload_error = "";
                ota_upload_size = request->contentLength();

                Serial.printf("[WEB] LittleFS upload start: %s (%u bytes)\n",
                              filename.c_str(), static_cast<unsigned>(ota_upload_size));

                size_t total = ota_upload_size;
                if (total == 0) {
                    ota_upload_error = "Missing content length";
                } else {
                    LittleFS.end();
                    if (!Update.begin(total, U_SPIFFS)) {
                        ota_upload_error = Update.errorString();
                    }
                }
            }

            if (ota_upload_error.isEmpty()) {
                if (Update.write(data, len) != len) {
                    ota_upload_error = Update.errorString();
                }
            }

            if (final) {
                if (ota_upload_error.isEmpty()) {
                    if (!Update.end(true)) {
                        ota_upload_error = Update.errorString();
                    }
                } else {
                    Update.abort();
                }
                ota_upload_in_progress = false;
                Serial.printf("[WEB] LittleFS upload %s (%u bytes)\n",
                              ota_upload_error.isEmpty() ? "complete" : "failed",
                              static_cast<unsigned>(ota_upload_size));
            }
        }
    );

    // API endpoints - System
    server->on("/api/reboot", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleReboot(request);
    });

    server->on("/api/factory-reset", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleFactoryReset(request);
    });

    server->on("/api/clear-mqtt", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleClearMQTT(request);
    });

    // MQTT debug toggle
    server->on("/api/mqtt/debug", HTTP_GET, [this](AsyncWebServerRequest* request) {
        extern MerakiMQTTClient mqtt_client;
        JsonDocument doc;
        doc["debug_enabled"] = mqtt_client.isDebugEnabled();
        String response;
        serializeJson(doc, response);
        AsyncWebServerResponse* resp = request->beginResponse(200, "application/json", response);
        addCorsHeaders(resp);
        request->send(resp);
    });
    
    server->on("/api/mqtt/debug", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleMQTTDebug(request, data, len);
        }
    );

    // Pairing code regeneration
    server->on("/api/pairing/regenerate", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleRegeneratePairingCode(request);
    });

    // Embedded App API endpoints
    server->on("/api/embedded/status", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleEmbeddedStatusGet(request);
    });

    server->on("/api/embedded/status", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleEmbeddedStatus(request, data, len, index, total);
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

    // Captive portal detection endpoints - redirect to AP IP
    server->on("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/?portal=1");
    });
    server->on("/library/test/success.html", HTTP_GET, [](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/?portal=1");
    });
    server->on("/generate_204", HTTP_GET, [](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/?portal=1");
    });
    server->on("/gen_204", HTTP_GET, [](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/?portal=1");
    });
    server->on("/connecttest.txt", HTTP_GET, [](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/?portal=1");
    });
    server->on("/ncsi.txt", HTTP_GET, [](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/?portal=1");
    });
    server->on("/success.txt", HTTP_GET, [](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/?portal=1");
    });

    // EMBEDDED STATIC FILE HANDLERS - Register AFTER all API endpoints
    // Static assets are now embedded in firmware (gzipped) for atomic OTA updates
    
    // Find index.html for root handler and 404 fallback
    const uint8_t* index_data = nullptr;
    size_t index_size = 0;
    
    // Register handlers for all embedded assets
    for (size_t i = 0; i < EMBEDDED_ASSETS_COUNT; i++) {
        const EmbeddedAsset& asset = EMBEDDED_ASSETS[i];
        
        // Capture asset by value for lambda
        const uint8_t* data = asset.data;
        size_t size = asset.size;
        const char* content_type = asset.content_type;
        
        // Remember index.html for root handler
        if (strcmp(asset.url_path, "/index.html") == 0) {
            index_data = data;
            index_size = size;
        }
        
        server->on(asset.url_path, HTTP_GET, [data, size, content_type](AsyncWebServerRequest* request) {
            AsyncWebServerResponse* response = request->beginResponse_P(200, content_type, data, size);
            response->addHeader("Content-Encoding", "gzip");
            response->addHeader("Cache-Control", "public, max-age=86400");  // Cache for 24 hours
            request->send(response);
        });
    }
    
    // Explicit root handler - serve index.html
    if (index_data != nullptr) {
        server->on("/", HTTP_GET, [index_data, index_size](AsyncWebServerRequest* request) {
            AsyncWebServerResponse* response = request->beginResponse_P(200, "text/html", index_data, index_size);
            response->addHeader("Content-Encoding", "gzip");
            response->addHeader("Cache-Control", "public, max-age=86400");
            request->send(response);
        });
    }
    
    // Dynamic content from LittleFS (user configs, downloads)
    // Keep LittleFS mounted for dynamic user content
    server->serveStatic("/data/", LittleFS, "/data/");

    // 404 handler for anything not matched
    server->onNotFound([this](AsyncWebServerRequest* request) {
        // Check if it's an API request that wasn't found
        if (request->url().startsWith("/api/")) {
            request->send(404, "application/json", "{\"error\":\"API endpoint not found\"}");
        } else {
            if (captive_portal_active) {
                request->redirect("http://192.168.4.1/?portal=1");
                return;
            }
            // For non-API requests, serve embedded index.html (SPA fallback)
            // Find the index.html asset
            for (size_t i = 0; i < EMBEDDED_ASSETS_COUNT; i++) {
                if (strcmp(EMBEDDED_ASSETS[i].url_path, "/index.html") == 0) {
                    AsyncWebServerResponse* response = request->beginResponse_P(
                        200, "text/html", EMBEDDED_ASSETS[i].data, EMBEDDED_ASSETS[i].size);
                    response->addHeader("Content-Encoding", "gzip");
                    request->send(response);
                    return;
                }
            }
            request->send(404, "text/plain", "Not found");
        }
    });
}

bool WebServerManager::checkPendingReboot() {
    if (!pending_reboot) {
        return false;
    }
    
    if (millis() < pending_reboot_time) {
        return false;
    }
    
    Serial.println("[WEB] Executing pending reboot...");
    
    // Clear display before reboot to prevent DMA corruption
    // The display uses I2S DMA which can leave garbage on screen if not properly cleared
    extern MatrixDisplay matrix_display;
    matrix_display.clear();
    delay(50);  // Allow display DMA to complete the clear operation
    
    // Set boot partition if specified
    if (pending_boot_partition) {
        esp_err_t err = esp_ota_set_boot_partition(pending_boot_partition);
        if (err != ESP_OK) {
            Serial.printf("[WEB] Failed to set boot partition: %s\n", esp_err_to_name(err));
        } else {
            Serial.printf("[WEB] Boot partition set to: %s\n", pending_boot_partition->label);
        }
    }
    
    delay(100);  // Brief delay for serial output
    ESP.restart();
    return true;  // Won't reach here
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

// ============================================================
// CORS Support for Cloud-Hosted Embedded App
// ============================================================

void WebServerManager::addCorsHeaders(AsyncWebServerResponse* response) {
    // Allow requests from any origin (cloud-hosted embedded app)
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
    response->addHeader("Access-Control-Max-Age", "86400");  // Cache preflight for 24 hours
}

void WebServerManager::handleCorsPreflightRequest(AsyncWebServerRequest* request) {
    AsyncWebServerResponse* response = request->beginResponse(204);
    addCorsHeaders(response);
    request->send(response);
}
