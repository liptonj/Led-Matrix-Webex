/**
 * @file api_ota.cpp
 * @brief OTA Update Check and Perform API Handlers
 */

#include "web_server.h"
#include "../ota/ota_manager.h"
#include "../display/matrix_display.h"
#include "../supabase/supabase_realtime.h"
#include "../app_state.h"
#include <ArduinoJson.h>
#include <esp_ota_ops.h>

// External references for update functionality
extern OTAManager ota_manager;
extern MatrixDisplay matrix_display;
extern SupabaseRealtime supabaseRealtime;
extern AppState app_state;

void WebServerManager::handleCheckUpdate(AsyncWebServerRequest* request) {
    JsonDocument doc;
    doc["current_version"] = FIRMWARE_VERSION;
    
    // Check for updates using OTA manager
    Serial.println("[WEB] Checking for OTA updates...");
    bool update_checked = ota_manager.checkForUpdate();
    
    if (update_checked) {
        String latest = ota_manager.getLatestVersion();
        bool available = ota_manager.isUpdateAvailable();
        
        // If check succeeded but no version found (edge case), we're on latest
        // This can happen if manifest is valid but version parsing has issues
        if (latest.isEmpty()) {
            // Use current version as the "latest" since check succeeded
            // but no newer version was found
            latest = FIRMWARE_VERSION;
            available = false;
            Serial.println("[WEB] Check succeeded but no version returned - using current as latest");
        }
        
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
            Serial.printf("[WEB] Already on latest version: %s\n", latest.c_str());
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
    
    // Clear any previous failed version marker since user is manually retrying
    config_manager->clearFailedOTAVersion();
    
    // Show updating screen on display BEFORE sending response
    // This ensures the display updates before the blocking OTA starts
    matrix_display.showUpdating(new_version);
    
    // Give display time to render
    delay(50);
    
    request->send(200, "application/json", 
                 "{\"success\":true,\"message\":\"Update started. Device will restart...\"}");
    
    // Give the response time to be sent
    delay(200);
    
    // Disconnect realtime to free memory and prevent network contention during OTA
    // The realtime WebSocket competes for heap and network bandwidth
    if (supabaseRealtime.isConnected() || supabaseRealtime.isConnecting()) {
        Serial.println("[WEB] Disconnecting realtime for OTA...");
        supabaseRealtime.disconnect();
    }
    app_state->realtime_defer_until = millis() + 600000UL;  // 10 minutes
    
    // Stop the web server before OTA to prevent LittleFS conflicts
    // The async web server's serveStatic() handlers keep references to LittleFS
    // which causes issues when OTA tries to unmount and flash the filesystem partition
    Serial.println("[WEB] Stopping web server for OTA...");
    stop();
    delay(100);  // Allow async tasks to finish
    
    // Trigger OTA update (this will reboot on success)
    if (!ota_manager.performUpdate()) {
        Serial.println("[WEB] OTA update failed");
        matrix_display.unlockFromOTA();  // Unlock display on failure
        // Mark version as failed to prevent auto-retry loops
        config_manager->setFailedOTAVersion(new_version);
        Serial.printf("[WEB] Marked version %s as failed\n", new_version.c_str());
        Serial.println("[WEB] Restarting web server after OTA failure...");
        begin(config_manager, app_state, module_manager);
    }
}

void WebServerManager::handleBootToFactory(AsyncWebServerRequest* request) {
    Serial.println("[WEB] Boot to factory requested");
    
    const esp_partition_t* factory = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_FACTORY, nullptr);

    if (!factory) {
        Serial.println("[WEB] ERROR: Factory partition not found in partition table");
        request->send(500, "application/json",
                      "{\"success\":false,\"message\":\"Factory partition not found\"}");
        return;
    }
    
    Serial.printf("[WEB] Found factory partition: %s at 0x%x, size %d\n", 
                  factory->label, factory->address, factory->size);

    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running && running->subtype == ESP_PARTITION_SUBTYPE_APP_FACTORY) {
        Serial.println("[WEB] Already running from factory partition");
        request->send(200, "application/json",
                      "{\"success\":true,\"message\":\"Already running bootstrap firmware\"}");
        return;
    }
    
    // Try to set boot partition immediately to verify it works
    esp_err_t err = esp_ota_set_boot_partition(factory);
    if (err != ESP_OK) {
        Serial.printf("[WEB] ERROR: Failed to set boot partition: %s\n", esp_err_to_name(err));
        String errorMsg = "{\"success\":false,\"message\":\"Failed to set boot partition: ";
        errorMsg += esp_err_to_name(err);
        errorMsg += "\"}";
        request->send(500, "application/json", errorMsg);
        return;
    }
    
    Serial.println("[WEB] Boot partition set to factory, scheduling reboot...");

    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"Rebooting to bootstrap firmware...\"}");
    
    // Schedule reboot (partition already set)
    pending_reboot = true;
    pending_reboot_time = millis() + 500;
    pending_boot_partition = nullptr;  // Already set above
    Serial.println("[WEB] Reboot to factory scheduled");
}
