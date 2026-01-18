/**
 * @file ota_manager.cpp
 * @brief OTA Update Manager Implementation
 */

#include "ota_manager.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <Update.h>

OTAManager::OTAManager()
    : update_available(false) {
}

OTAManager::~OTAManager() {
}

void OTAManager::begin(const String& url, const String& version) {
    update_url = url;
    current_version = version;
    
    Serial.printf("[OTA] Initialized with version %s\n", current_version.c_str());
}

bool OTAManager::checkForUpdate() {
    if (update_url.isEmpty()) {
        Serial.println("[OTA] No update URL configured");
        return false;
    }
    
    Serial.printf("[OTA] Checking for updates at %s\n", update_url.c_str());
    
    WiFiClientSecure client;
    client.setInsecure(); // TODO: Add proper certificate validation
    
    HTTPClient http;
    http.begin(client, update_url);
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
    
    // Find the firmware binary in assets
    // Priority:
    //   1. firmware-ota-esp32s3.bin or firmware-ota-esp32.bin (merged: app + filesystem)
    //   2. firmware-esp32s3.bin or firmware-esp32.bin (chip-specific)
    //   3. firmware.bin (generic)
    JsonArray assets = doc["assets"].as<JsonArray>();
    int best_priority = 0;
    
    for (JsonObject asset : assets) {
        String name = asset["name"].as<String>();
        String name_lower = name;
        name_lower.toLowerCase();
        
        if (!name_lower.endsWith(".bin")) {
            continue;
        }
        
        // Skip bootstrap firmware
        if (name_lower.indexOf("bootstrap") >= 0) {
            continue;
        }
        
        int priority = 0;
        
        // Check for merged OTA binary (highest priority)
        #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("ota") >= 0 && 
                (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0)) {
                priority = 200;
            } else if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 100;
            }
        #else
            if (name_lower.indexOf("ota") >= 0 &&
                (name_lower.indexOf("esp32") >= 0) && 
                (name_lower.indexOf("esp32s3") < 0) && 
                (name_lower.indexOf("esp32-s3") < 0)) {
                priority = 200;
            } else if ((name_lower.indexOf("esp32") >= 0) && 
                (name_lower.indexOf("esp32s3") < 0) && 
                (name_lower.indexOf("esp32-s3") < 0)) {
                priority = 100;
            }
        #endif
        
        // Generic firmware.bin
        if (name_lower == "firmware.bin") {
            priority = max(priority, 50);
        }
        
        if (priority > best_priority) {
            best_priority = priority;
            download_url = asset["browser_download_url"].as<String>();
        }
    }
    
    // Check if we found a suitable firmware
    if (download_url.isEmpty()) {
        Serial.println("[OTA] No suitable firmware found in release");
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
    if (!update_available || download_url.isEmpty()) {
        Serial.println("[OTA] No update available or no download URL");
        return false;
    }
    
    Serial.printf("[OTA] Downloading firmware from %s\n", download_url.c_str());
    
    WiFiClientSecure client;
    client.setInsecure(); // TODO: Add proper certificate validation
    
    HTTPClient http;
    http.begin(client, download_url);
    http.addHeader("User-Agent", "ESP32-Webex-Display");
    
    int httpCode = http.GET();
    
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] Download failed: %d\n", httpCode);
        http.end();
        return false;
    }
    
    int contentLength = http.getSize();
    Serial.printf("[OTA] Firmware size: %d bytes\n", contentLength);
    
    if (contentLength <= 0) {
        Serial.println("[OTA] Invalid content length");
        http.end();
        return false;
    }
    
    // Start update
    if (!Update.begin(contentLength)) {
        Serial.printf("[OTA] Not enough space: %s\n", Update.errorString());
        http.end();
        return false;
    }
    
    Serial.println("[OTA] Starting update...");
    
    WiFiClient* stream = http.getStreamPtr();
    size_t written = Update.writeStream(*stream);
    
    if (written != contentLength) {
        Serial.printf("[OTA] Written only %d of %d bytes\n", written, contentLength);
        Update.abort();
        http.end();
        return false;
    }
    
    if (!Update.end()) {
        Serial.printf("[OTA] Update failed: %s\n", Update.errorString());
        http.end();
        return false;
    }
    
    http.end();
    
    Serial.println("[OTA] Update successful!");
    Serial.println("[OTA] Rebooting...");
    
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
