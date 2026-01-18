/**
 * @file ota_downloader.cpp
 * @brief OTA Firmware Downloader Implementation
 */

#include "ota_downloader.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Update.h>

OTADownloader::OTADownloader()
    : config_store(nullptr)
    , status(OTAStatus::IDLE)
    , progress(0)
    , progress_callback(nullptr) {
}

OTADownloader::~OTADownloader() {
}

void OTADownloader::begin(ConfigStore* config) {
    config_store = config;
    Serial.println("[OTA] Downloader initialized");
}

void OTADownloader::updateStatus(OTAStatus new_status, const String& message) {
    status = new_status;
    status_message = message;
    Serial.printf("[OTA] %s\n", message.c_str());
}

void OTADownloader::updateProgress(int new_progress, const String& message) {
    progress = new_progress;
    status_message = message;
    
    if (progress_callback) {
        progress_callback(progress, message.c_str());
    }
    
    Serial.printf("[OTA] %d%% - %s\n", progress, message.c_str());
}

bool OTADownloader::checkAndInstall() {
    if (!config_store) {
        updateStatus(OTAStatus::ERROR_NO_URL, "Config store not initialized");
        return false;
    }

    String ota_url = config_store->getOTAUrl();
    if (ota_url.isEmpty()) {
        updateStatus(OTAStatus::ERROR_NO_URL, "No OTA URL configured");
        return false;
    }

    updateStatus(OTAStatus::CHECKING, "Checking for firmware...");
    updateProgress(5, "Fetching release info...");

    // Determine if this is a GitHub releases URL or direct firmware URL
    String firmware_url;
    
    if (ota_url.indexOf("api.github.com") >= 0 || ota_url.indexOf("/releases") >= 0) {
        // GitHub releases URL - need to parse JSON
        if (!fetchFirmwareUrl(ota_url, firmware_url)) {
            return false;
        }
    } else if (ota_url.endsWith(".bin")) {
        // Direct firmware URL
        firmware_url = ota_url;
    } else {
        updateStatus(OTAStatus::ERROR_PARSE, "Invalid OTA URL format");
        return false;
    }

    return downloadAndInstall(firmware_url);
}

bool OTADownloader::fetchFirmwareUrl(const String& releases_url, String& firmware_url) {
    WiFiClientSecure client;
    client.setInsecure();  // Skip certificate validation for simplicity
    
    HTTPClient http;
    http.begin(client, releases_url);
    http.addHeader("User-Agent", "ESP32-Bootstrap");
    http.addHeader("Accept", "application/vnd.github.v3+json");
    http.setTimeout(30000);
    
    int http_code = http.GET();
    
    if (http_code != HTTP_CODE_OK) {
        updateStatus(OTAStatus::ERROR_NETWORK, 
                    String("HTTP error: ") + String(http_code));
        http.end();
        return false;
    }
    
    String payload = http.getString();
    http.end();
    
    // Parse JSON response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);
    
    if (error) {
        updateStatus(OTAStatus::ERROR_PARSE, 
                    String("JSON parse error: ") + error.c_str());
        return false;
    }
    
    // Look for appropriate firmware in assets
    // Priority: 
    //   1. firmware-esp32.bin (chip-specific for ESP32)
    //   2. firmware.bin (generic main firmware)
    //   3. Any .bin that's not bootstrap
    JsonArray assets = doc["assets"].as<JsonArray>();
    
    String best_match_url;
    String best_match_name;
    int best_priority = 0;  // Higher is better
    
    for (JsonObject asset : assets) {
        String name = asset["name"].as<String>();
        String name_lower = name;
        name_lower.toLowerCase();
        
        // Skip non-bin files
        if (!name_lower.endsWith(".bin")) {
            continue;
        }
        
        // Skip bootstrap firmware - we want the main app
        if (name_lower.indexOf("bootstrap") >= 0) {
            Serial.printf("[OTA] Skipping bootstrap: %s\n", name.c_str());
            continue;
        }
        
        int priority = 0;
        
        // Check for chip-specific firmware (highest priority)
        #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 100;
            }
        #else
            // Standard ESP32 - look for esp32 but NOT esp32s3
            if ((name_lower.indexOf("esp32") >= 0) && 
                (name_lower.indexOf("esp32s3") < 0) && 
                (name_lower.indexOf("esp32-s3") < 0)) {
                priority = 100;
            }
        #endif
        
        // Generic "firmware.bin" is good (medium priority)
        if (name_lower == "firmware.bin") {
            priority = max(priority, 50);
        }
        
        // Any other .bin file (low priority fallback)
        if (priority == 0) {
            priority = 10;
        }
        
        Serial.printf("[OTA] Candidate: %s (priority %d)\n", name.c_str(), priority);
        
        if (priority > best_priority) {
            best_priority = priority;
            best_match_url = asset["browser_download_url"].as<String>();
            best_match_name = name;
        }
    }
    
    if (best_priority > 0) {
        firmware_url = best_match_url;
        Serial.printf("[OTA] Selected firmware: %s\n", best_match_name.c_str());
        updateProgress(10, "Found firmware: " + best_match_name);
        return true;
    }
    
    updateStatus(OTAStatus::ERROR_NO_FIRMWARE, "No suitable firmware found in release");
    return false;
}

