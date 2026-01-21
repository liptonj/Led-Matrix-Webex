/**
 * @file ota_manager.cpp
 * @brief OTA Update Manager Implementation
 */

#include "ota_manager.h"
#include "../display/matrix_display.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include <LittleFS.h>
#ifndef NATIVE_BUILD
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif

// External reference to display for progress updates
extern MatrixDisplay matrix_display;

namespace {
void configureHttpClient(HTTPClient& http) {
    // Enable following redirects - required for GitHub release downloads
    // GitHub redirects asset URLs to CDN (returns 302)
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(30000);  // 30 second timeout for large downloads
}
}  // namespace

OTAManager::OTAManager()
    : update_available(false), use_manifest_mode(false) {
}

OTAManager::~OTAManager() {
}

void OTAManager::begin(const String& url, const String& version) {
    update_url = url;
    current_version = version;
    
    Serial.printf("[OTA] Initialized with version %s\n", current_version.c_str());
}

void OTAManager::setManifestUrl(const String& url) {
    manifest_url = url;
    use_manifest_mode = true;
    Serial.printf("[OTA] Manifest mode enabled: %s\n", manifest_url.c_str());
}

bool OTAManager::checkForUpdate() {
    // Try manifest first if configured
    if (use_manifest_mode && !manifest_url.isEmpty()) {
        Serial.println("[OTA] Using manifest mode");
        if (checkUpdateFromManifest()) {
            return true;
        }
        // Fall through to GitHub API on failure
        Serial.println("[OTA] Manifest mode failed, falling back to GitHub API");
    }
    
    // Fallback to GitHub API
    return checkUpdateFromGithubAPI();
}

bool OTAManager::checkUpdateFromManifest() {
    if (manifest_url.isEmpty()) {
        return false;
    }
    
    Serial.printf("[OTA] Fetching manifest from %s\n", manifest_url.c_str());
    
    WiFiClientSecure client;
    client.setInsecure(); // TODO: Add proper certificate validation
    
    HTTPClient http;
    http.begin(client, manifest_url);
    configureHttpClient(http);
    http.addHeader("User-Agent", "ESP32-Webex-Display");
    
    int httpCode = http.GET();
    
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] Manifest fetch failed: %d\n", httpCode);
        http.end();
        return false;
    }
    
    String response = http.getString();
    http.end();
    
    // Parse manifest JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    
    if (error) {
        Serial.printf("[OTA] Failed to parse manifest: %s\n", error.c_str());
        return false;
    }
    
    // Extract version
    latest_version = doc["version"].as<String>();
    
    if (latest_version.isEmpty()) {
        Serial.println("[OTA] No version in manifest");
        return false;
    }
    
    // Extract firmware and filesystem URLs for this board
    #if defined(ESP32_S3_BOARD)
    const char* board_type = "esp32s3";
    #else
    const char* board_type = "esp32";
    #endif
    
    firmware_url = doc["firmware"][board_type]["url"].as<String>();
    littlefs_url = doc["filesystem"][board_type]["url"].as<String>();
    
    if (firmware_url.isEmpty() || littlefs_url.isEmpty()) {
        Serial.printf("[OTA] Missing %s assets in manifest\n", board_type);
        return false;
    }
    
    // Compare versions
    update_available = compareVersions(latest_version, current_version);
    
    if (update_available) {
        Serial.printf("[OTA] Update available: %s -> %s\n", 
                      current_version.c_str(), latest_version.c_str());
        Serial.printf("[OTA] Firmware: %s\n", firmware_url.c_str());
        Serial.printf("[OTA] Filesystem: %s\n", littlefs_url.c_str());
    } else {
        Serial.println("[OTA] Already on latest version");
    }
    
    return true;  // Successfully checked manifest
}

bool OTAManager::checkUpdateFromGithubAPI() {
    if (update_url.isEmpty()) {
        Serial.println("[OTA] No update URL configured");
        return false;
    }
    
    Serial.printf("[OTA] Checking for updates at %s\n", update_url.c_str());
    
    WiFiClientSecure client;
    client.setInsecure(); // TODO: Add proper certificate validation
    
    HTTPClient http;
    http.begin(client, update_url);
    configureHttpClient(http);
    http.addHeader("User-Agent", "ESP32-Webex-Display");
    http.addHeader("Accept", "application/vnd.github.v3+json");
    
    int httpCode = http.GET();
    
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] Failed to check for updates: %d\n", httpCode);
        http.end();
        return false;
    }
    
    String response = http.getString();
    http.end();
    
    // Parse GitHub releases response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    
    if (error) {
        Serial.printf("[OTA] Failed to parse response: %s\n", error.c_str());
        return false;
    }
    
    // Extract version from tag_name
    String tag = doc["tag_name"].as<String>();
    latest_version = extractVersion(tag);
    
    firmware_url = "";
    littlefs_url = "";

    // Find firmware + filesystem assets in release
    JsonArray assets = doc["assets"].as<JsonArray>();
    if (!selectReleaseAssets(assets)) {
        Serial.println("[OTA] Missing firmware or LittleFS asset in release");
        return false;
    }
    
    // Compare versions
    update_available = compareVersions(latest_version, current_version);
    
    if (update_available) {
        Serial.printf("[OTA] Update available: %s -> %s\n", 
                      current_version.c_str(), latest_version.c_str());
    } else {
        Serial.println("[OTA] Already on latest version");
    }
    
    return true;  // Successfully checked (even if no update available)
}

