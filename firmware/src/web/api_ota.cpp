/**
 * @file api_ota.cpp
 * @brief OTA Update Check and Perform API Handlers
 */

#include "web_server.h"
#include "../ota/ota_manager.h"
#include "../display/matrix_display.h"
#include "../supabase/supabase_realtime.h"
#include "../app_state.h"
#include "../debug/log_system.h"
#include "../core/dependencies.h"
#include <ArduinoJson.h>
#include <esp_ota_ops.h>

static const char* TAG = "API_OTA";

void WebServerManager::handleCheckUpdate(AsyncWebServerRequest* request) {
    auto& deps = getDependencies();
    JsonDocument doc;
    doc["current_version"] = FIRMWARE_VERSION;
    
    // Check for updates using OTA manager
    ESP_LOGI(TAG, "Checking for OTA updates...");
    bool update_checked = deps.ota.checkForUpdate();
    
    if (update_checked) {
        String latest = deps.ota.getLatestVersion();
        bool available = deps.ota.isUpdateAvailable();
        
        // If check succeeded but no version found (edge case), we're on latest
        // This can happen if manifest is valid but version parsing has issues
        if (latest.isEmpty()) {
            // Use current version as the "latest" since check succeeded
            // but no newer version was found
            latest = FIRMWARE_VERSION;
            available = false;
            ESP_LOGI(TAG, "Check succeeded but no version returned - using current as latest");
        }
        
        doc["latest_version"] = latest;
        doc["update_available"] = available;
        
        if (available) {
            String download_url = deps.ota.getDownloadUrl();
            if (!download_url.isEmpty()) {
                doc["download_url"] = download_url;
            }
            ESP_LOGI(TAG, "Update available: %s -> %s", 
                         FIRMWARE_VERSION, latest.c_str());
        } else {
            ESP_LOGI(TAG, "Already on latest version: %s", latest.c_str());
        }
    } else {
        // Check failed
        doc["latest_version"] = "Check failed";
        doc["update_available"] = false;
        doc["error"] = "Failed to check for updates. Check OTA URL configuration and network connection.";
        ESP_LOGE(TAG, "OTA check failed");
    }

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handlePerformUpdate(AsyncWebServerRequest* request) {
    auto& deps = getDependencies();
    // Check if an update is available first
    if (!deps.ota.isUpdateAvailable()) {
        request->send(400, "application/json", 
                     "{\"success\":false,\"message\":\"No update available. Check for updates first.\"}");
        return;
    }
    
    String new_version = deps.ota.getLatestVersion();
    ESP_LOGI(TAG, "Starting OTA update...");
    
    // Clear any previous failed version marker since user is manually retrying
    config_manager->clearFailedOTAVersion();
    
    // Show updating screen on display BEFORE sending response
    // This ensures the display updates before the blocking OTA starts
    deps.display.showUpdating(new_version);
    
    // Give display time to render
    delay(50);
    
    request->send(200, "application/json", 
                 "{\"success\":true,\"message\":\"Update started. Device will restart...\"}");
    
    // Give the response time to be sent
    delay(200);
    
    // Disconnect realtime to free memory and prevent network contention during OTA
    // The realtime WebSocket competes for heap and network bandwidth
    if (deps.realtime.isConnected() || deps.realtime.isConnecting()) {
        ESP_LOGI(TAG, "Disconnecting realtime for OTA...");
        deps.realtime.disconnect();
    }
    app_state->realtime_defer_until = millis() + 600000UL;  // 10 minutes
    
    // Stop the web server before OTA to prevent LittleFS conflicts
    // The async web server's serveStatic() handlers keep references to LittleFS
    // which causes issues when OTA tries to unmount and flash the filesystem partition
    ESP_LOGI(TAG, "Stopping web server for OTA...");
    stop();
    delay(100);  // Allow async tasks to finish
    
    // Trigger OTA update (this will reboot on success)
    if (!deps.ota.performUpdate()) {
        ESP_LOGE(TAG, "OTA update failed");
        deps.display.unlockFromOTA();  // Unlock display on failure
        // Mark version as failed to prevent auto-retry loops
        config_manager->setFailedOTAVersion(new_version);
        ESP_LOGW(TAG, "Marked version %s as failed", new_version.c_str());
        ESP_LOGI(TAG, "Restarting web server after OTA failure...");
        begin(config_manager, app_state, module_manager);
    }
}

void WebServerManager::handleBootToFactory(AsyncWebServerRequest* request) {
    ESP_LOGI(TAG, "Boot to factory requested");
    
    const esp_partition_t* factory = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_FACTORY, nullptr);

    if (!factory) {
        ESP_LOGE(TAG, "Factory partition not found in partition table");
        request->send(500, "application/json",
                      "{\"success\":false,\"message\":\"Factory partition not found\"}");
        return;
    }
    
    ESP_LOGI(TAG, "Found factory partition: %s at 0x%x, size %d", 
                  factory->label, factory->address, factory->size);

    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running && running->subtype == ESP_PARTITION_SUBTYPE_APP_FACTORY) {
        ESP_LOGI(TAG, "Already running from factory partition");
        request->send(200, "application/json",
                      "{\"success\":true,\"message\":\"Already running bootstrap firmware\"}");
        return;
    }
    
    // Try to set boot partition immediately to verify it works
    esp_err_t err = esp_ota_set_boot_partition(factory);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to set boot partition: %s", esp_err_to_name(err));
        String errorMsg = "{\"success\":false,\"message\":\"Failed to set boot partition: ";
        errorMsg += esp_err_to_name(err);
        errorMsg += "\"}";
        request->send(500, "application/json", errorMsg);
        return;
    }
    
    ESP_LOGI(TAG, "Boot partition set to factory, scheduling reboot...");

    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"Rebooting to bootstrap firmware...\"}");
    
    // Schedule reboot (partition already set)
    pending_reboot = true;
    pending_reboot_time = millis() + 500;
    pending_boot_partition = nullptr;  // Already set above
    ESP_LOGI(TAG, "Reboot to factory scheduled");
}