bool OTADownloader::downloadAndInstall(const String& firmware_url) {
    updateStatus(OTAStatus::DOWNLOADING, "Downloading firmware...");
    updateProgress(15, "Starting download...");
    
    WiFiClientSecure client;
    client.setInsecure();  // Skip certificate validation
    
    HTTPClient http;
    http.begin(client, firmware_url);
    http.addHeader("User-Agent", "ESP32-Bootstrap");
    http.setTimeout(static_cast<uint16_t>(OTA_DOWNLOAD_TIMEOUT_MS / 1000));  // Convert to seconds for HTTP timeout
    
    // Follow redirects (GitHub uses redirects for downloads)
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    
    int http_code = http.GET();
    
    if (http_code != HTTP_CODE_OK) {
        updateStatus(OTAStatus::ERROR_DOWNLOAD, 
                    String("Download failed: HTTP ") + String(http_code));
        http.end();
        return false;
    }
    
    int content_length = http.getSize();
    
    if (content_length <= 0) {
        updateStatus(OTAStatus::ERROR_DOWNLOAD, "Invalid content length");
        http.end();
        return false;
    }
    
    Serial.printf("[OTA] Firmware size: %d bytes\n", content_length);
    updateProgress(20, String("Downloading ") + String(content_length / 1024) + "KB...");
    
    // Start OTA update
    if (!Update.begin(content_length)) {
        updateStatus(OTAStatus::ERROR_FLASH, 
                    String("Not enough space: ") + Update.errorString());
        http.end();
        return false;
    }
    
    updateStatus(OTAStatus::FLASHING, "Flashing firmware...");
    
    // Stream download to flash
    WiFiClient* stream = http.getStreamPtr();
    uint8_t buffer[OTA_BUFFER_SIZE];
    size_t written = 0;
    
    unsigned long start_time = millis();
    
    while (written < content_length) {
        // Check timeout
        if (millis() - start_time > OTA_DOWNLOAD_TIMEOUT_MS) {
            updateStatus(OTAStatus::ERROR_DOWNLOAD, "Download timeout");
            Update.abort();
            http.end();
            return false;
        }
        
        // Read available data
        size_t available = stream->available();
        if (available == 0) {
            delay(10);
            continue;
        }
        
        size_t to_read = min(available, sizeof(buffer));
        size_t bytes_read = stream->readBytes(buffer, to_read);
        
        if (bytes_read == 0) {
            continue;
        }
        
        // Write to flash
        size_t bytes_written = Update.write(buffer, bytes_read);
        if (bytes_written != bytes_read) {
            updateStatus(OTAStatus::ERROR_FLASH, 
                        String("Flash write error: ") + Update.errorString());
            Update.abort();
            http.end();
            return false;
        }
        
        written += bytes_written;
        
        // Update progress (20-90%)
        int download_progress = 20 + (written * 70 / content_length);
        updateProgress(download_progress, 
                      String("Flashing: ") + String(written / 1024) + "/" + 
                      String(content_length / 1024) + "KB");
    }
    
    http.end();
    
    updateProgress(95, "Verifying...");
    
    // Finalize update
    if (!Update.end(true)) {
        updateStatus(OTAStatus::ERROR_VERIFY, 
                    String("Verification failed: ") + Update.errorString());
        return false;
    }
    
    updateStatus(OTAStatus::SUCCESS, "Update successful!");
    updateProgress(100, "Rebooting...");
    
    Serial.println("[OTA] Firmware update complete, rebooting in 2 seconds...");
    delay(2000);
    
    ESP.restart();
    
    return true;  // Won't reach here
}

OTAStatus OTADownloader::getStatus() const {
    return status;
}

String OTADownloader::getStatusMessage() const {
    return status_message;
}

int OTADownloader::getProgress() const {
    return progress;
}

void OTADownloader::setProgressCallback(OTAProgressCallback callback) {
    progress_callback = callback;
}
