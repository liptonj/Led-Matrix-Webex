/**
 * @file web_setup.cpp
 * @brief Minimal Web Server Implementation
 */

#include "web_setup.h"
#include "debug.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>

#ifndef BOOTSTRAP_BUILD
#define BOOTSTRAP_BUILD __DATE__ " " __TIME__
#endif

namespace {
constexpr size_t OTA_BUNDLE_HEADER_SIZE = 16;
const uint8_t OTA_BUNDLE_MAGIC[4] = {'L', 'M', 'W', 'B'};

uint32_t read_le_u32(const uint8_t* data) {
    return static_cast<uint32_t>(data[0]) |
           (static_cast<uint32_t>(data[1]) << 8) |
           (static_cast<uint32_t>(data[2]) << 16) |
           (static_cast<uint32_t>(data[3]) << 24);
}

size_t get_ota_partition_size() {
    const esp_partition_t* partition = esp_ota_get_next_update_partition(nullptr);
    return partition ? partition->size : 0;
}

size_t get_fs_partition_size() {
    const esp_partition_t* partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA,
        ESP_PARTITION_SUBTYPE_DATA_SPIFFS,
        nullptr
    );
    return partition ? partition->size : 0;
}

void log_ota_partition_info(const char* context) {
    const esp_partition_t* partition = esp_ota_get_next_update_partition(nullptr);
    if (!partition) {
        Serial.printf("[WEB] %s OTA partition not found\n", context);
        return;
    }
    Serial.printf("[WEB] %s OTA partition label=%s addr=0x%06x size=%u\n",
                  context,
                  partition->label,
                  static_cast<unsigned>(partition->address),
                  static_cast<unsigned>(partition->size));
}

void log_fs_partition_info(const char* context) {
    const esp_partition_t* partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA,
        ESP_PARTITION_SUBTYPE_DATA_SPIFFS,
        nullptr
    );
    if (!partition) {
        Serial.printf("[WEB] %s FS partition not found\n", context);
        return;
    }
    Serial.printf("[WEB] %s FS partition label=%s addr=0x%06x size=%u\n",
                  context,
                  partition->label,
                  static_cast<unsigned>(partition->address),
                  static_cast<unsigned>(partition->size));
}
}  // namespace

WebSetup::WebSetup()
    : server(nullptr)
    , dns_server(nullptr)
    , config_store(nullptr)
    , wifi_provisioner(nullptr)
    , ota_downloader(nullptr)
    , ota_pending(false)
    , wifi_pending(false)
    , running(false)
    , captive_portal_active(false)
    , selected_release_index(-1)
    , ota_upload_error("")
    , ota_upload_size(0)
    , ota_upload_written(0)
    , ota_upload_next_log(0)
    , ota_upload_received(0)
    , ota_upload_in_progress(false)
    , ota_bundle_mode(false)
    , ota_bundle_header_flushed(false)
    , ota_bundle_header_filled(0)
    , ota_bundle_app_size(0)
    , ota_bundle_fs_size(0)
    , ota_bundle_app_written(0)
    , ota_bundle_fs_written(0)
    , ota_bundle_fs_started(false)
    , ota_upload_progress_callback(nullptr)
    , ota_upload_last_progress(-1)
    , ota_upload_expected_size(0) {
}

WebSetup::~WebSetup() {
    stop();
}

void WebSetup::stop() {
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
    running = false;
    captive_portal_active = false;
    Serial.println("[WEB] Web server stopped");
}

void WebSetup::begin(ConfigStore* config, WiFiProvisioner* wifi, OTADownloader* ota) {
    LOG_FUNC_ENTRY(WEB_TAG);

    // Prevent double initialization
    if (running) {
        LOG_WARN(WEB_TAG, "Web server already running, skipping initialization");
        return;
    }

    config_store = config;
    wifi_provisioner = wifi;
    ota_downloader = ota;

    LOG_DEBUG(WEB_TAG, "Config store: %p, WiFi provisioner: %p, OTA downloader: %p",
              config, wifi, ota);

    // Initialize LittleFS for static files
    LOG_DEBUG(WEB_TAG, "Mounting LittleFS...");
    if (!LittleFS.begin(true)) {
        LOG_WARN(WEB_TAG, "Failed to mount LittleFS, using embedded HTML");
    } else {
        LOG_INFO(WEB_TAG, "LittleFS mounted successfully");
    }

    // Create server on port 80
    LOG_DEBUG(WEB_TAG, "Creating AsyncWebServer on port 80");
    server = new AsyncWebServer(80);

    // Setup routes
    LOG_DEBUG(WEB_TAG, "Setting up routes...");
    setupRoutes();
    LOG_DEBUG(WEB_TAG, "Routes configured");

    // Setup captive portal only if AP is active
    if (wifi_provisioner && wifi_provisioner->isAPActive()) {
        LOG_INFO(WEB_TAG, "AP is active, setting up captive portal");
        setupCaptivePortal();
    } else {
        LOG_DEBUG(WEB_TAG, "Skipping captive portal (AP not active)");
    }

    // Start server
    server->begin();
    running = true;
    LOG_INFO(WEB_TAG, "Web server started on port 80");

    Serial.println("[WEB] Bootstrap web server started on port 80");
}

void WebSetup::setOTAUploadProgressCallback(OTAUploadProgressCallback callback) {
    ota_upload_progress_callback = callback;
}

void WebSetup::reportOTAUploadProgress(int progress, const char* status) {
    if (!ota_upload_progress_callback) {
        return;
    }
    ota_upload_progress_callback(progress, status);
}

void WebSetup::loop() {
    // Process DNS requests for captive portal
    if (dns_server && captive_portal_active) {
        dns_server->processNextRequest();
    }
}