bool OTAManager::performUpdate() {
    if (!update_available || firmware_url.isEmpty() || littlefs_url.isEmpty()) {
        Serial.println("[OTA] No update available or missing asset URLs");
        return false;
    }
    
    if (!downloadAndInstallBinary(firmware_url, U_FLASH, "firmware")) {
        return false;
    }

    if (!downloadAndInstallBinary(littlefs_url, U_SPIFFS, "LittleFS")) {
        return false;
    }

    Serial.println("[OTA] Firmware + LittleFS update successful!");
    Serial.println("[OTA] Rebooting...");
    
    // Show complete status
    matrix_display.showUpdatingProgress(latest_version, 100, "Rebooting...");
    
    delay(1000);
    ESP.restart();
    
    return true; // Won't reach here due to restart
}

bool OTAManager::compareVersions(const String& v1, const String& v2) {
    // Simple semantic version comparison
    // Returns true if v1 > v2
    
    int v1_major = 0, v1_minor = 0, v1_patch = 0;
    int v2_major = 0, v2_minor = 0, v2_patch = 0;
    
    sscanf(v1.c_str(), "%d.%d.%d", &v1_major, &v1_minor, &v1_patch);
    sscanf(v2.c_str(), "%d.%d.%d", &v2_major, &v2_minor, &v2_patch);
    
    if (v1_major > v2_major) return true;
    if (v1_major < v2_major) return false;
    
    if (v1_minor > v2_minor) return true;
    if (v1_minor < v2_minor) return false;
    
    return v1_patch > v2_patch;
}

String OTAManager::extractVersion(const String& tag) {
    // Remove 'v' prefix if present
    if (tag.startsWith("v") || tag.startsWith("V")) {
        return tag.substring(1);
    }
    return tag;
}

bool OTAManager::selectReleaseAssets(const JsonArray& assets) {
    int firmware_priority = 0;
    int littlefs_priority = 0;

    for (JsonObject asset : assets) {
        String name = asset["name"].as<String>();
        String name_lower = name;
        name_lower.toLowerCase();

        if (!name_lower.endsWith(".bin")) {
            continue;
        }

        if (name_lower.indexOf("bootstrap") >= 0) {
            continue;
        }

        const String download = asset["browser_download_url"].as<String>();

        if (name_lower.indexOf("littlefs") >= 0 || name_lower.indexOf("spiffs") >= 0) {
            int priority = 0;
            #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 200;
            }
            #else
            if (name_lower.indexOf("esp32") >= 0 &&
                name_lower.indexOf("esp32s3") < 0 &&
                name_lower.indexOf("esp32-s3") < 0) {
                priority = 200;
            }
            #endif
            if (name_lower == "littlefs.bin" || name_lower == "spiffs.bin") {
                priority = max(priority, 50);
            }
            if (priority > littlefs_priority) {
                littlefs_priority = priority;
                littlefs_url = download;
            }
            continue;
        }

        if (name_lower.indexOf("ota") >= 0) {
            continue;  // Skip merged OTA binaries for streaming updates
        }

        if (name_lower.indexOf("firmware") >= 0) {
            int priority = 0;
            #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 200;
            }
            #else
            if (name_lower.indexOf("esp32") >= 0 &&
                name_lower.indexOf("esp32s3") < 0 &&
                name_lower.indexOf("esp32-s3") < 0) {
                priority = 200;
            }
            #endif
            if (name_lower == "firmware.bin") {
                priority = max(priority, 50);
            }
            if (priority > firmware_priority) {
                firmware_priority = priority;
                firmware_url = download;
            }
        }
    }

    return firmware_priority > 0 && littlefs_priority > 0;
}

bool OTAManager::downloadAndInstallBinary(const String& url, int update_type, const char* label) {
    Serial.printf("[OTA] Downloading %s from %s\n", label, url.c_str());

#ifndef NATIVE_BUILD
    // Disable task watchdog during OTA - it's a legitimate long-running operation
    // that will starve other tasks
    esp_task_wdt_deinit();
    Serial.println("[OTA] Task watchdog disabled for update");
#endif

    WiFiClientSecure client;
    client.setInsecure(); // TODO: Add proper certificate validation

    HTTPClient http;
    http.begin(client, url);
    configureHttpClient(http);
    http.addHeader("User-Agent", "ESP32-Webex-Display");

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] %s download failed: %d\n", label, httpCode);
        http.end();
        return false;
    }

    int contentLength = http.getSize();
    Serial.printf("[OTA] %s size: %d bytes\n", label, contentLength);

    if (contentLength <= 0) {
        Serial.printf("[OTA] Invalid content length for %s\n", label);
        http.end();
        return false;
    }

