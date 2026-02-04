/**
 * @file web_routes.cpp
 * @brief Web Server Route Registration
 * 
 * This file contains all route registration logic:
 * - API endpoint registration
 * - Static file handlers
 * - Captive portal redirects
 */

#include "web_server.h"
#include "web_helpers.h"
#include "embedded_assets.h"
#include "../meraki/mqtt_client.h"
#include "../core/dependencies.h"
#include <ArduinoJson.h>
#include <LittleFS.h>

void WebServerManager::setupRoutes() {
    // IMPORTANT: Register API endpoints FIRST, before static file handlers
    // This prevents VFS errors when checking for non-existent static files
    
    // CORS preflight handler for all API endpoints
    // This allows the cloud-hosted embedded app to make cross-origin requests
    server->on("/api/*", HTTP_OPTIONS, [this](AsyncWebServerRequest* request) {
        handleCorsPreflightRequest(request);
    });
    
    // Setup all route groups
    setupApiRoutes();
    setupCaptivePortalRoutes();
    setupStaticRoutes();
}

void WebServerManager::setupApiRoutes() {
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
            handleWifiSave(request, data, len, index, total);
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

    server->on("/api/mdns/restart", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleMdnsRestart(request);
    });

    // Pin configuration endpoints
    server->on("/api/config/pins", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleGetPinConfig(request);
    });
    
    server->on("/api/config/pins", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleSavePinConfig(request, data, len);
        }
    );

    // OTA upload endpoints - use completion handlers from api_ota_upload.cpp
    server->on("/api/ota/upload", HTTP_POST,
        [this](AsyncWebServerRequest* request) {
            handleOTAUploadComplete(request);
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
            handleOTAFilesystemUploadComplete(request);
        },
        [this](AsyncWebServerRequest* request, String filename, size_t index, uint8_t* data, size_t len, bool final) {
            handleOTAFilesystemUploadChunk(request, filename, index, data, len, final);
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
        auto& deps = getDependencies();
        JsonDocument doc;
        doc["debug_enabled"] = deps.mqtt.isDebugEnabled();
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
}

void WebServerManager::setupCaptivePortalRoutes() {
    // Captive portal detection endpoints - redirect to AP IP
    // Consolidate 7 identical redirect handlers into a single helper
    const char* captive_portal_paths[] = {
        "/hotspot-detect.html",
        "/library/test/success.html",
        "/generate_204",
        "/gen_204",
        "/connecttest.txt",
        "/ncsi.txt",
        "/success.txt"
    };
    
    for (size_t i = 0; i < sizeof(captive_portal_paths) / sizeof(captive_portal_paths[0]); i++) {
        server->on(captive_portal_paths[i], HTTP_GET, [](AsyncWebServerRequest* request) {
            request->redirect("http://192.168.4.1/?portal=1");
        });
    }
}

void WebServerManager::setupStaticRoutes() {
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
