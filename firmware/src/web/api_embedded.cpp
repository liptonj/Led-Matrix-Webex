/**
 * @file api_embedded.cpp
 * @brief Embedded App Status API Handlers
 */

#include "web_server.h"
#include "web_helpers.h"
#include "common/lookup_tables.h"
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
    
    sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleEmbeddedStatus(AsyncWebServerRequest* request, uint8_t* data, size_t len,
                                            size_t index, size_t total) {
    // Receive status update from Webex Embedded App
    // Security: Limit body size to prevent DoS attacks
    const size_t MAX_EMBEDDED_BODY_SIZE = 4096;  // 4KB max for status updates
    
    if (index == 0) {
        embedded_body_buffer = "";
        embedded_body_expected = total;
        
        // Reject oversized requests early
        if (total > MAX_EMBEDDED_BODY_SIZE) {
            Serial.printf("[WEB] Embedded body too large: %zu bytes (max %d)\n", total, MAX_EMBEDDED_BODY_SIZE);
            sendErrorResponse(request, 413, "Request body too large", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
            return;
        }
        
        if (total > 0) {
            embedded_body_buffer.reserve(total);
        }
    }

    if (len > 0) {
        // Prevent buffer overflow during accumulation
        if (embedded_body_buffer.length() + len > MAX_EMBEDDED_BODY_SIZE) {
            Serial.printf("[WEB] Embedded buffer overflow prevented: %zu + %zu > %d\n",
                          embedded_body_buffer.length(), len, MAX_EMBEDDED_BODY_SIZE);
            sendErrorResponse(request, 413, "Request body too large", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
            embedded_body_buffer = "";  // Reset buffer
            return;
        }
        
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
        sendErrorResponse(request, 400, "Invalid JSON", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }
    
    // Update app state from embedded app using lookup table
    if (doc["status"].is<const char*>()) {
        String newStatus = doc["status"].as<String>();
        
        // Map embedded app status to internal status using lookup table
        EmbeddedStatusLookup::NormalizedStatus normalized = 
            EmbeddedStatusLookup::normalize(newStatus.c_str());
        
        app_state->webex_status = normalized.status;
        if (normalized.sets_in_call) {
            app_state->in_call = true;
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
    
    JsonDocument responseDoc;
    responseDoc["success"] = true;
    responseDoc["status"] = app_state->webex_status;
    responseDoc["message"] = "Status updated from embedded app";
    
    sendJsonResponse(request, 200, responseDoc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}
