/**
 * @file api_embedded.cpp
 * @brief Embedded App Status API Handlers
 */

#include "web_server.h"
#include <ArduinoJson.h>

void WebServerManager::handleEmbeddedStatusGet(AsyncWebServerRequest* request) {
    // Return current status for embedded app to read
    JsonDocument doc;
    
    doc["status"] = app_state->webex_status;
    doc["camera_on"] = app_state->camera_on;
    doc["mic_muted"] = app_state->mic_muted;
    doc["in_call"] = app_state->in_call;
    doc["display_name"] = config_manager->getDisplayName();
    doc["hostname"] = config_manager->getDeviceName() + ".local";
    doc["embedded_app_enabled"] = true;
    
    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleEmbeddedStatus(AsyncWebServerRequest* request, uint8_t* data, size_t len,
                                            size_t index, size_t total) {
    // Receive status update from Webex Embedded App
    if (index == 0) {
        embedded_body_buffer = "";
        embedded_body_expected = total;
        if (total > 0) {
            embedded_body_buffer.reserve(total);
        }
    }

    if (len > 0) {
        String chunk(reinterpret_cast<char*>(data), len);
        embedded_body_buffer += chunk;
    }

    if (total > 0 && (index + len) < total) {
        return;
    }

    const String body = embedded_body_buffer;
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    
    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }
    
    // Update app state from embedded app
    if (doc["status"].is<const char*>()) {
        String newStatus = doc["status"].as<String>();
        
        // Map embedded app status to internal status
        if (newStatus == "active" || newStatus == "available") {
            app_state->webex_status = "active";
        } else if (newStatus == "away" || newStatus == "inactive") {
            app_state->webex_status = "away";
        } else if (newStatus == "dnd" || newStatus == "donotdisturb") {
            app_state->webex_status = "dnd";
        } else if (newStatus == "meeting" || newStatus == "call" || newStatus == "busy") {
            app_state->webex_status = "meeting";
            app_state->in_call = true;
        } else if (newStatus == "ooo" || newStatus == "outofoffice") {
            app_state->webex_status = "ooo";
        } else if (newStatus == "offline") {
            app_state->webex_status = "offline";
        } else {
            app_state->webex_status = newStatus;
        }
        
        Serial.printf("[WEB] Embedded app status update: %s\n", app_state->webex_status.c_str());
    }
    
    // Handle call state
    if (doc["in_call"].is<bool>()) {
        app_state->in_call = doc["in_call"].as<bool>();
    }
    
    // Handle camera state
    if (doc["camera_on"].is<bool>()) {
        app_state->camera_on = doc["camera_on"].as<bool>();
    }
    
    // Handle mic state
    if (doc["mic_muted"].is<bool>()) {
        app_state->mic_muted = doc["mic_muted"].as<bool>();
    }
    
    // Handle display name update
    if (doc["displayName"].is<const char*>()) {
        config_manager->setDisplayName(doc["displayName"].as<const char*>());
    }
    
    // Mark as connected via embedded app
    app_state->embedded_app_connected = true;
    
    JsonDocument response;
    response["success"] = true;
    response["status"] = app_state->webex_status;
    response["message"] = "Status updated from embedded app";
    
    String responseStr;
    serializeJson(response, responseStr);
    request->send(200, "application/json", responseStr);
}