void WebSetup::setupCaptivePortal() {
    // Verify AP IP is valid before starting DNS
    IPAddress ap_ip = WiFi.softAPIP();
    if (ap_ip == IPAddress(0, 0, 0, 0)) {
        Serial.println("[WEB] Cannot start captive portal - AP IP is 0.0.0.0");
        return;
    }

    // Start DNS server for captive portal (redirect all DNS to our IP)
    dns_server = new DNSServer();

    // Start DNS server - redirect all domains to the AP IP
    if (dns_server->start(DNS_PORT, "*", ap_ip)) {
        captive_portal_active = true;
        Serial.println("[WEB] Captive portal DNS started");
        Serial.printf("[WEB] All DNS queries will redirect to %s\n",
                      ap_ip.toString().c_str());
    } else {
        Serial.println("[WEB] Failed to start captive portal DNS");
        delete dns_server;
        dns_server = nullptr;
    }
}

void WebSetup::setupRoutes() {
    // IMPORTANT: Register API endpoints FIRST, before static file handler
    // API endpoints
    server->on("/api/status", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleStatus(request);
    });

    server->on("/api/config", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleConfig(request);
    });

    server->on("/api/scan", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleScan(request);
    });

    server->on("/api/wifi", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleWifiSave(request, data, len);
        }
    );

    server->on("/api/ota-url", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleOTAUrl(request, data, len);
        }
    );

    server->on("/api/start-ota", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleStartOTA(request);
    });

    server->on("/api/ota-progress", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleOTAProgress(request);
    });

    server->on("/api/ota/ping", HTTP_GET, [this](AsyncWebServerRequest* request) {
        JsonDocument doc;
        doc["ok"] = true;
        doc["uptime_ms"] = millis();
        doc["free_heap"] = ESP.getFreeHeap();

        String response;
        serializeJson(doc, response);
        request->send(200, "application/json", response);
        Serial.printf("[WEB] OTA ping from %s\n",
                      request->client() ? request->client()->remoteIP().toString().c_str() : "unknown");
    });

    // Fetch available releases (including beta)
    server->on("/api/releases", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleGetReleases(request);
    });

    // Install specific release by index
    server->on("/api/install-release", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleInstallRelease(request, data, len);
        }
    );

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
                reportOTAUploadProgress(100, "Rebooting...");
                delay(1000);
                ESP.restart();
            } else {
                reportOTAUploadProgress(0, "OTA Failed");
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
                delay(1000);
                ESP.restart();
            }
        },
        [this](AsyncWebServerRequest* request, String filename, size_t index, uint8_t* data, size_t len, bool final) {
            if (index == 0) {
                ota_upload_error = "";
                ota_upload_size = request->contentLength();

                LOG_INFO(WEB_TAG, "LittleFS upload start: %s (%u bytes)",
                         filename.c_str(), static_cast<unsigned>(ota_upload_size));

                size_t total = ota_upload_size;
                size_t fs_partition = get_fs_partition_size();
                if (total > 0 && fs_partition > 0 && total > fs_partition) {
                    ota_upload_error = "LittleFS image too large for partition";
                } else {
                    LittleFS.end();
                    if (total == 0) {
                        if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_SPIFFS)) {
                            String err = Update.errorString();
                            ota_upload_error = (err.isEmpty() || err == "No Error")
                                ? "Failed to start LittleFS update"
                                : err;
                            Serial.printf("[WEB] Update.begin LittleFS failed: code=%u err=%s\n",
                                          static_cast<unsigned>(Update.getError()),
                                          ota_upload_error.c_str());
                            log_fs_partition_info("Update.begin LittleFS failed");
                        }
                    } else if (!Update.begin(total, U_SPIFFS)) {
                        String err = Update.errorString();
                        ota_upload_error = (err.isEmpty() || err == "No Error")
                            ? "Failed to start LittleFS update"
                            : err;
                        Serial.printf("[WEB] Update.begin LittleFS failed: code=%u err=%s\n",
                                      static_cast<unsigned>(Update.getError()),
                                      ota_upload_error.c_str());
                        log_fs_partition_info("Update.begin LittleFS failed");
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
                LOG_INFO(WEB_TAG, "LittleFS upload %s (%u bytes)",
                         ota_upload_error.isEmpty() ? "complete" : "failed",
                         static_cast<unsigned>(ota_upload_size));
            }
        }
    );

    // AFTER API routes: Serve static files from LittleFS or embedded HTML
    if (LittleFS.exists("/index.html")) {
        server->serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
    } else {
        // Serve embedded HTML if LittleFS not available
        server->on("/", HTTP_GET, [this](AsyncWebServerRequest* request) {
            handleRoot(request);
        });
    }

    // Captive portal detection endpoints - redirect to setup page
    // Apple
    server->on("/hotspot-detect.html", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });
    server->on("/library/test/success.html", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });

    // Android
    server->on("/generate_204", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });
    server->on("/gen_204", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });

    // Windows
    server->on("/connecttest.txt", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });
    server->on("/ncsi.txt", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });

    // Firefox
    server->on("/success.txt", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });

    // Fallback - redirect unknown requests only in captive portal mode
    server->onNotFound([this](AsyncWebServerRequest* request) {
        // If it's an API request, return 404
        if (request->url().startsWith("/api/")) {
            if (request->url().startsWith("/api/ota/")) {
                Serial.printf("[WEB] OTA API not found: %s\n", request->url().c_str());
            }
            request->send(404, "application/json", "{\"error\":\"Not found\"}");
            return;
        }
        // Redirect only when captive portal is active (AP mode)
        if (captive_portal_active) {
            request->redirect("http://192.168.4.1/");
            return;
        }
        request->send(404, "text/plain", "Not found");
    });
}