#ifndef NATIVE_BUILD
    const esp_partition_t* target_partition = nullptr;
    if (update_type == U_FLASH) {
        target_partition = esp_ota_get_next_update_partition(nullptr);
        if (!target_partition) {
            Serial.println("[OTA] No OTA partition available (missing ota_1?)");
            http.end();
            return false;
        }
        Serial.printf("[OTA] Target partition: %s (%d bytes)\n",
                      target_partition->label, target_partition->size);
        if (static_cast<size_t>(contentLength) > target_partition->size) {
            Serial.printf("[OTA] %s too large for partition (%d > %d)\n",
                          label, contentLength, target_partition->size);
            http.end();
            return false;
        }
    }
#endif

    if (update_type == U_SPIFFS) {
        LittleFS.end();
    }

    if (!Update.begin(contentLength, update_type)) {
        Serial.printf("[OTA] Not enough space for %s: %s\n", label, Update.errorString());
        http.end();
        return false;
    }

    Serial.printf("[OTA] Flashing %s...\n", label);
    
    // Show initial progress on display
    // Firmware takes 0-85%, LittleFS takes 85-100% (since LittleFS is much smaller)
    int initialProgress = (update_type == U_FLASH) ? 0 : 85;
    String statusText = String("Downloading ") + label;
    matrix_display.showUpdatingProgress(latest_version, initialProgress, statusText);

    // Use chunked download with watchdog feeding to prevent timeout
    WiFiClient* stream = http.getStreamPtr();
    size_t written = 0;
    uint8_t buffer[4096];
    int lastProgress = -1;
    
    while (written < static_cast<size_t>(contentLength)) {
        // Yield to other FreeRTOS tasks
#ifndef NATIVE_BUILD
        vTaskDelay(1);  // Give other tasks a chance to run
#else
        yield();
#endif
        
        size_t available = stream->available();
        if (available == 0) {
            // Wait for more data with timeout
            unsigned long waitStart = millis();
            while (stream->available() == 0 && stream->connected()) {
                if (millis() - waitStart > 10000) {  // 10 second timeout
                    Serial.printf("[OTA] Stream timeout waiting for data\n");
                    Update.abort();
                    http.end();
                    return false;
                }
#ifndef NATIVE_BUILD
                vTaskDelay(pdMS_TO_TICKS(10));  // Wait 10ms, yield to other tasks
#else
                delay(10);
#endif
            }
            available = stream->available();
        }
        
        if (available == 0 && !stream->connected()) {
            break;  // Connection closed
        }
        
        size_t toRead = min(available, sizeof(buffer));
        int bytesRead = stream->readBytes(buffer, toRead);
        
        if (bytesRead > 0) {
            size_t bytesWritten = Update.write(buffer, bytesRead);
            if (bytesWritten != static_cast<size_t>(bytesRead)) {
                Serial.printf("[OTA] Write failed: wrote %d of %d bytes\n", bytesWritten, bytesRead);
                Update.abort();
                http.end();
                return false;
            }
            written += bytesWritten;
            
            // Update progress every 5%
            int progress = (written * 100) / contentLength;
            if (progress / 5 > lastProgress / 5) {
                lastProgress = progress;
                Serial.printf("[OTA] %s: %d%%\n", label, progress);
                
                // Update display with progress
                // Firmware takes 0-85%, LittleFS takes 85-100% (since LittleFS is much smaller)
                int displayProgress = (update_type == U_FLASH) ? 
                    (progress * 85) / 100 : 85 + ((progress * 15) / 100);
                String statusText = String(label) + " " + String(progress) + "%";
                matrix_display.showUpdatingProgress(latest_version, displayProgress, statusText);
            }
        }
    }

    if (written != static_cast<size_t>(contentLength)) {
        Serial.printf("[OTA] Written only %d of %d bytes for %s\n", written, contentLength, label);
        Update.abort();
        http.end();
        return false;
    }

    if (!Update.end()) {
        Serial.printf("[OTA] %s update failed: %s\n", label, Update.errorString());
        http.end();
        return false;
    }

#ifndef NATIVE_BUILD
    if (update_type == U_FLASH && target_partition) {
        esp_err_t err = esp_ota_set_boot_partition(target_partition);
        if (err != ESP_OK) {
            Serial.printf("[OTA] Failed to set boot partition: %s\n", esp_err_to_name(err));
            http.end();
            return false;
        }
        Serial.printf("[OTA] Boot partition set to %s\n", target_partition->label);
    }
#endif

    http.end();
    Serial.printf("[OTA] %s update applied\n", label);
    return true;
}
