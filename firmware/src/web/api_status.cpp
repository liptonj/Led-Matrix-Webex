/**
 * @file api_status.cpp
 * @brief Status API Handler
 * 
 * Handles GET /api/status endpoint that returns device status, system info,
 * and partition information.
 */

#include "web_server.h"
#include "web_helpers.h"
#include "../common/pairing_manager.h"
#include "../auth/device_credentials.h"
#include "../core/dependencies.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_ota_ops.h>
#include <LittleFS.h>

void WebServerManager::handleStatus(AsyncWebServerRequest* request) {
    auto& deps = getDependencies();
    JsonDocument doc;

    doc["wifi_connected"] = app_state->wifi_connected;
    // WiFi configuration status for WebUI
    // Get connected SSID when actually connected, otherwise show saved config
    String wifi_ssid;
    if (WiFi.status() == WL_CONNECTED && !WiFi.SSID().isEmpty()) {
        wifi_ssid = WiFi.SSID();  // Actually connected SSID
    } else {
        wifi_ssid = config_manager->getWiFiSSID();  // Saved SSID as fallback
    }
    doc["wifi_ssid"] = wifi_ssid.isEmpty() ? "" : wifi_ssid;
    doc["wifi_ssid_saved"] = !config_manager->getWiFiSSID().isEmpty();
    doc["has_wifi_password"] = !config_manager->getWiFiPassword().isEmpty();
    doc["webex_authenticated"] = app_state->webex_authenticated;
    doc["pairing_code"] = deps.pairing.getCode();
    doc["embedded_app_connected"] = app_state->embedded_app_connected;
    doc["xapi_connected"] = app_state->xapi_connected;
    doc["mqtt_connected"] = app_state->mqtt_connected;
    doc["webex_status"] = app_state->webex_status;
    doc["camera_on"] = app_state->camera_on;
    doc["mic_muted"] = app_state->mic_muted;
    doc["in_call"] = app_state->in_call;
    // Sensor data - always include fields even if 0/null
    doc["temperature"] = app_state->temperature;
    doc["humidity"] = app_state->humidity;
    doc["door_status"] = app_state->door_status.isEmpty() ? "" : app_state->door_status;
    doc["air_quality"] = app_state->air_quality_index;  // 0 is a valid value
    doc["tvoc"] = app_state->tvoc;
    doc["co2_ppm"] = app_state->co2_ppm;
    doc["pm2_5"] = app_state->pm2_5;
    doc["ambient_noise"] = app_state->ambient_noise;
    doc["sensor_mac"] = app_state->sensor_mac;

    // System info
    doc["ip_address"] = WiFi.localIP().toString();
    doc["mac_address"] = WiFi.macAddress();
    doc["serial_number"] = deps.credentials.getSerialNumber();
    doc["hmac_enabled"] = deps.credentials.isProvisioned();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;
    doc["realtime_error"] = app_state->realtime_error;
    doc["realtime_devices_error"] = app_state->realtime_devices_error;
    doc["last_realtime_error"] = app_state->last_realtime_error;
    doc["last_realtime_devices_error"] = app_state->last_realtime_devices_error;

    const esp_partition_t* running = esp_ota_get_running_partition();
    const esp_partition_t* boot = esp_ota_get_boot_partition();
    doc["running_partition"] = running ? String(running->label) : "unknown";
    doc["boot_partition"] = boot ? String(boot->label) : "unknown";

    // Partition storage info
    JsonObject partitions = doc["partitions"].to<JsonObject>();

    // OTA_0 partition info
    const esp_partition_t* ota0 = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_0, nullptr);
    if (ota0) {
        JsonObject ota0_info = partitions["ota_0"].to<JsonObject>();
        ota0_info["size"] = ota0->size;

        // Check if this is the currently running partition
        bool is_running = (running && ota0->address == running->address);

        if (is_running) {
            // For the currently running partition, use the compile-time version
            // because Arduino framework doesn't populate esp_app_desc_t correctly
            #ifdef FIRMWARE_VERSION
            ota0_info["firmware_version"] = FIRMWARE_VERSION;
            #else
            ota0_info["firmware_version"] = "unknown";
            #endif
        } else {
            // For non-running partitions, try stored version from NVS first
            String stored_version = config_manager->getPartitionVersion("ota_0");
            if (!stored_version.isEmpty()) {
                ota0_info["firmware_version"] = stored_version;
            } else {
                // Fallback to reading from app descriptor (likely won't work with Arduino)
                esp_app_desc_t ota0_desc;
                if (esp_ota_get_partition_description(ota0, &ota0_desc) == ESP_OK) {
                    String version_str = String(ota0_desc.version);
                    // Arduino framework often puts "arduino-lib-builder" or "esp-idf:..." here
                    // If it looks invalid, try project_name as fallback
                    if (version_str.startsWith("esp-idf:") || version_str.startsWith("arduino-lib") ||
                        version_str.startsWith("v") || version_str.isEmpty() || version_str == "1") {
                        String project_name = String(ota0_desc.project_name);
                        if (!project_name.isEmpty() && !project_name.startsWith("esp-idf") &&
                            !project_name.startsWith("arduino-lib")) {
                            version_str = project_name;
                        } else {
                            version_str = "unknown";
                        }
                    }
                    ota0_info["firmware_version"] = version_str;
                } else {
                    ota0_info["firmware_version"] = "empty";
                }
            }
        }
    }

    // OTA_1 partition info
    const esp_partition_t* ota1 = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_1, nullptr);
    if (ota1) {
        JsonObject ota1_info = partitions["ota_1"].to<JsonObject>();
        ota1_info["size"] = ota1->size;

        // Check if this is the currently running partition
        bool is_running = (running && ota1->address == running->address);

        if (is_running) {
            // For the currently running partition, use the compile-time version
            #ifdef FIRMWARE_VERSION
            ota1_info["firmware_version"] = FIRMWARE_VERSION;
            #else
            ota1_info["firmware_version"] = "unknown";
            #endif
        } else {
            // For non-running partitions, try stored version from NVS first
            String stored_version = config_manager->getPartitionVersion("ota_1");
            if (!stored_version.isEmpty()) {
                ota1_info["firmware_version"] = stored_version;
            } else {
                // Fallback to reading from app descriptor (likely won't work with Arduino)
                esp_app_desc_t ota1_desc;
                if (esp_ota_get_partition_description(ota1, &ota1_desc) == ESP_OK) {
                    String version_str = String(ota1_desc.version);
                    // Arduino framework often puts "arduino-lib-builder" or "esp-idf:..." here
                    if (version_str.startsWith("esp-idf:") || version_str.startsWith("arduino-lib") ||
                        version_str.startsWith("v") || version_str.isEmpty() || version_str == "1") {
                        String project_name = String(ota1_desc.project_name);
                        if (!project_name.isEmpty() && !project_name.startsWith("esp-idf") &&
                            !project_name.startsWith("arduino-lib")) {
                            version_str = project_name;
                        } else {
                            version_str = "unknown";
                        }
                    }
                    ota1_info["firmware_version"] = version_str;
                } else {
                    ota1_info["firmware_version"] = "empty";
                }
            }
        }
    }

    // SPIFFS/LittleFS partition info
    const esp_partition_t* spiffs = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, nullptr);
    if (spiffs) {
        JsonObject fs_info = partitions["filesystem"].to<JsonObject>();
        fs_info["size"] = spiffs->size;
        fs_info["used"] = spiffs->size - LittleFS.totalBytes() + LittleFS.usedBytes();
        fs_info["total"] = LittleFS.totalBytes();
        fs_info["free"] = LittleFS.totalBytes() - LittleFS.usedBytes();
    }

    #ifdef FIRMWARE_VERSION
    doc["firmware_version"] = FIRMWARE_VERSION;
    #else
    doc["firmware_version"] = "unknown";
    #endif

    #ifdef BUILD_ID
    doc["firmware_build_id"] = BUILD_ID;
    #else
    doc["firmware_build_id"] = "unknown";
    #endif

    // Use helper to send JSON response with CORS
    sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}
