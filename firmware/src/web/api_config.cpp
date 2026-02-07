/**
 * @file api_config.cpp
 * @brief Configuration API Handlers
 * 
 * Handles configuration endpoints:
 * - GET /api/config - Returns current device configuration
 * - POST /api/config - Saves device configuration with validation
 */

#include "web_server.h"
#include "web_helpers.h"
#include "../time/time_manager.h"
#include "../meraki/mqtt_client.h"
#include "../core/dependencies.h"
#include "../config/pin_config.h"
#include "../common/board_utils.h"
#include "../auth/device_credentials.h"
#include "../debug/log_system.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_ota_ops.h>

static const char* TAG = "API_CFG";

void WebServerManager::handleConfig(AsyncWebServerRequest* request) {
    auto& deps = getDependencies();
    JsonDocument doc;

    // UUID-based Device Identity (Phase 3)
    doc["device_uuid"] = config_manager->getDeviceUuid().isEmpty() ? "" : config_manager->getDeviceUuid();
    doc["user_uuid"] = config_manager->getUserUuid().isEmpty() ? "" : config_manager->getUserUuid();
    doc["last_webex_status"] = config_manager->getLastWebexStatus().isEmpty() ? "" : config_manager->getLastWebexStatus();
    
    // Device identification
    doc["serial_number"] = deps.credentials.getSerialNumber();
    #ifdef FIRMWARE_VERSION
    doc["firmware_version"] = FIRMWARE_VERSION;
    #else
    doc["firmware_version"] = "unknown";
    #endif
    
    // WiFi status
    String wifi_ssid;
    if (WiFi.status() == WL_CONNECTED && !WiFi.SSID().isEmpty()) {
        wifi_ssid = WiFi.SSID();
    } else {
        wifi_ssid = config_manager->getWiFiSSID();
    }
    doc["wifi_ssid"] = wifi_ssid.isEmpty() ? "" : wifi_ssid;
    doc["wifi_rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
    
    // System telemetry
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime_seconds"] = millis() / 1000;

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
    
    // Color scheme (composite object for convenience)
    JsonObject color_scheme = doc["color_scheme"].to<JsonObject>();
    color_scheme["date"] = config_manager->getDateColor();
    color_scheme["time"] = config_manager->getTimeColor();
    color_scheme["name"] = config_manager->getNameColor();
    color_scheme["metric"] = config_manager->getMetricColor();
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
            ESP_LOGW(TAG, "Config body too large: %zu bytes (max %d)", total, MAX_CONFIG_BODY_SIZE);
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
            ESP_LOGW(TAG, "Config buffer overflow prevented: %zu + %zu > %d",
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

    ESP_LOGI(TAG, "Received config save request (length: %d bytes)", body.length());

    // Final size check (defense in depth)
    if (body.length() > MAX_CONFIG_BODY_SIZE) {
        ESP_LOGW(TAG, "Config body too large: %d bytes (max %d)", body.length(), MAX_CONFIG_BODY_SIZE);
        sendErrorResponse(request, 413, "Request body too large", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        ESP_LOGE(TAG, "Failed to parse JSON: %s", error.c_str());
        sendErrorResponse(request, 400, "Invalid JSON", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }

    // Update configuration with input validation
    bool time_config_updated = false;
    if (doc["device_name"].is<const char*>()) {
        String device_name = doc["device_name"].as<String>();
        // Validate: max 64 chars, printable ASCII
        if (device_name.length() <= 64 && device_name.length() > 0) {
            if (isPrintableAscii(device_name)) {
                config_manager->setDeviceName(device_name);
            } else {
                ESP_LOGW(TAG, "Invalid device_name: non-printable characters");
            }
        } else {
            ESP_LOGW(TAG, "Invalid device_name length: %d (max 64)", device_name.length());
        }
    }
    if (doc["display_name"].is<const char*>()) {
        String display_name = doc["display_name"].as<String>();
        // Validate: max 64 chars, printable ASCII
        if (display_name.length() <= 64 && display_name.length() > 0) {
            if (isPrintableAscii(display_name)) {
                config_manager->setDisplayName(display_name);
            } else {
                ESP_LOGW(TAG, "Invalid display_name: non-printable characters");
            }
        } else {
            ESP_LOGW(TAG, "Invalid display_name length: %d (max 64)", display_name.length());
        }
    }
    if (doc["brightness"].is<int>()) {
        int brightness = doc["brightness"].as<int>();
        // Validate: 0-255
        if (brightness >= 0 && brightness <= 255) {
            config_manager->setBrightness(static_cast<uint8_t>(brightness));
        } else {
            ESP_LOGW(TAG, "Invalid brightness: %d (must be 0-255)", brightness);
        }
    }
    if (doc["scroll_speed_ms"].is<int>()) {
        int scroll_speed = doc["scroll_speed_ms"].as<int>();
        // Validate: 10-10000ms (10ms to 10 seconds)
        if (scroll_speed >= 10 && scroll_speed <= 10000) {
            config_manager->setScrollSpeedMs(static_cast<uint16_t>(scroll_speed));
        } else {
            ESP_LOGW(TAG, "Invalid scroll_speed_ms: %d (must be 10-10000)", scroll_speed);
        }
    }
    if (doc["page_interval_ms"].is<int>()) {
        int page_interval = doc["page_interval_ms"].as<int>();
        // Validate: 100-60000ms (100ms to 60 seconds)
        if (page_interval >= 100 && page_interval <= 60000) {
            config_manager->setPageIntervalMs(static_cast<uint16_t>(page_interval));
        } else {
            ESP_LOGW(TAG, "Invalid page_interval_ms: %d (must be 100-60000)", page_interval);
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
            ESP_LOGW(TAG, "Invalid poll_interval: %d (must be 5-300)", poll_interval);
        }
    }
    if (doc["xapi_poll_interval"].is<int>()) {
        int xapi_poll_interval = doc["xapi_poll_interval"].as<int>();
        // Validate: 1-60 seconds
        if (xapi_poll_interval >= 1 && xapi_poll_interval <= 60) {
            config_manager->setXAPIPollInterval(static_cast<uint16_t>(xapi_poll_interval));
        } else {
            ESP_LOGW(TAG, "Invalid xapi_poll_interval: %d (must be 1-60)", xapi_poll_interval);
        }
    }
    if (doc["xapi_device_id"].is<const char*>()) {
        String device_id = doc["xapi_device_id"].as<String>();
        // Validate: max 128 chars, alphanumeric + hyphens
        if (device_id.length() <= 128) {
            config_manager->setXAPIDeviceId(device_id);
        } else {
            ESP_LOGW(TAG, "Invalid xapi_device_id length: %d (max 128)", device_id.length());
        }
    }
    // Webex credentials - only save if both fields provided
    if (doc["webex_client_id"].is<const char*>() && doc["webex_client_secret"].is<const char*>()) {
        String client_id = doc["webex_client_id"].as<String>();
        String client_secret = doc["webex_client_secret"].as<String>();

        if (!client_id.isEmpty() && !client_secret.isEmpty()) {
            config_manager->setWebexCredentials(client_id, client_secret);
            ESP_LOGI(TAG, "Webex credentials saved - Client ID: %s***", client_id.substring(0, 8).c_str());
        } else if (client_id.isEmpty() && client_secret.isEmpty()) {
            ESP_LOGI(TAG, "Empty Webex credentials provided - skipping save");
        } else {
            ESP_LOGW(TAG, "Warning: Only one Webex credential field provided");
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
                ESP_LOGW(TAG, "Invalid mqtt_port: %d (must be 1-65535), using default 1883", port_val);
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
                    ESP_LOGI(TAG, "MQTT password updated");
                } else {
                    // Empty string provided - keep existing password
                    password = config_manager->getMQTTPassword();
                    ESP_LOGI(TAG, "Empty MQTT password provided - keeping existing");
                }
            } else {
                // Field not provided - keep existing password
                password = config_manager->getMQTTPassword();
                ESP_LOGI(TAG, "MQTT password not provided - keeping existing");
            }

            config_manager->setMQTTConfig(broker, port, username, password, topic);
            auto& deps = getDependencies();
            deps.mqtt.invalidateConfig();  // Force reconnect with new settings
            ESP_LOGI(TAG, "MQTT config saved - Broker: %s:%d, Username: %s",
                         broker.c_str(), port, username.isEmpty() ? "(none)" : username.c_str());
        } else {
            ESP_LOGW(TAG, "Invalid mqtt_broker length: %d (must be 1-256)", broker.length());
        }
    }

    // Sensor MAC filter list (comma/semicolon separated)
    if (doc["sensor_macs"].is<const char*>()) {
        String macs = doc["sensor_macs"].as<String>();
        config_manager->setSensorMacs(macs);
        if (!macs.isEmpty()) {
            ESP_LOGI(TAG, "Sensor MACs saved: %s", macs.c_str());
        }
    } else if (doc["sensor_serial"].is<const char*>()) {
        String serial = doc["sensor_serial"].as<String>();
        config_manager->setSensorSerial(serial);
        if (!serial.isEmpty()) {
            ESP_LOGI(TAG, "Sensor serial saved: %s", serial.c_str());
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
        ESP_LOGI(TAG, "Cleared failed OTA version marker");
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
        // Update ESP-IDF log level immediately so logging takes effect
        esp_log_level_set("*", debug_mode ? ESP_LOG_DEBUG : ESP_LOG_INFO);
        ESP_LOGI(TAG, "Debug mode %s", debug_mode ? "enabled" : "disabled");
    }
    if (doc["pairing_realtime_debug"].is<bool>()) {
        bool pairing_debug = doc["pairing_realtime_debug"].as<bool>();
        config_manager->setPairingRealtimeDebug(pairing_debug);
    }
    if (doc["tls_verify"].is<bool>()) {
        bool tls_verify = doc["tls_verify"].as<bool>();
        config_manager->setTlsVerify(tls_verify);
        ESP_LOGI(TAG, "TLS verify %s", tls_verify ? "enabled" : "disabled");
    }

    if (time_config_updated) {
        applyTimeConfig(*config_manager, app_state);
    }

    ESP_LOGI(TAG, "Configuration save complete");

    sendSuccessResponse(request, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleGetPinConfig(AsyncWebServerRequest* request) {
    ESP_LOGI(TAG, "GET /api/config/pins requested");
    
    JsonDocument doc;
    
    // Board info
    String boardType = getBoardType();
    String chipDesc = getChipDescription();
    doc["board_type"] = boardType;
    doc["chip_description"] = chipDesc;
    ESP_LOGI(TAG, "Board: %s, Chip: %s", boardType.c_str(), chipDesc.c_str());
    
    // Current preset
    PinPreset preset = config_manager->getPinPreset();
    doc["preset"] = static_cast<uint8_t>(preset);
    doc["preset_name"] = getPresetName(preset);
    doc["default_preset"] = static_cast<uint8_t>(getDefaultPresetForBoard());
    doc["default_preset_name"] = getPresetName(getDefaultPresetForBoard());
    ESP_LOGI(TAG, "Preset: %d (%s)", static_cast<int>(preset), getPresetName(preset));
    
    // Current effective pins
    PinConfig pins = config_manager->getPinConfig();
    JsonObject pinsObj = doc["pins"].to<JsonObject>();
    pinsObj["r1"] = pins.r1;
    pinsObj["g1"] = pins.g1;
    pinsObj["b1"] = pins.b1;
    pinsObj["r2"] = pins.r2;
    pinsObj["g2"] = pins.g2;
    pinsObj["b2"] = pins.b2;
    pinsObj["a"] = pins.a;
    pinsObj["b"] = pins.b;
    pinsObj["c"] = pins.c;
    pinsObj["d"] = pins.d;
    pinsObj["e"] = pins.e;
    pinsObj["clk"] = pins.clk;
    pinsObj["lat"] = pins.lat;
    pinsObj["oe"] = pins.oe;
    
    // Available presets
    JsonArray presets = doc["available_presets"].to<JsonArray>();
    for (uint8_t i = 0; i < static_cast<uint8_t>(PinPreset::PRESET_COUNT); i++) {
        JsonObject p = presets.add<JsonObject>();
        p["id"] = i;
        p["name"] = getPresetName(static_cast<PinPreset>(i));
    }
    
    ESP_LOGI(TAG, "Pin config response: %d presets, heap=%lu", 
                  static_cast<int>(PinPreset::PRESET_COUNT), (unsigned long)ESP.getFreeHeap());
    sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleSavePinConfig(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String body(reinterpret_cast<char*>(data), len);
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    
    if (error) {
        ESP_LOGE(TAG, "Failed to parse pin config JSON: %s", error.c_str());
        sendErrorResponse(request, 400, "Invalid JSON", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }
    
    // Check if setting a preset or custom pins
    if (doc["preset"].is<int>()) {
        int preset_id = doc["preset"].as<int>();
        if (preset_id >= 0 && preset_id < static_cast<int>(PinPreset::PRESET_COUNT)) {
            PinPreset preset = static_cast<PinPreset>(preset_id);
            config_manager->setPinPreset(preset);
            ESP_LOGI(TAG, "Pin preset set to: %s", getPresetName(preset));
            
            // If custom preset, also save custom pins
            if (preset == PinPreset::CUSTOM && doc["pins"].is<JsonObject>()) {
                JsonObject pinsObj = doc["pins"].as<JsonObject>();
                PinConfig pins;
                pins.r1 = pinsObj["r1"] | -1;
                pins.g1 = pinsObj["g1"] | -1;
                pins.b1 = pinsObj["b1"] | -1;
                pins.r2 = pinsObj["r2"] | -1;
                pins.g2 = pinsObj["g2"] | -1;
                pins.b2 = pinsObj["b2"] | -1;
                pins.a = pinsObj["a"] | -1;
                pins.b = pinsObj["b"] | -1;
                pins.c = pinsObj["c"] | -1;
                pins.d = pinsObj["d"] | -1;
                pins.e = pinsObj["e"] | -1;  // Can be -1 for 1/16 scan
                pins.clk = pinsObj["clk"] | -1;
                pins.lat = pinsObj["lat"] | -1;
                pins.oe = pinsObj["oe"] | -1;
                
                if (pins.isValid()) {
                    config_manager->setCustomPins(pins);
                    ESP_LOGI(TAG, "Custom pins saved");
                } else {
                    ESP_LOGW(TAG, "Invalid custom pins - some required pins are missing");
                    sendErrorResponse(request, 400, "Invalid pin configuration - required pins missing", 
                                      [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
                    return;
                }
            }
        } else {
            ESP_LOGW(TAG, "Invalid preset ID: %d", preset_id);
            sendErrorResponse(request, 400, "Invalid preset ID", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
            return;
        }
    }
    
    // Respond with success and indicate reboot is required
    JsonDocument response;
    response["success"] = true;
    response["message"] = "Pin configuration saved. Reboot required to apply changes.";
    response["reboot_required"] = true;
    
    sendJsonResponse(request, 200, response, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}
