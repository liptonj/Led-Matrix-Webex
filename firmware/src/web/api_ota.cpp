/**
 * @file api_ota.cpp
 * @brief OTA Update Check and Perform API Handlers
 */

#include "web_server.h"
#include "../ota/ota_manager.h"
#include "../display/matrix_display.h"
#include <ArduinoJson.h>
#include <esp_ota_ops.h>

// External references for update functionality
extern OTAManager ota_manager;
extern MatrixDisplay matrix_display;

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
    
    String new_version = ota_manager.getLatestVersion();
    Serial.println("[WEB] Starting OTA update...");
    
    // Show updating screen on display BEFORE sending response
    // This ensures the display updates before the blocking OTA starts
    matrix_display.showUpdating(new_version);
    
    // Give display time to render
    delay(50);
    
    request->send(200, "application/json", 
                 "{\"success\":true,\"message\":\"Update started. Device will restart...\"}");
    
    // Give the response time to be sent
    delay(200);
    
    // Trigger OTA update (this will reboot on success)
    if (!ota_manager.performUpdate()) {
        Serial.println("[WEB] OTA update failed");
        // Note: If we get here, the update failed and didn't reboot
    }
}

void WebServerManager::handleBootToFactory(AsyncWebServerRequest* request) {
    const esp_partition_t* factory = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_FACTORY, nullptr);

    if (!factory) {
        request->send(500, "application/json",
                      "{\"success\":false,\"message\":\"Factory partition not found\"}");
        return;
    }

    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running && running->subtype == ESP_PARTITION_SUBTYPE_APP_FACTORY) {
        request->send(200, "application/json",
                      "{\"success\":true,\"message\":\"Already running bootstrap firmware\"}");
        return;
    }

    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"Rebooting to bootstrap firmware...\"}");
    
    // Schedule reboot to factory partition
    pending_reboot = true;
    pending_reboot_time = millis() + 500;
    pending_boot_partition = factory;
    Serial.println("[WEB] Reboot to factory scheduled");
}
