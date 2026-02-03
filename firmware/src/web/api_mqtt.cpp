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
#include <ArduinoJson.h>

// External MQTT client for config invalidation
extern MerakiMQTTClient mqtt_client;

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
