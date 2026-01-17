/**
 * @file xapi_websocket.cpp
 * @brief Webex xAPI WebSocket Client Implementation
 */

#include "xapi_websocket.h"
#include <ArduinoJson.h>

// Global instance for callback
XAPIWebSocket* g_xapi_instance = nullptr;

XAPIWebSocket::XAPIWebSocket()
    : config_manager(nullptr), connected(false), update_pending(false), last_reconnect(0) {
    current_state.camera_on = false;
    current_state.mic_muted = false;
    current_state.in_call = false;
    current_state.valid = false;
}

XAPIWebSocket::~XAPIWebSocket() {
    disconnect();
}

void XAPIWebSocket::begin(ConfigManager* config) {
    config_manager = config;
    g_xapi_instance = this;
    
    String device_id = config_manager->getXAPIDeviceId();
    if (device_id.isEmpty()) {
        Serial.println("[XAPI] No device ID configured, skipping WebSocket connection");
        return;
    }
    
    // Note: In a full implementation, you would need to:
    // 1. Get the device's WebSocket URL from Webex API
    // 2. Use the access token for authentication
    // For now, this is a simplified implementation
    
    Serial.printf("[XAPI] Connecting to device: %s\n", device_id.c_str());
    
    // Configure WebSocket client
    // The actual implementation would connect to the device's specific endpoint
    // This is a placeholder for the connection logic
    
    ws_client.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_xapi_instance) {
            g_xapi_instance->onWebSocketEvent(type, payload, length);
        }
    });
    
    // In production, you would get the actual WebSocket URL from the Webex API
    // ws_client.beginSSL(host, port, path);
    
    Serial.println("[XAPI] WebSocket client configured");
}

void XAPIWebSocket::loop() {
    ws_client.loop();
    
    // Handle reconnection
    if (!connected && config_manager->hasXAPIDevice()) {
        if (millis() - last_reconnect > 30000) {
            last_reconnect = millis();
            reconnect();
        }
    }
}

XAPIUpdate XAPIWebSocket::getUpdate() {
    update_pending = false;
    return current_state;
}

void XAPIWebSocket::disconnect() {
    ws_client.disconnect();
    connected = false;
}

void XAPIWebSocket::reconnect() {
    Serial.println("[XAPI] Attempting to reconnect...");
    
    // In production implementation, this would:
    // 1. Get fresh access token
    // 2. Query Webex API for device WebSocket URL
    // 3. Connect with proper authentication
}

void XAPIWebSocket::onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("[XAPI] WebSocket disconnected");
            connected = false;
            break;
            
        case WStype_CONNECTED:
            Serial.println("[XAPI] WebSocket connected");
            connected = true;
            subscribeToEvents();
            break;
            
        case WStype_TEXT: {
            String message = String((char*)payload);
            Serial.printf("[XAPI] Received: %s\n", message.substring(0, 100).c_str());
            parseStatusUpdate(message);
            break;
        }
            
        case WStype_ERROR:
            Serial.println("[XAPI] WebSocket error");
            break;
            
        default:
            break;
    }
}

void XAPIWebSocket::subscribeToEvents() {
    // Subscribe to status updates
    // In the actual xAPI, you would send xFeedback commands
    
    JsonDocument doc;
    doc["jsonrpc"] = "2.0";
    doc["method"] = "xFeedback/Subscribe";
    doc["params"]["Query"] = "Status/Audio/Microphones/Mute";
    doc["id"] = 1;
    
    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
    
    // Subscribe to camera status
    doc["params"]["Query"] = "Status/Video/Input/MainVideoSource";
    doc["id"] = 2;
    message = "";
    serializeJson(doc, message);
    ws_client.sendTXT(message);
    
    // Subscribe to call status
    doc["params"]["Query"] = "Status/Call";
    doc["id"] = 3;
    message = "";
    serializeJson(doc, message);
    ws_client.sendTXT(message);
    
    Serial.println("[XAPI] Subscribed to status events");
}

void XAPIWebSocket::parseStatusUpdate(const String& message) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, message);
    
    if (error) {
        return;
    }
    
    // Check for status updates
    if (doc["method"] == "xFeedback") {
        JsonObject params = doc["params"];
        
        // Microphone mute status
        if (params.containsKey("Status")) {
            JsonObject status = params["Status"];
            
            if (status.containsKey("Audio")) {
                JsonObject audio = status["Audio"];
                if (audio["Microphones"]["Mute"].is<String>()) {
                    String mute = audio["Microphones"]["Mute"].as<String>();
                    current_state.mic_muted = (mute == "On");
                    update_pending = true;
                }
            }
            
            if (status.containsKey("Video")) {
                JsonObject video = status["Video"];
                if (video["Input"]["MainVideoSource"].is<String>()) {
                    String source = video["Input"]["MainVideoSource"].as<String>();
                    current_state.camera_on = !source.isEmpty() && source != "None";
                    update_pending = true;
                }
            }
            
            if (status.containsKey("Call")) {
                // Check if there's an active call
                JsonArray calls = status["Call"].as<JsonArray>();
                current_state.in_call = (calls.size() > 0);
                update_pending = true;
            }
        }
    }
    
    if (update_pending) {
        current_state.valid = true;
        Serial.printf("[XAPI] Status update: Camera=%s, Mic=%s, InCall=%s\n",
                      current_state.camera_on ? "On" : "Off",
                      current_state.mic_muted ? "Muted" : "Unmuted",
                      current_state.in_call ? "Yes" : "No");
    }
}
