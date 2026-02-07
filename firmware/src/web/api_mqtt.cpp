/**
 * @file api_mqtt.cpp
 * @brief MQTT Operations API Handlers
 * 
 * Handles MQTT-related endpoints:
 * - POST /api/clear-mqtt - Clears MQTT configuration
 * - POST /api/mqtt/debug - Toggles MQTT debug logging
 */

#include "web_server.h"
#include "web_helpers.h"
#include "../meraki/mqtt_client.h"
#include "../core/dependencies.h"
#include "../debug/log_system.h"
#include <ArduinoJson.h>

static const char* TAG = "API_MQTT";

void WebServerManager::handleClearMQTT(AsyncWebServerRequest* request) {
    auto& deps = getDependencies();
    config_manager->setMQTTConfig("", 1883, "", "", "");
    deps.mqtt.invalidateConfig();  // Clear cached config
    ESP_LOGI(TAG, "MQTT configuration cleared");
    sendSuccessResponse(request, "MQTT configuration cleared", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleMQTTDebug(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    auto& deps = getDependencies();
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, data, len);

    if (error) {
        sendErrorResponse(request, 400, "Invalid JSON", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }

    bool enabled = doc["enabled"] | false;
    deps.mqtt.setDebugEnabled(enabled);

    ESP_LOGI(TAG, "MQTT debug logging %s", enabled ? "enabled" : "disabled");

    JsonDocument resp;
    resp["success"] = true;
    resp["debug_enabled"] = deps.mqtt.isDebugEnabled();

    sendJsonResponse(request, 200, resp, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}
