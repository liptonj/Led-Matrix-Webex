/**
 * @file api_status.cpp
 * @brief Status and Configuration API Handlers
 */

#include "web_server.h"
#include "../time/time_manager.h"
#include "../meraki/mqtt_client.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_ota_ops.h>
#include <LittleFS.h>

// External MQTT client for config invalidation
extern MerakiMQTTClient mqtt_client;

// External pairing manager for bridge pairing code
#include "../bridge/pairing_manager.h"
extern PairingManager pairing_manager;

void WebServerManager::handleStatus(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["wifi_connected"] = app_state->wifi_connected;
    doc["webex_authenticated"] = app_state->webex_authenticated;
    doc["bridge_connected"] = app_state->bridge_connected;
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
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;

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

    String responseStr;
    serializeJson(doc, responseStr);
    
    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", responseStr);
    addCorsHeaders(response);
    request->send(response);
}

void WebServerManager::handleConfig(AsyncWebServerRequest* request) {
    JsonDocument doc;

    // Device configuration - always include all fields
    doc["device_name"] = config_manager->getDeviceName();
    doc["display_name"] = config_manager->getDisplayName();
    doc["brightness"] = config_manager->getBrightness();
    doc["scroll_speed_ms"] = config_manager->getScrollSpeedMs();
    doc["poll_interval"] = config_manager->getWebexPollInterval();
    doc["xapi_poll_interval"] = config_manager->getXAPIPollInterval();
    // Boolean flags - always include as explicit booleans
    doc["has_webex_credentials"] = config_manager->hasWebexCredentials();
    doc["has_webex_tokens"] = config_manager->hasWebexTokens();
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
    // Boolean flag - always include as explicit boolean
    doc["auto_update"] = config_manager->getAutoUpdate();
    doc["time_zone"] = config_manager->getTimeZone().isEmpty() ? "UTC" : config_manager->getTimeZone();
    doc["ntp_server"] = config_manager->getNtpServer().isEmpty() ? "pool.ntp.org" : config_manager->getNtpServer();
    doc["time_format"] = config_manager->getTimeFormat().isEmpty() ? "24h" : config_manager->getTimeFormat();
    doc["date_format"] = config_manager->getDateFormat().isEmpty() ? "mdy" : config_manager->getDateFormat();
    
    // Bridge configuration
    doc["bridge_url"] = config_manager->getBridgeUrl().isEmpty() ? "" : config_manager->getBridgeUrl();
    doc["bridge_host"] = config_manager->getBridgeHost().isEmpty() ? "" : config_manager->getBridgeHost();
    doc["bridge_port"] = config_manager->getBridgePort();
    doc["bridge_use_ssl"] = config_manager->getBridgeUseSSL();
    doc["has_bridge_config"] = config_manager->hasBridgeConfig();
    
    // Debug configuration
    doc["debug_mode"] = config_manager->getDebugMode();

    String responseStr;
    serializeJson(doc, responseStr);
    
    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", responseStr);
    addCorsHeaders(response);
    request->send(response);
}