void WebSetup::handleOTAUploadChunk(
    AsyncWebServerRequest* request,
    const String& filename,
    size_t index,
    uint8_t* data,
    size_t len,
    bool final,
    size_t total
) {
    if (index == 0) {
        ota_upload_error = "";
        size_t upload_total = total > 0 ? total : request->contentLength();
        ota_upload_size = upload_total;
        ota_upload_written = 0;
        ota_upload_next_log = 64 * 1024;
        ota_upload_received = 0;
        ota_upload_in_progress = true;
        ota_bundle_mode = false;
        ota_bundle_header_flushed = false;
        ota_bundle_header_filled = 0;
        ota_bundle_app_size = 0;
        ota_bundle_fs_size = 0;
        ota_bundle_app_written = 0;
        ota_bundle_fs_written = 0;
        ota_bundle_fs_started = false;
        ota_upload_last_progress = -1;
        ota_upload_expected_size = ota_upload_size;

        LOG_INFO(WEB_TAG, "OTA upload start: %s (%u bytes)",
                 filename.c_str(), static_cast<unsigned>(ota_upload_size));
        Serial.printf("[WEB] OTA upload start (index=0) file=%s size=%u\n",
                      filename.c_str(),
                      static_cast<unsigned>(ota_upload_size));
        log_ota_partition_info("OTA upload start");
        log_fs_partition_info("OTA upload start");
        reportOTAUploadProgress(0, "Uploading...");
        WiFi.setSleep(false);
        if (request->client()) {
            request->client()->setNoDelay(true);
            request->client()->setRxTimeout(120);
            request->client()->setAckTimeout(120000);
        }
        request->onDisconnect([this]() {
            Serial.printf("[WEB] OTA upload disconnect: received=%u expected=%u written=%u\n",
                          static_cast<unsigned>(ota_upload_received),
                          static_cast<unsigned>(ota_upload_size),
                          static_cast<unsigned>(ota_upload_written));
            if (ota_upload_size > 0 && ota_upload_received < ota_upload_size) {
                ota_upload_error = "OTA upload disconnected";
                Update.abort();
                reportOTAUploadProgress(0, ota_upload_error.c_str());
            }
            WiFi.setSleep(true);
            ota_upload_in_progress = false;
        });
    }

    ota_upload_received += len;

    if (!ota_upload_error.isEmpty()) {
        if (final) {
            Update.abort();
        }
        if (final) {
            ota_upload_in_progress = false;
        }
        return;
    }

    size_t offset = 0;
    if (ota_bundle_header_filled < OTA_BUNDLE_HEADER_SIZE) {
        size_t to_copy = min(OTA_BUNDLE_HEADER_SIZE - ota_bundle_header_filled, len);
        memcpy(ota_bundle_header + ota_bundle_header_filled, data, to_copy);
        ota_bundle_header_filled += to_copy;
        offset += to_copy;

        if (ota_bundle_header_filled == OTA_BUNDLE_HEADER_SIZE) {
            if (memcmp(ota_bundle_header, OTA_BUNDLE_MAGIC, sizeof(OTA_BUNDLE_MAGIC)) == 0) {
                ota_bundle_mode = true;
                ota_bundle_app_size = read_le_u32(ota_bundle_header + 4);
                ota_bundle_fs_size = read_le_u32(ota_bundle_header + 8);
                size_t expected_size = OTA_BUNDLE_HEADER_SIZE + ota_bundle_app_size + ota_bundle_fs_size;
                ota_upload_expected_size = expected_size;
                Serial.printf("[WEB] OTA bundle sizes app=%u fs=%u expected=%u content=%u\n",
                              static_cast<unsigned>(ota_bundle_app_size),
                              static_cast<unsigned>(ota_bundle_fs_size),
                              static_cast<unsigned>(expected_size),
                              static_cast<unsigned>(ota_upload_size));

                if (ota_bundle_app_size == 0 || ota_bundle_fs_size == 0) {
                    ota_upload_error = "Invalid OTA bundle sizes";
                } else if (ota_upload_size > 0 && ota_upload_size < expected_size) {
                    ota_upload_error = "OTA bundle size mismatch";
                } else if (get_ota_partition_size() > 0 &&
                           ota_bundle_app_size > get_ota_partition_size()) {
                    ota_upload_error = "App image too large for OTA partition";
                } else if (get_fs_partition_size() > 0 &&
                           ota_bundle_fs_size > get_fs_partition_size()) {
                    ota_upload_error = "LittleFS image too large for partition";
                } else {
                    const esp_partition_t* ota_partition = esp_ota_get_next_update_partition(nullptr);
                    const char* ota_label = ota_partition ? ota_partition->label : nullptr;
                    if (!ota_partition) {
                        ota_upload_error = "OTA partition not found";
                        reportOTAUploadProgress(0, ota_upload_error.c_str());
                    } else if (!Update.begin(ota_bundle_app_size, U_FLASH, -1, LOW, ota_label)) {
                        String err = Update.errorString();
                        ota_upload_error = (err.isEmpty() || err == "No Error")
                            ? "Failed to start OTA update"
                            : err;
                        reportOTAUploadProgress(0, ota_upload_error.c_str());
                        Serial.printf("[WEB] Update.begin app failed: code=%u err=%s\n",
                                      static_cast<unsigned>(Update.getError()),
                                      ota_upload_error.c_str());
                        log_ota_partition_info("Update.begin app failed");
                    } else {
                        LOG_INFO(WEB_TAG, "OTA bundle detected: app=%u fs=%u",
                                 static_cast<unsigned>(ota_bundle_app_size),
                                 static_cast<unsigned>(ota_bundle_fs_size));
                        Serial.printf("[WEB] OTA bundle detected app=%u fs=%u\n",
                                      static_cast<unsigned>(ota_bundle_app_size),
                                      static_cast<unsigned>(ota_bundle_fs_size));
                    }
                }
                if (!ota_upload_error.isEmpty()) {
                    Serial.printf("[WEB] OTA bundle error: %s\n", ota_upload_error.c_str());
                    reportOTAUploadProgress(0, ota_upload_error.c_str());
                }
            } else {
                size_t app_total = ota_upload_size;
                size_t ota_partition = get_ota_partition_size();
                if (app_total > 0 && ota_partition > 0 && app_total > ota_partition) {
                    ota_upload_error = "App image too large for OTA partition";
                    reportOTAUploadProgress(0, ota_upload_error.c_str());
                } else {
                    const esp_partition_t* ota_partition = esp_ota_get_next_update_partition(nullptr);
                    const char* ota_label = ota_partition ? ota_partition->label : nullptr;
                    if (!ota_partition) {
                        ota_upload_error = "OTA partition not found";
                        reportOTAUploadProgress(0, ota_upload_error.c_str());
                    } else if (app_total == 0) {
                        if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH, -1, LOW, ota_label)) {
                            String err = Update.errorString();
                            ota_upload_error = (err.isEmpty() || err == "No Error")
                                ? "Failed to start OTA update"
                                : err;
                            reportOTAUploadProgress(0, ota_upload_error.c_str());
                            Serial.printf("[WEB] Update.begin app failed: code=%u err=%s\n",
                                          static_cast<unsigned>(Update.getError()),
                                          ota_upload_error.c_str());
                            log_ota_partition_info("Update.begin app failed");
                        }
                    } else if (!Update.begin(app_total, U_FLASH, -1, LOW, ota_label)) {
                        String err = Update.errorString();
                        ota_upload_error = (err.isEmpty() || err == "No Error")
                            ? "Failed to start OTA update"
                            : err;
                        reportOTAUploadProgress(0, ota_upload_error.c_str());
                        Serial.printf("[WEB] Update.begin app failed: code=%u err=%s\n",
                                      static_cast<unsigned>(Update.getError()),
                                      ota_upload_error.c_str());
                        log_ota_partition_info("Update.begin app failed");
                    }
                }
                if (!ota_upload_error.isEmpty()) {
                    Serial.printf("[WEB] OTA upload error: %s\n", ota_upload_error.c_str());
                    reportOTAUploadProgress(0, ota_upload_error.c_str());
                }
            }
        } else {
            if (final) {
                ota_upload_error = "Incomplete OTA upload";
                reportOTAUploadProgress(0, ota_upload_error.c_str());
            }
            return;
        }
    }

    auto write_chunk = [this](const uint8_t* buffer, size_t size) -> size_t {
        if (size == 0 || !ota_upload_error.isEmpty()) {
            return 0;
        }
        size_t written = Update.write(const_cast<uint8_t*>(buffer), size);
        if (written != size) {
            ota_upload_error = Update.errorString();
            Serial.printf("[WEB] OTA write error: wrote=%u expected=%u err=%s\n",
                          static_cast<unsigned>(written),
                          static_cast<unsigned>(size),
                          ota_upload_error.c_str());
            reportOTAUploadProgress(0, ota_upload_error.c_str());
        }
        return written;
    };

    if (ota_bundle_mode) {
        const uint8_t* ptr = data + offset;
        size_t remaining = len - offset;
        while (remaining > 0 && ota_upload_error.isEmpty()) {
            delay(0);
            if (ota_bundle_app_written < ota_bundle_app_size) {
                size_t to_write = min(remaining, ota_bundle_app_size - ota_bundle_app_written);
                size_t written = write_chunk(ptr, to_write);
                ota_bundle_app_written += written;
                ota_upload_written += written;
                ptr += to_write;
                remaining -= to_write;

                if (ota_bundle_app_written == ota_bundle_app_size && ota_upload_error.isEmpty()) {
                    if (!Update.end(true)) {
                        ota_upload_error = Update.errorString();
                        break;
                    }
                    LOG_INFO(WEB_TAG, "OTA bundle app complete, starting LittleFS write");
                    if (!Update.begin(ota_bundle_fs_size, U_SPIFFS)) {
                        String err = Update.errorString();
                        ota_upload_error = (err.isEmpty() || err == "No Error")
                            ? "Failed to start LittleFS update"
                            : err;
                        reportOTAUploadProgress(0, ota_upload_error.c_str());
                        Serial.printf("[WEB] Update.begin LittleFS failed: code=%u err=%s\n",
                                      static_cast<unsigned>(Update.getError()),
                                      ota_upload_error.c_str());
                        log_fs_partition_info("Update.begin LittleFS failed");
                        break;
                    }
                    ota_bundle_fs_started = true;
                }
            } else {
                if (ota_bundle_fs_written >= ota_bundle_fs_size) {
                    ota_upload_error = "OTA bundle has extra data";
                    reportOTAUploadProgress(0, ota_upload_error.c_str());
                    break;
                }
                size_t to_write = min(remaining, ota_bundle_fs_size - ota_bundle_fs_written);
                size_t written = write_chunk(ptr, to_write);
                ota_bundle_fs_written += written;
                ota_upload_written += written;
                ptr += to_write;
                remaining -= to_write;
            }
            if (ota_upload_written >= ota_upload_next_log) {
                size_t progress_total = ota_upload_size > 0
                    ? ota_upload_size
                    : (ota_bundle_app_size + ota_bundle_fs_size + OTA_BUNDLE_HEADER_SIZE);
                Serial.printf("[WEB] OTA upload progress: %u/%u bytes (heap=%u)\n",
                              static_cast<unsigned>(ota_upload_written),
                              static_cast<unsigned>(progress_total),
                              static_cast<unsigned>(ESP.getFreeHeap()));
                ota_upload_next_log += 64 * 1024;
            }

            size_t percent_total = ota_upload_expected_size > 0
                ? ota_upload_expected_size
                : ota_upload_size;
            if (percent_total > 0) {
                int progress = static_cast<int>((ota_upload_written * 100) / percent_total);
                if (progress > 99) {
                    progress = 99;
                }
                if (progress != ota_upload_last_progress) {
                    ota_upload_last_progress = progress;
                    reportOTAUploadProgress(progress, "Uploading...");
                }
            }
        }
    } else {
        if (!ota_bundle_header_flushed) {
            ota_upload_written += write_chunk(ota_bundle_header, ota_bundle_header_filled);
            ota_bundle_header_flushed = true;
        }
        ota_upload_written += write_chunk(data + offset, len - offset);
        delay(0);
        if (ota_upload_written >= ota_upload_next_log) {
            size_t progress_total = ota_upload_size > 0 ? ota_upload_size : 0;
            Serial.printf("[WEB] OTA upload progress: %u/%u bytes (heap=%u)\n",
                          static_cast<unsigned>(ota_upload_written),
                          static_cast<unsigned>(progress_total),
                          static_cast<unsigned>(ESP.getFreeHeap()));
            ota_upload_next_log += 64 * 1024;
        }

        size_t percent_total = ota_upload_expected_size > 0 ? ota_upload_expected_size : ota_upload_size;
        if (percent_total > 0) {
            int progress = static_cast<int>((ota_upload_written * 100) / percent_total);
            if (progress > 99) {
                progress = 99;
            }
            if (progress != ota_upload_last_progress) {
                ota_upload_last_progress = progress;
                reportOTAUploadProgress(progress, "Uploading...");
            }
        }
    }

    if (final) {
        if (ota_upload_error.isEmpty()) {
            if (ota_bundle_mode) {
                if (ota_bundle_app_written != ota_bundle_app_size ||
                    ota_bundle_fs_written != ota_bundle_fs_size) {
                    ota_upload_error = "OTA bundle incomplete";
                } else if (ota_bundle_fs_started && !Update.end(true)) {
                    ota_upload_error = Update.errorString();
                }
            } else if (!Update.end(true)) {
                ota_upload_error = Update.errorString();
            }
        } else {
            Update.abort();
        }
        LOG_INFO(WEB_TAG, "OTA upload %s (%u bytes)",
                 ota_upload_error.isEmpty() ? "complete" : "failed",
                 static_cast<unsigned>(ota_upload_size));
        Serial.printf("[WEB] OTA upload %s size=%u app_written=%u fs_written=%u app_or_bin_written=%u\n",
                      ota_upload_error.isEmpty() ? "complete" : "failed",
                      static_cast<unsigned>(ota_upload_size),
                      static_cast<unsigned>(ota_bundle_app_written),
                      static_cast<unsigned>(ota_bundle_fs_written),
                      static_cast<unsigned>(ota_upload_written));
        if (!ota_upload_error.isEmpty()) {
            Serial.printf("[WEB] OTA upload error: %s\n", ota_upload_error.c_str());
            reportOTAUploadProgress(0, "OTA Failed");
        }
        WiFi.setSleep(true);
        ota_upload_in_progress = false;
    }
}

