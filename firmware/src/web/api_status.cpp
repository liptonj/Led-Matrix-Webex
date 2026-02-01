/**
 * @file api_status.cpp
 * @brief Status and Configuration API Handlers
 */

#include "web_server.h"
#include "web_helpers.h"
#include "../time/time_manager.h"
#include "../meraki/mqtt_client.h"
#include "../auth/device_credentials.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_ota_ops.h>
#include <LittleFS.h>

// External MQTT client for config invalidation
extern MerakiMQTTClient mqtt_client;

// External pairing manager for pairing code
#include "../common/pairing_manager.h"
#include "../supabase/supabase_client.h"
extern PairingManager pairing_manager;
extern SupabaseClient supabaseClient;

void WebServerManager::handleStatus(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["wifi_connected"] = app_state->wifi_connected;
    doc["webex_authenticated"] = app_state->webex_authenticated;
    doc["pairing_code"] = pairing_manager.getCode();
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
    doc["serial_number"] = deviceCredentials.getSerialNumber();
    doc["hmac_enabled"] = deviceCredentials.isProvisioned();
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

void WebServerManager::handleConfig(AsyncWebServerRequest* request) {
    JsonDocument doc;

    // Device configuration - always include all fields
    doc["device_name"] = config_manager->getDeviceName();
    doc["display_name"] = config_manager->getDisplayName();
    doc["brightness"] = config_manager->getBrightness();
    doc["scroll_speed_ms"] = config_manager->getScrollSpeedMs();
    doc["page_interval_ms"] = config_manager->getPageIntervalMs();
    doc["sensor_page_enabled"] = config_manager->getSensorPageEnabled();
    doc["display_pages"] = config_manager->getDisplayPages();
    doc["status_layout"] = config_manager->getStatusLayout();
    doc["date_color"] = config_manager->getDateColor();
    doc["time_color"] = config_manager->getTimeColor();
    doc["name_color"] = config_manager->getNameColor();
    doc["metric_color"] = config_manager->getMetricColor();
    doc["poll_interval"] = config_manager->getWebexPollInterval();
    doc["xapi_poll_interval"] = config_manager->getXAPIPollInterval();
    // Boolean flags - always include as explicit booleans
    doc["has_webex_credentials"] = config_manager->hasWebexCredentials();
    doc["has_webex_tokens"] = config_manager->hasWebexTokens();
    doc["webex_authenticated"] = app_state->webex_authenticated;  // Includes Supabase OAuth
    doc["has_xapi_device"] = config_manager->hasXAPIDevice();
    doc["xapi_device_id"] = config_manager->getXAPIDeviceId().isEmpty() ? "" : config_manager->getXAPIDeviceId();

    // Webex credentials - show masked versions if present
    String clientId = config_manager->getWebexClientId();
    String clientSecret = config_manager->getWebexClientSecret();
    if (!clientId.isEmpty()) {
        // Show first 8 chars + masked rest
        if (clientId.length() > 8) {
            doc["webex_client_id_masked"] = clientId.substring(0, 8) + "..." + String(clientId.length() - 8) + " more";
        } else {
            doc["webex_client_id_masked"] = clientId;
        }
    } else {
        doc["webex_client_id_masked"] = "";
    }
    if (!clientSecret.isEmpty()) {
        doc["webex_client_secret_masked"] = "••••••••" + String(clientSecret.length()) + " characters";
    } else {
        doc["webex_client_secret_masked"] = "";
    }

    // MQTT configuration
    doc["mqtt_broker"] = config_manager->getMQTTBroker();
    doc["mqtt_port"] = config_manager->getMQTTPort();
    doc["mqtt_topic"] = config_manager->getMQTTTopic();
    doc["mqtt_username"] = config_manager->getMQTTUsername();

    // MQTT password - show indicator if present
    String mqttPassword = config_manager->getMQTTPassword();
    if (!mqttPassword.isEmpty()) {
        doc["mqtt_password_masked"] = "••••••••" + String(mqttPassword.length()) + " characters";
        doc["has_mqtt_password"] = true;
    } else {
        doc["mqtt_password_masked"] = "";
        doc["has_mqtt_password"] = false;
    }

    // Sensor and display configuration - ensure empty strings are sent as empty, not null
    doc["sensor_serial"] = config_manager->getSensorSerial().isEmpty() ? "" : config_manager->getSensorSerial();
    doc["sensor_macs"] = config_manager->getSensorMacsRaw().isEmpty() ? "" : config_manager->getSensorMacsRaw();
    doc["display_sensor_mac"] = config_manager->getDisplaySensorMac().isEmpty() ? "" : config_manager->getDisplaySensorMac();
    doc["display_metric"] = config_manager->getDisplayMetric().isEmpty() ? "tvoc" : config_manager->getDisplayMetric();
    doc["ota_url"] = config_manager->getOTAUrl().isEmpty() ? "" : config_manager->getOTAUrl();
    doc["supabase_url"] = config_manager->getSupabaseUrl().isEmpty() ? "" : config_manager->getSupabaseUrl();
    // Boolean flag - always include as explicit boolean
    doc["auto_update"] = config_manager->getAutoUpdate();
    // Failed OTA version - if set, auto-update will skip this version
    String failedOTA = config_manager->getFailedOTAVersion();
    doc["failed_ota_version"] = failedOTA.isEmpty() ? "" : failedOTA;
    doc["time_zone"] = config_manager->getTimeZone().isEmpty() ? "UTC" : config_manager->getTimeZone();
    doc["ntp_server"] = config_manager->getNtpServer().isEmpty() ? "pool.ntp.org" : config_manager->getNtpServer();
    doc["time_format"] = config_manager->getTimeFormat().isEmpty() ? "24h" : config_manager->getTimeFormat();
    doc["date_format"] = config_manager->getDateFormat().isEmpty() ? "mdy" : config_manager->getDateFormat();

    doc["has_bridge_config"] = false;

    // Debug configuration
    doc["debug_mode"] = config_manager->getDebugMode();
    doc["pairing_realtime_debug"] = config_manager->getPairingRealtimeDebug();
    doc["tls_verify"] = config_manager->getTlsVerify();

    // Use helper to send JSON response with CORS
    sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleSaveConfig(AsyncWebServerRequest* request, uint8_t* data, size_t len,
                                        size_t index, size_t total) {
    // Security: Limit body size to prevent DoS attacks
    const size_t MAX_CONFIG_BODY_SIZE = 8192;  // 8KB max config
    
    if (index == 0) {
        config_body_buffer = "";
        config_body_expected = total;
        
        // Reject oversized requests early
        if (total > MAX_CONFIG_BODY_SIZE) {
            Serial.printf("[WEB] Config body too large: %zu bytes (max %d)\n", total, MAX_CONFIG_BODY_SIZE);
            sendErrorResponse(request, 413, "Request body too large", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
            return;
        }
        
        if (total > 0) {
            config_body_buffer.reserve(total);
        }
    }

    if (len > 0) {
        // Prevent buffer overflow during accumulation
        if (config_body_buffer.length() + len > MAX_CONFIG_BODY_SIZE) {
            Serial.printf("[WEB] Config buffer overflow prevented: %zu + %zu > %d\n",
                          config_body_buffer.length(), len, MAX_CONFIG_BODY_SIZE);
            sendErrorResponse(request, 413, "Request body too large", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
            config_body_buffer = "";  // Reset buffer
            return;
        }
        
        String chunk(reinterpret_cast<char*>(data), len);
        config_body_buffer += chunk;
    }

    if (total > 0 && (index + len) < total) {
        return;
    }

    const String body = config_body_buffer;

    Serial.printf("[WEB] Received config save request (length: %d bytes)\n", body.length());

    // Final size check (defense in depth)
    if (body.length() > MAX_CONFIG_BODY_SIZE) {
        Serial.printf("[WEB] Config body too large: %d bytes (max %d)\n", body.length(), MAX_CONFIG_BODY_SIZE);
        sendErrorResponse(request, 413, "Request body too large", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        Serial.printf("[WEB] Failed to parse JSON: %s\n", error.c_str());
        sendErrorResponse(request, 400, "Invalid JSON", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }

    // Update configuration with input validation
    bool time_config_updated = false;
    if (doc["device_name"].is<const char*>()) {
        String device_name = doc["device_name"].as<String>();
        // Validate: max 64 chars, printable ASCII
        if (device_name.length() <= 64 && device_name.length() > 0) {
            bool valid = true;
            for (size_t i = 0; i < device_name.length(); i++) {
                char c = device_name.charAt(i);
                if (c < 32 || c > 126) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                config_manager->setDeviceName(device_name);
            } else {
                Serial.println("[WEB] Invalid device_name: non-printable characters");
            }
        } else {
            Serial.printf("[WEB] Invalid device_name length: %d (max 64)\n", device_name.length());
        }
    }
    if (doc["display_name"].is<const char*>()) {
        String display_name = doc["display_name"].as<String>();
        // Validate: max 64 chars, printable ASCII
        if (display_name.length() <= 64 && display_name.length() > 0) {
            bool valid = true;
            for (size_t i = 0; i < display_name.length(); i++) {
                char c = display_name.charAt(i);
                if (c < 32 || c > 126) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                config_manager->setDisplayName(display_name);
            } else {
                Serial.println("[WEB] Invalid display_name: non-printable characters");
            }
        } else {
            Serial.printf("[WEB] Invalid display_name length: %d (max 64)\n", display_name.length());
        }
    }
    if (doc["brightness"].is<int>()) {
        int brightness = doc["brightness"].as<int>();
        // Validate: 0-255
        if (brightness >= 0 && brightness <= 255) {
            config_manager->setBrightness(static_cast<uint8_t>(brightness));
        } else {
            Serial.printf("[WEB] Invalid brightness: %d (must be 0-255)\n", brightness);
        }
    }
    if (doc["scroll_speed_ms"].is<int>()) {
        int scroll_speed = doc["scroll_speed_ms"].as<int>();
        // Validate: 10-10000ms (10ms to 10 seconds)
        if (scroll_speed >= 10 && scroll_speed <= 10000) {
            config_manager->setScrollSpeedMs(static_cast<uint16_t>(scroll_speed));
        } else {
            Serial.printf("[WEB] Invalid scroll_speed_ms: %d (must be 10-10000)\n", scroll_speed);
        }
    }
    if (doc["page_interval_ms"].is<int>()) {
        int page_interval = doc["page_interval_ms"].as<int>();
        // Validate: 100-60000ms (100ms to 60 seconds)
        if (page_interval >= 100 && page_interval <= 60000) {
            config_manager->setPageIntervalMs(static_cast<uint16_t>(page_interval));
        } else {
            Serial.printf("[WEB] Invalid page_interval_ms: %d (must be 100-60000)\n", page_interval);
        }
    }
    if (doc["sensor_page_enabled"].is<bool>()) {
        config_manager->setSensorPageEnabled(doc["sensor_page_enabled"].as<bool>());
    }
    if (doc["display_pages"].is<const char*>()) {
        config_manager->setDisplayPages(doc["display_pages"].as<const char*>());
    }
    if (doc["status_layout"].is<const char*>()) {
        config_manager->setStatusLayout(doc["status_layout"].as<const char*>());
    }
    if (doc["date_color"].is<const char*>()) {
        config_manager->setDateColor(doc["date_color"].as<const char*>());
    }
    if (doc["time_color"].is<const char*>()) {
        config_manager->setTimeColor(doc["time_color"].as<const char*>());
    }
    if (doc["name_color"].is<const char*>()) {
        config_manager->setNameColor(doc["name_color"].as<const char*>());
    }
    if (doc["metric_color"].is<const char*>()) {
        config_manager->setMetricColor(doc["metric_color"].as<const char*>());
    }
    if (doc["poll_interval"].is<int>()) {
        int poll_interval = doc["poll_interval"].as<int>();
        // Validate: 5-300 seconds
        if (poll_interval >= 5 && poll_interval <= 300) {
            config_manager->setWebexPollInterval(static_cast<uint16_t>(poll_interval));
        } else {
            Serial.printf("[WEB] Invalid poll_interval: %d (must be 5-300)\n", poll_interval);
        }
    }
    if (doc["xapi_poll_interval"].is<int>()) {
        int xapi_poll_interval = doc["xapi_poll_interval"].as<int>();
        // Validate: 1-60 seconds
        if (xapi_poll_interval >= 1 && xapi_poll_interval <= 60) {
            config_manager->setXAPIPollInterval(static_cast<uint16_t>(xapi_poll_interval));
        } else {
            Serial.printf("[WEB] Invalid xapi_poll_interval: %d (must be 1-60)\n", xapi_poll_interval);
        }
    }
    if (doc["xapi_device_id"].is<const char*>()) {
        String device_id = doc["xapi_device_id"].as<String>();
        // Validate: max 128 chars, alphanumeric + hyphens
        if (device_id.length() <= 128) {
            config_manager->setXAPIDeviceId(device_id);
        } else {
            Serial.printf("[WEB] Invalid xapi_device_id length: %d (max 128)\n", device_id.length());
        }
    }
    // Webex credentials - only save if both fields provided
    if (doc["webex_client_id"].is<const char*>() && doc["webex_client_secret"].is<const char*>()) {
        String client_id = doc["webex_client_id"].as<String>();
        String client_secret = doc["webex_client_secret"].as<String>();

        if (!client_id.isEmpty() && !client_secret.isEmpty()) {
            config_manager->setWebexCredentials(client_id, client_secret);
            Serial.printf("[WEB] Webex credentials saved - Client ID: %s***\n", client_id.substring(0, 8).c_str());
        } else if (client_id.isEmpty() && client_secret.isEmpty()) {
            Serial.println("[WEB] Empty Webex credentials provided - skipping save");
        } else {
            Serial.println("[WEB] Warning: Only one Webex credential field provided");
        }
    }

    // MQTT configuration with validation
    if (doc["mqtt_broker"].is<const char*>()) {
        String broker = doc["mqtt_broker"].as<String>();
        uint16_t port = 1883;
        
        // Validate port
        if (doc["mqtt_port"].is<int>()) {
            int port_val = doc["mqtt_port"].as<int>();
            if (port_val >= 1 && port_val <= 65535) {
                port = static_cast<uint16_t>(port_val);
            } else {
                Serial.printf("[WEB] Invalid mqtt_port: %d (must be 1-65535), using default 1883\n", port_val);
            }
        }
        
        String username = doc["mqtt_username"].is<const char*>() ? doc["mqtt_username"].as<String>() : "";
        String topic = doc["mqtt_topic"].is<const char*>() ? doc["mqtt_topic"].as<String>() : "meraki/v1/mt/#";

        // Validate broker: max 256 chars, hostname/IP format
        if (broker.length() > 0 && broker.length() <= 256) {
            // Handle password - only overwrite if non-empty password provided
            String password;
            if (doc["mqtt_password"].is<const char*>()) {
                String newPassword = doc["mqtt_password"].as<String>();
                if (!newPassword.isEmpty()) {
                    password = newPassword;
                    Serial.println("[WEB] MQTT password updated");
                } else {
                    // Empty string provided - keep existing password
                    password = config_manager->getMQTTPassword();
                    Serial.println("[WEB] Empty MQTT password provided - keeping existing");
                }
            } else {
                // Field not provided - keep existing password
                password = config_manager->getMQTTPassword();
                Serial.println("[WEB] MQTT password not provided - keeping existing");
            }

            config_manager->setMQTTConfig(broker, port, username, password, topic);
            mqtt_client.invalidateConfig();  // Force reconnect with new settings
            Serial.printf("[WEB] MQTT config saved - Broker: %s:%d, Username: %s\n",
                         broker.c_str(), port, username.isEmpty() ? "(none)" : username.c_str());
        } else {
            Serial.printf("[WEB] Invalid mqtt_broker length: %d (must be 1-256)\n", broker.length());
        }
    }

    // Sensor MAC filter list (comma/semicolon separated)
    if (doc["sensor_macs"].is<const char*>()) {
        String macs = doc["sensor_macs"].as<String>();
        config_manager->setSensorMacs(macs);
        if (!macs.isEmpty()) {
            Serial.printf("[WEB] Sensor MACs saved: %s\n", macs.c_str());
        }
    } else if (doc["sensor_serial"].is<const char*>()) {
        String serial = doc["sensor_serial"].as<String>();
        config_manager->setSensorSerial(serial);
        if (!serial.isEmpty()) {
            Serial.printf("[WEB] Sensor serial saved: %s\n", serial.c_str());
        }
    }
    if (doc["display_sensor_mac"].is<const char*>()) {
        String display_mac = doc["display_sensor_mac"].as<String>();
        config_manager->setDisplaySensorMac(display_mac);
    }
    if (doc["display_metric"].is<const char*>()) {
        String display_metric = doc["display_metric"].as<String>();
        config_manager->setDisplayMetric(display_metric);
    }
    if (doc["ota_url"].is<const char*>()) {
        config_manager->setOTAUrl(doc["ota_url"].as<const char*>());
    }
    if (doc["auto_update"].is<bool>()) {
        config_manager->setAutoUpdate(doc["auto_update"].as<bool>());
    }
    // Allow clearing the failed OTA version to retry auto-updates
    if (doc["clear_failed_ota"].is<bool>() && doc["clear_failed_ota"].as<bool>()) {
        config_manager->clearFailedOTAVersion();
        Serial.println("[CONFIG] Cleared failed OTA version marker");
    }
    if (doc["supabase_url"].is<const char*>()) {
        config_manager->setSupabaseUrl(doc["supabase_url"].as<const char*>());
    }
    if (!doc["time_zone"].isNull()) {
        String time_zone = doc["time_zone"].as<String>();
        time_zone.trim();
        if (!time_zone.isEmpty()) {
            config_manager->setTimeZone(time_zone);
            time_config_updated = true;
        }
    }
    if (!doc["ntp_server"].isNull()) {
        String ntp_server = doc["ntp_server"].as<String>();
        ntp_server.trim();
        if (ntp_server.isEmpty()) {
            ntp_server = "pool.ntp.org";
        }
        config_manager->setNtpServer(ntp_server);
        time_config_updated = true;
    }
    if (!doc["time_format"].isNull()) {
        String time_format = doc["time_format"].as<String>();
        time_format.trim();
        if (!time_format.isEmpty()) {
            config_manager->setTimeFormat(time_format);
            time_config_updated = true;
        }
    }
    if (!doc["date_format"].isNull()) {
        String date_format = doc["date_format"].as<String>();
        date_format.trim();
        if (!date_format.isEmpty()) {
            config_manager->setDateFormat(date_format);
            time_config_updated = true;
        }
    }

    // Debug configuration
    if (doc["debug_mode"].is<bool>()) {
        bool debug_mode = doc["debug_mode"].as<bool>();
        config_manager->setDebugMode(debug_mode);
        // Update global flag immediately so logging takes effect
        extern bool g_debug_mode;
        g_debug_mode = debug_mode;
        Serial.printf("[WEB] Debug mode %s\n", debug_mode ? "enabled" : "disabled");
    }
    if (doc["pairing_realtime_debug"].is<bool>()) {
        bool pairing_debug = doc["pairing_realtime_debug"].as<bool>();
        config_manager->setPairingRealtimeDebug(pairing_debug);
    }
    if (doc["tls_verify"].is<bool>()) {
        bool tls_verify = doc["tls_verify"].as<bool>();
        config_manager->setTlsVerify(tls_verify);
        Serial.printf("[WEB] TLS verify %s\n", tls_verify ? "enabled" : "disabled");
    }

    if (time_config_updated) {
        applyTimeConfig(*config_manager, app_state);
    }

    Serial.println("[WEB] Configuration save complete");

    sendSuccessResponse(request, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleReboot(AsyncWebServerRequest* request) {
    sendSuccessResponse(request, "Rebooting...", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
    // Schedule reboot for 500ms from now to allow response to be sent
    pending_reboot = true;
    pending_reboot_time = millis() + 500;
    pending_boot_partition = nullptr;
    Serial.println("[WEB] Reboot scheduled");
}

void WebServerManager::handleFactoryReset(AsyncWebServerRequest* request) {
    // Factory reset is disabled for web API - must be done locally via serial console
    // This prevents accidentally breaking the connection to Supabase
    Serial.println("[WEB] Factory reset rejected - must be performed locally via serial");
    sendErrorResponse(request, 403, "Factory reset must be performed locally via serial console",
                      [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleClearMQTT(AsyncWebServerRequest* request) {
    config_manager->setMQTTConfig("", 1883, "", "", "");
    mqtt_client.invalidateConfig();  // Clear cached config
    Serial.println("[WEB] MQTT configuration cleared");
    sendSuccessResponse(request, "MQTT configuration cleared", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleMQTTDebug(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, data, len);

    if (error) {
        sendErrorResponse(request, 400, "Invalid JSON", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }

    bool enabled = doc["enabled"] | false;
    mqtt_client.setDebugEnabled(enabled);

    Serial.printf("[WEB] MQTT debug logging %s\n", enabled ? "enabled" : "disabled");

    JsonDocument resp;
    resp["success"] = true;
    resp["debug_enabled"] = mqtt_client.isDebugEnabled();

    sendJsonResponse(request, 200, resp, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleRegeneratePairingCode(AsyncWebServerRequest* request) {
    String newCode = pairing_manager.generateCode(true);
    supabaseClient.setPairingCode(newCode);
    app_state->supabase_realtime_resubscribe = true;
    Serial.println("[WEB] New pairing code generated");

    JsonDocument doc;
    doc["success"] = true;
    doc["code"] = newCode;

    sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}