void WebServerManager::handleSaveConfig(AsyncWebServerRequest* request, uint8_t* data, size_t len,
                                        size_t index, size_t total) {
    if (index == 0) {
        config_body_buffer = "";
        config_body_expected = total;
        if (total > 0) {
            config_body_buffer.reserve(total);
        }
    }

    if (len > 0) {
        String chunk(reinterpret_cast<char*>(data), len);
        config_body_buffer += chunk;
    }

    if (total > 0 && (index + len) < total) {
        return;
    }

    const String body = config_body_buffer;

    Serial.printf("[WEB] Received config save request (length: %d bytes)\n", body.length());
    Serial.printf("[WEB] Body: %s\n", body.c_str());

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        Serial.printf("[WEB] Failed to parse JSON: %s\n", error.c_str());
        AsyncWebServerResponse* errResponse = request->beginResponse(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        addCorsHeaders(errResponse);
        request->send(errResponse);
        return;
    }

    // Update configuration
    bool time_config_updated = false;
    if (doc["device_name"].is<const char*>()) {
        config_manager->setDeviceName(doc["device_name"].as<const char*>());
    }
    if (doc["display_name"].is<const char*>()) {
        config_manager->setDisplayName(doc["display_name"].as<const char*>());
    }
    if (doc["brightness"].is<int>()) {
        config_manager->setBrightness(doc["brightness"].as<uint8_t>());
    }
    if (doc["scroll_speed_ms"].is<int>()) {
        config_manager->setScrollSpeedMs(doc["scroll_speed_ms"].as<uint16_t>());
    }
    if (doc["poll_interval"].is<int>()) {
        config_manager->setWebexPollInterval(doc["poll_interval"].as<uint16_t>());
    }
    if (doc["xapi_poll_interval"].is<int>()) {
        config_manager->setXAPIPollInterval(doc["xapi_poll_interval"].as<uint16_t>());
    }
    if (doc["xapi_device_id"].is<const char*>()) {
        config_manager->setXAPIDeviceId(doc["xapi_device_id"].as<const char*>());
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
    
    // MQTT configuration
    if (doc["mqtt_broker"].is<const char*>()) {
        String broker = doc["mqtt_broker"].as<String>();
        uint16_t port = doc["mqtt_port"].is<int>() ? doc["mqtt_port"].as<uint16_t>() : 1883;
        String username = doc["mqtt_username"].is<const char*>() ? doc["mqtt_username"].as<String>() : "";
        String topic = doc["mqtt_topic"].is<const char*>() ? doc["mqtt_topic"].as<String>() : "meraki/v1/mt/#";
        
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
    
    // Bridge configuration
    // Always trigger reconnection if ANY bridge config is provided in the request
    // This ensures reconnection even if going from cloud discovery to manual config
    bool bridge_url_provided = doc["bridge_url"].is<const char*>();
    bool bridge_host_provided = doc["bridge_host"].is<const char*>();
    bool bridge_port_provided = doc["bridge_port"].is<int>();
    bool bridge_ssl_provided = doc["bridge_use_ssl"].is<bool>();
    bool bridge_config_provided = bridge_url_provided || bridge_host_provided || 
                                   bridge_port_provided || bridge_ssl_provided;
    bool bridge_config_changed = false;
    
    Serial.printf("[WEB] Bridge config detection: url=%d host=%d port=%d ssl=%d total=%d\n",
                  bridge_url_provided, bridge_host_provided, bridge_port_provided, 
                  bridge_ssl_provided, bridge_config_provided);
    
    if (doc["bridge_url"].is<const char*>()) {
        String bridge_url = doc["bridge_url"].as<String>();
        bridge_url.trim();
        String current_url = config_manager->getBridgeUrl();
        if (bridge_url != current_url) {
            bridge_config_changed = true;
        }
        config_manager->setBridgeUrl(bridge_url);
        Serial.printf("[WEB] Bridge URL saved: %s\n", bridge_url.isEmpty() ? "(empty)" : bridge_url.c_str());
    }
    if (doc["bridge_host"].is<const char*>()) {
        String bridge_host = doc["bridge_host"].as<String>();
        bridge_host.trim();
        String current_host = config_manager->getBridgeHost();
        if (bridge_host != current_host) {
            bridge_config_changed = true;
        }
        config_manager->setBridgeHost(bridge_host);
        Serial.printf("[WEB] Bridge host saved: %s\n", bridge_host.isEmpty() ? "(empty)" : bridge_host.c_str());
    }
    if (doc["bridge_port"].is<int>()) {
        uint16_t bridge_port = doc["bridge_port"].as<uint16_t>();
        if (bridge_port == 0) bridge_port = 443;
        uint16_t current_port = config_manager->getBridgePort();
        if (bridge_port != current_port) {
            bridge_config_changed = true;
        }
        config_manager->setBridgePort(bridge_port);
        Serial.printf("[WEB] Bridge port saved: %d\n", bridge_port);
    }
    if (doc["bridge_use_ssl"].is<bool>()) {
        bool bridge_use_ssl = doc["bridge_use_ssl"].as<bool>();
        bool current_ssl = config_manager->getBridgeUseSSL();
        if (bridge_use_ssl != current_ssl) {
            bridge_config_changed = true;
        }
        config_manager->setBridgeUseSSL(bridge_use_ssl);
        Serial.printf("[WEB] Bridge SSL saved: %s\n", bridge_use_ssl ? "true" : "false");
    }
    
    // Trigger bridge reconnection if config changed OR if config was provided
    // (handles switching from auto-discovery to manual config)
    Serial.printf("[WEB] Bridge trigger check: provided=%d changed=%d condition=%d\n",
                  bridge_config_provided, bridge_config_changed, 
                  (bridge_config_provided || bridge_config_changed));
    if (bridge_config_provided || bridge_config_changed) {
        Serial.println("[WEB] Bridge configuration updated - triggering reconnection");
        app_state->bridge_config_changed = true;
        Serial.printf("[WEB] app_state->bridge_config_changed set to: %d\n", 
                      app_state->bridge_config_changed);
    } else {
        Serial.println("[WEB] Bridge reconnection NOT triggered");
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

    if (time_config_updated) {
        applyTimeConfig(*config_manager, app_state);
    }

    Serial.println("[WEB] Configuration save complete");
    
    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", "{\"success\":true}");
    addCorsHeaders(response);
    request->send(response);
}

void WebServerManager::handleReboot(AsyncWebServerRequest* request) {
    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", "{\"success\":true,\"message\":\"Rebooting...\"}");
    addCorsHeaders(response);
    request->send(response);
    // Schedule reboot for 500ms from now to allow response to be sent
    pending_reboot = true;
    pending_reboot_time = millis() + 500;
    pending_boot_partition = nullptr;
    Serial.println("[WEB] Reboot scheduled");
}

void WebServerManager::handleFactoryReset(AsyncWebServerRequest* request) {
    config_manager->factoryReset();
    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", "{\"success\":true,\"message\":\"Factory reset complete. Rebooting...\"}");
    addCorsHeaders(response);
    request->send(response);
    // Schedule reboot
    pending_reboot = true;
    pending_reboot_time = millis() + 500;
    pending_boot_partition = nullptr;
    Serial.println("[WEB] Factory reset reboot scheduled");
}

void WebServerManager::handleClearMQTT(AsyncWebServerRequest* request) {
    config_manager->setMQTTConfig("", 1883, "", "", "");
    mqtt_client.invalidateConfig();  // Clear cached config
    Serial.println("[WEB] MQTT configuration cleared");
    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", "{\"success\":true,\"message\":\"MQTT configuration cleared\"}");
    addCorsHeaders(response);
    request->send(response);
}

void WebServerManager::handleMQTTDebug(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, data, len);
    
    if (error) {
        AsyncWebServerResponse* response = request->beginResponse(400, "application/json", 
            "{\"success\":false,\"message\":\"Invalid JSON\"}");
        addCorsHeaders(response);
        request->send(response);
        return;
    }
    
    bool enabled = doc["enabled"] | false;
    mqtt_client.setDebugEnabled(enabled);
    
    Serial.printf("[WEB] MQTT debug logging %s\n", enabled ? "enabled" : "disabled");
    
    JsonDocument resp;
    resp["success"] = true;
    resp["debug_enabled"] = mqtt_client.isDebugEnabled();
    
    String responseStr;
    serializeJson(resp, responseStr);
    
    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", responseStr);
    addCorsHeaders(response);
    request->send(response);
}

void WebServerManager::handleRegeneratePairingCode(AsyncWebServerRequest* request) {
    String newCode = pairing_manager.generateCode(true);
    Serial.printf("[WEB] New pairing code generated: %s\n", newCode.c_str());
    
    JsonDocument doc;
    doc["success"] = true;
    doc["code"] = newCode;
    
    String responseStr;
    serializeJson(doc, responseStr);
    
    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", responseStr);
    addCorsHeaders(response);
    request->send(response);
}