void WebSetup::handleRoot(AsyncWebServerRequest* request) {
    // Embedded minimal HTML if LittleFS not available
    String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Webex Display Setup</title>
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:-apple-system,sans-serif;background:#1a1a2e;color:#eee;padding:20px}
        .container{max-width:400px;margin:0 auto}
        h1{text-align:center;margin-bottom:20px;color:#00bceb}
        .card{background:#16213e;border-radius:8px;padding:20px;margin-bottom:15px}
        h2{font-size:1.1em;margin-bottom:15px;color:#00bceb}
        .form-group{margin-bottom:15px}
        label{display:block;margin-bottom:5px;font-size:0.9em;color:#aaa}
        input,select{width:100%;padding:10px;border:1px solid #333;border-radius:4px;background:#0f0f23;color:#fff}
        input:focus{border-color:#00bceb;outline:none}
        .btn{display:block;width:100%;padding:12px;border:none;border-radius:4px;font-size:1em;cursor:pointer;margin-top:10px}
        .btn-primary{background:#00bceb;color:#000}
        .btn-primary:hover{background:#00a4d1}
        .btn-secondary{background:#333;color:#fff}
        .network-list{max-height:200px;overflow-y:auto;margin:10px 0}
        .network{padding:10px;background:#0f0f23;border-radius:4px;margin-bottom:5px;cursor:pointer;display:flex;justify-content:space-between}
        .network:hover{background:#1a1a3e}
        .progress{height:20px;background:#333;border-radius:10px;overflow:hidden;margin:10px 0}
        .progress-bar{height:100%;background:#00bceb;transition:width 0.3s}
        .status{text-align:center;padding:10px;font-size:0.9em;color:#aaa}
        .collapse{display:none}
        .collapse.show{display:block}
        .toggle{color:#00bceb;cursor:pointer;font-size:0.9em}
    </style>
</head>
<body>
    <div class="container">
        <h1>Webex Display Setup</h1>

        <div class="card">
            <h2>WiFi Configuration</h2>
            <button class="btn btn-secondary" onclick="scanNetworks()">Scan Networks</button>
            <div id="networks" class="network-list"></div>
            <form id="wifi-form" onsubmit="saveWifi(event)">
                <div class="form-group">
                    <label>SSID</label>
                    <input type="text" id="ssid" required>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" id="password">
                </div>
                <button type="submit" class="btn btn-primary">Connect</button>
            </form>
        </div>

        <div class="card">
            <h2>Firmware Update</h2>
            <button class="btn btn-secondary" onclick="loadReleases()">Check for Updates</button>
            <div class="form-group" style="margin-top:10px">
                <label>Select Version</label>
                <select id="release-select" style="width:100%;padding:10px;background:#0f0f23;color:#fff;border:1px solid #333;border-radius:4px">
                    <option value="-1">Latest Stable (Auto)</option>
                </select>
            </div>
            <div id="ota-status" class="status">Ready to install firmware</div>
            <div class="progress"><div id="progress-bar" class="progress-bar" style="width:0%"></div></div>
            <button class="btn btn-primary" onclick="installSelected()">Install Selected</button>
            <p class="toggle" onclick="toggleAdvanced()">Advanced Options</p>
            <div id="advanced" class="collapse">
                <div class="form-group">
                    <label>Custom OTA URL (optional)</label>
                    <input type="text" id="ota-url" placeholder="Leave empty for default">
                </div>
                <button class="btn btn-secondary" onclick="saveOTAUrl()">Save URL</button>
            </div>
            <div class="form-group" style="margin-top:15px">
                <label>Manual Firmware Upload (.bin or bundle)</label>
                <input type="file" id="manual-file" accept=".bin">
                <button class="btn btn-secondary" onclick="startManualUpload()" id="manual-upload-btn" disabled>Upload Firmware</button>
                <div id="manual-upload-status" class="status">Select a firmware or OTA bundle file to upload</div>
            </div>
            <div class="form-group" style="margin-top:15px">
                <label>Manual LittleFS Upload (.bin)</label>
                <input type="file" id="manual-fs-file" accept=".bin">
                <button class="btn btn-secondary" onclick="startManualFsUpload()" id="manual-fs-upload-btn" disabled>Upload LittleFS</button>
                <div id="manual-fs-upload-status" class="status">Select a filesystem image to upload</div>
            </div>
        </div>

        <div class="card">
            <h2>Status</h2>
            <div id="device-status" class="status">Loading...</div>
        </div>
    </div>
    <script>
        var scannedNetworks=[];
        var isWifiConnected=false;
        function scanNetworks(){
            document.getElementById('networks').innerHTML='<div style="text-align:center;padding:20px">Scanning...</div>';
            fetch('/api/scan')
            .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
            .then(function(d){
                scannedNetworks=d.networks||[];
                var html='';
                for(var i=0;i<scannedNetworks.length;i++){
                    var n=scannedNetworks[i];
                    if(n.ssid){
                        html+='<div class="network" onclick="selectNetwork('+i+')"><span>'+n.ssid+'</span><span>'+n.rssi+'dBm '+(n.encrypted?'&#128274;':'')+'</span></div>';
                    }
                }
                document.getElementById('networks').innerHTML=html||'<div style="text-align:center;padding:10px">No networks found</div>';
            }).catch(function(e){
                document.getElementById('networks').innerHTML='<div style="text-align:center;padding:10px;color:#ff6b6b">Scan failed</div>';
            });
        }
        function selectNetwork(idx){document.getElementById('ssid').value=scannedNetworks[idx].ssid;}
        function saveWifi(e){
            e.preventDefault();
            const ssid=document.getElementById('ssid').value;
            const password=document.getElementById('password').value;
            fetch('/api/wifi',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({ssid,password})
            }).then(r=>r.json()).then(d=>{
                alert(d.message||'WiFi saved! Connecting...');
            }).catch(()=>alert('Failed to save WiFi'));
        }
        function loadReleases(){
            if(!isWifiConnected){
                document.getElementById('ota-status').textContent='Connect to WiFi to load versions';
                return;
            }
            document.getElementById('ota-status').textContent='Loading versions from GitHub...';
            const controller=new AbortController();
            const timeout=setTimeout(()=>controller.abort(),15000);
            fetch('/api/releases',{signal:controller.signal})
            .then(r=>{clearTimeout(timeout);if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
            .then(d=>{
                const select=document.getElementById('release-select');
                select.innerHTML='<option value="-1">Latest Stable (Auto)</option>';
                if(!d.cached&&d.error){
                    document.getElementById('ota-status').textContent=d.error;
                    return;
                }
                if(d.releases&&d.releases.length>0){
                    d.releases.forEach(r=>{
                        const beta=r.is_beta?' [BETA]':'';
                        const opt=document.createElement('option');
                        opt.value=r.index;
                        opt.textContent=r.version+beta;
                        if(r.is_beta)opt.style.color='#ffcc00';
                        select.appendChild(opt);
                    });
                    document.getElementById('ota-status').textContent='Found '+d.count+' versions - select and install';
                }else{
                    document.getElementById('ota-status').textContent='No releases found (use Latest Stable)';
                }
            }).catch(e=>{
                clearTimeout(timeout);
                document.getElementById('ota-status').textContent='Error: '+(e.name==='AbortError'?'Request timeout':''+e.message);
            });
        }
        function installSelected(){
            const idx=parseInt(document.getElementById('release-select').value);
            document.getElementById('ota-status').textContent='Starting update...';
            if(idx>=0){
                fetch('/api/install-release',{
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({index:idx})
                }).then(r=>r.json()).then(d=>{
                    if(d.success)pollProgress();
                    else document.getElementById('ota-status').textContent=d.error||'Failed';
                });
            }else{
                fetch('/api/start-ota',{method:'POST'}).then(r=>r.json()).then(d=>{
                    if(d.success)pollProgress();
                    else document.getElementById('ota-status').textContent=d.error||'Failed';
                });
            }
        }
        function pollProgress(){
            fetch('/api/ota-progress').then(r=>r.json()).then(d=>{
                document.getElementById('ota-status').textContent=d.message;
                document.getElementById('progress-bar').style.width=d.progress+'%';
                if(d.progress<100&&d.status!=='error')setTimeout(pollProgress,500);
            });
        }
        function saveOTAUrl(){
            const url=document.getElementById('ota-url').value;
            fetch('/api/ota-url',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({url})
            }).then(r=>r.json()).then(d=>alert(d.message||'URL saved'));
        }
        function toggleAdvanced(){
            document.getElementById('advanced').classList.toggle('show');
        }
        function loadStatus(){
            fetch('/api/status').then(r=>r.json()).then(d=>{
                let html=`WiFi: ${d.wifi_connected?'Connected':'Disconnected'}<br>`;
                html+=`IP: ${d.ip_address}<br>`;
                html+=`Version: ${d.version}<br>`;
                html+=`Build ID: ${d.build||'--'}`;
                document.getElementById('device-status').innerHTML=html;
                isWifiConnected=!!d.wifi_connected;
            });
        }
        function initManualUpload(){
            const input=document.getElementById('manual-file');
            const btn=document.getElementById('manual-upload-btn');
            const status=document.getElementById('manual-upload-status');
            if(!input||!btn||!status){return;}
            input.addEventListener('change',()=>{
                const hasFile=input.files&&input.files.length>0;
                btn.disabled=!hasFile;
                status.textContent=hasFile?'Ready to upload.':'Select a firmware or OTA bundle file to upload';
            });
        }
        function initManualFsUpload(){
            const input=document.getElementById('manual-fs-file');
            const btn=document.getElementById('manual-fs-upload-btn');
            const status=document.getElementById('manual-fs-upload-status');
            if(!input||!btn||!status){return;}
            input.addEventListener('change',()=>{
                const hasFile=input.files&&input.files.length>0;
                btn.disabled=!hasFile;
                status.textContent=hasFile?'Ready to upload.':'Select a filesystem image to upload';
            });
        }
        function startManualUpload(){
            const input=document.getElementById('manual-file');
            const btn=document.getElementById('manual-upload-btn');
            const status=document.getElementById('manual-upload-status');
            if(!input||!btn||!status||!input.files||input.files.length===0){
                if(status)status.textContent='No file selected';
                return;
            }
            if(!confirm('Upload firmware or OTA bundle file? The device will restart when complete.')){
                return;
            }
            const file=input.files[0];
            btn.disabled=true;
            status.textContent='Uploading...';
            const xhr=new XMLHttpRequest();
            xhr.open('POST','/api/ota/upload');
            xhr.setRequestHeader('Content-Type','application/octet-stream');
            xhr.upload.onprogress=(event)=>{
                if(!event.lengthComputable)return;
                const percent=Math.round((event.loaded/event.total)*100);
                status.textContent='Uploading... '+percent+'%';
            };
            xhr.onload=()=>{
                let message='Upload complete. Rebooting...';
                let wasSuccessful=xhr.status>=200&&xhr.status<300;
                if(xhr.responseText){
                    try{
                        const response=JSON.parse(xhr.responseText);
                        if(typeof response.success==='boolean'){
                            wasSuccessful=response.success;
                        }
                        message=response.message||message;
                    }catch(e){}
                }
                status.textContent=message;
                if(!wasSuccessful){
                    btn.disabled=false;
                }
            };
            xhr.onerror=()=>{
                status.textContent='Upload failed. Please try again.';
                btn.disabled=false;
            };
            xhr.send(file);
        }
        function startManualFsUpload(){
            const input=document.getElementById('manual-fs-file');
            const btn=document.getElementById('manual-fs-upload-btn');
            const status=document.getElementById('manual-fs-upload-status');
            if(!input||!btn||!status||!input.files||input.files.length===0){
                if(status)status.textContent='No file selected';
                return;
            }
            if(!confirm('Upload LittleFS image? The device will restart when complete.')){
                return;
            }
            const file=input.files[0];
            btn.disabled=true;
            status.textContent='Uploading...';
            const xhr=new XMLHttpRequest();
            xhr.open('POST','/api/ota/upload-fs');
            xhr.setRequestHeader('Content-Type','application/octet-stream');
            xhr.upload.onprogress=(event)=>{
                if(!event.lengthComputable)return;
                const percent=Math.round((event.loaded/event.total)*100);
                status.textContent='Uploading... '+percent+'%';
            };
            xhr.onload=()=>{
                let message='Upload complete. Rebooting...';
                let wasSuccessful=xhr.status>=200&&xhr.status<300;
                if(xhr.responseText){
                    try{
                        const response=JSON.parse(xhr.responseText);
                        if(typeof response.success==='boolean'){
                            wasSuccessful=response.success;
                        }
                        message=response.message||message;
                    }catch(e){}
                }
                status.textContent=message;
                if(!wasSuccessful){
                    btn.disabled=false;
                }
            };
            xhr.onerror=()=>{
                status.textContent='Upload failed. Please try again.';
                btn.disabled=false;
            };
            xhr.send(file);
        }
        loadStatus();setInterval(loadStatus,5000);
        initManualUpload();
        initManualFsUpload();
        // Auto-load releases on page load
        setTimeout(loadReleases, 1000);
    </script>
</body>
</html>
)rawliteral";

    request->send(200, "text/html", html);
}

void WebSetup::handleStatus(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["upload_in_progress"] = ota_upload_in_progress;
    if (ota_upload_in_progress) {
        doc["message"] = "Upload in progress";
    }

    doc["wifi_connected"] = wifi_provisioner->isConnected();
    doc["ap_active"] = wifi_provisioner->isAPActive();
    doc["ip_address"] = wifi_provisioner->getIPAddress().toString();
    doc["ap_ip"] = wifi_provisioner->getAPIPAddress().toString();

    #ifdef BOOTSTRAP_VERSION
    doc["version"] = BOOTSTRAP_VERSION;
    #else
    doc["version"] = "0.0.0-dev";
    #endif
    doc["build"] = BOOTSTRAP_BUILD;

    doc["free_heap"] = ESP.getFreeHeap();
    doc["ota_url"] = config_store->getOTAUrl();

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebSetup::handleConfig(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["has_wifi"] = config_store->hasWiFi();
    doc["wifi_ssid"] = config_store->getWiFiSSID();
    doc["ota_url"] = config_store->getOTAUrl();
    doc["has_custom_ota_url"] = config_store->hasCustomOTAUrl();

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebSetup::handleScan(AsyncWebServerRequest* request) {
    LOG_FUNC_ENTRY(WEB_TAG);

    // Use cached scan results from boot - avoid blocking the web server
    // If no cached results, return empty and let client retry
    int count = wifi_provisioner->getScannedNetworkCount();

    LOG_DEBUG(WEB_TAG, "Scan request - returning %d cached networks", count);

    JsonDocument doc;
    JsonArray networks = doc["networks"].to<JsonArray>();

    for (int i = 0; i < count; i++) {
        String ssid = wifi_provisioner->getScannedSSID(i);
        if (ssid.length() > 0) {  // Skip empty SSIDs
            JsonObject network = networks.add<JsonObject>();
            network["ssid"] = ssid;
            network["rssi"] = wifi_provisioner->getScannedRSSI(i);
            network["encrypted"] = wifi_provisioner->isScannedNetworkEncrypted(i);
        }
    }

    doc["cached"] = true;
    doc["count"] = networks.size();

    String response;
    serializeJson(doc, response);
    Serial.printf("[WEB] Scan response: %s\n", response.c_str());
    request->send(200, "application/json", response);
}

void WebSetup::handleWifiSave(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String body = String((char*)data).substring(0, len);

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }

    String ssid = doc["ssid"].as<String>();
    String password = doc["password"].as<String>();

    if (ssid.isEmpty()) {
        request->send(400, "application/json", "{\"error\":\"SSID required\"}");
        return;
    }

    // Save credentials
    config_store->setWiFiCredentials(ssid, password);
    wifi_pending = true;

    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"WiFi saved. Will connect shortly...\"}");
}

void WebSetup::handleOTAUrl(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String body = String((char*)data).substring(0, len);

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }

    String url = doc["url"].as<String>();
    config_store->setOTAUrl(url);

    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"OTA URL saved\"}");
}

void WebSetup::handleStartOTA(AsyncWebServerRequest* request) {
    if (!wifi_provisioner->isConnected()) {
        request->send(400, "application/json",
                      "{\"error\":\"WiFi not connected\"}");
        return;
    }

    ota_pending = true;
    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"OTA update starting...\"}");
}

void WebSetup::handleOTAProgress(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["progress"] = ota_downloader->getProgress();
    doc["message"] = ota_downloader->getStatusMessage();

    OTAStatus status = ota_downloader->getStatus();
    if (status == OTAStatus::SUCCESS) {
        doc["status"] = "success";
    } else if (status >= OTAStatus::ERROR_NO_URL) {
        doc["status"] = "error";
    } else {
        doc["status"] = "in_progress";
    }

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

bool WebSetup::isOTAPending() const {
    return ota_pending;
}

void WebSetup::clearOTAPending() {
    ota_pending = false;
}

bool WebSetup::isWiFiPending() const {
    return wifi_pending;
}

void WebSetup::clearWiFiPending() {
    wifi_pending = false;
}

void WebSetup::handleGetReleases(AsyncWebServerRequest* request) {
    LOG_FUNC_ENTRY(WEB_TAG);

    if (ota_upload_in_progress) {
        JsonDocument doc;
        doc["releases"] = JsonArray();
        doc["count"] = 0;
        doc["cached"] = false;
        doc["upload_in_progress"] = true;
        doc["error"] = "Upload in progress";
        doc["retry_after_ms"] = 5000;
        String response;
        serializeJson(doc, response);
        request->send(200, "application/json", response);
        return;
    }

    // Return cached releases immediately - don't block the web server
    // Releases are fetched in background on boot

    int count = ota_downloader->getReleaseCount();
    bool cached = ota_downloader->hasReleasesCached();
    String fetch_error = ota_downloader->getReleaseFetchError();

    LOG_DEBUG(WEB_TAG, "Releases request - cached: %s, count: %d",
              cached ? "yes" : "no", count);

    JsonDocument doc;
    JsonArray releases = doc["releases"].to<JsonArray>();

    for (int i = 0; i < count; i++) {
        ReleaseInfo release = ota_downloader->getRelease(i);
        if (release.valid) {
            JsonObject rel = releases.add<JsonObject>();
            rel["index"] = i;
            rel["version"] = release.version;
            rel["is_beta"] = release.is_prerelease;
            rel["published"] = release.published_at;
        }
    }

    doc["count"] = count;
    doc["cached"] = cached;
    doc["last_fetch_ms"] = ota_downloader->getLastReleaseFetchMs();

    if (!fetch_error.isEmpty()) {
        doc["error"] = fetch_error;
    }

    // If not cached yet, tell client to retry
    if (!cached && fetch_error.isEmpty()) {
        doc["message"] = "Fetching releases (may take up to 60s)...";
        doc["retry_after_ms"] = 5000;  // Tell client to retry after 5s
    }

    String response;
    serializeJson(doc, response);
    Serial.printf("[WEB] Releases response: %s\n", response.c_str());
    request->send(200, "application/json", response);
}

void WebSetup::handleInstallRelease(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String body = String((char*)data).substring(0, len);

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }

    int index = doc["index"].as<int>();

    ReleaseInfo release = ota_downloader->getRelease(index);
    if (!release.valid) {
        request->send(400, "application/json", "{\"error\":\"Invalid release index\"}");
        return;
    }

    Serial.printf("[WEB] Installing release %d: %s\n", index, release.version.c_str());

    // Store the index for installation
    selected_release_index = index;
    ota_pending = true;

    JsonDocument response;
    response["success"] = true;
    response["message"] = "Installing " + release.version;
    response["version"] = release.version;
    response["is_beta"] = release.is_prerelease;

    String responseStr;
    serializeJson(response, responseStr);
    request->send(200, "application/json", responseStr);
}
