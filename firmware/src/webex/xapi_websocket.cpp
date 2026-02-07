/**
 * @file xapi_websocket.cpp
 * @brief Webex xAPI WebSocket Client Implementation
 */

#include "xapi_websocket.h"
#include <ArduinoJson.h>

static const char* TAG = "XAPI_WS";

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
    if (!config) {
        ESP_LOGE(TAG, "Cannot initialize with null config");
        return;
    }
    
    config_manager = config;
    g_xapi_instance = this;
    
    String device_id = config_manager->getXAPIDeviceId();
    if (device_id.isEmpty()) {
        ESP_LOGI(TAG, "No device ID configured, skipping WebSocket connection");
        return;
    }
    
    // Note: In a full implementation, you would need to:
    // 1. Get the device's WebSocket URL from Webex API
    // 2. Use the access token for authentication
    // For now, this is a simplified implementation
    
    ESP_LOGI(TAG, "Configuring for device: %s", device_id.c_str());
    
    // Configure WebSocket client
    // The actual implementation would connect to the device's specific endpoint
    // This is a placeholder for the connection logic
    
    ws_client.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_xapi_instance) {
            g_xapi_instance->onWebSocketEvent(type, payload, length);
        }
    });
    
    // In production, you would get the actual WebSocket URL from the Webex API
    // Example: GET https://webexapis.com/v1/devices/{deviceId}
    // Response includes: { "websocketUrl": "wss://..." }
    // Then: ws_client.beginSSL(host, port, path);
    
    ESP_LOGI(TAG, "WebSocket client configured (connection deferred until URL available)");
}

void XAPIWebSocket::loop() {
    ws_client.loop();
    
    // Handle reconnection
    if (!connected && config_manager && config_manager->hasXAPIDevice()) {
        unsigned long now = millis();
        // FIXED: Handle millis() wraparound properly
        unsigned long elapsed = now - last_reconnect;
        if (elapsed > 30000) {
            last_reconnect = now;
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
    if (!config_manager) {
        ESP_LOGE(TAG, "Cannot reconnect - not initialized");
        return;
    }
    
    String device_id = config_manager->getXAPIDeviceId();
    if (device_id.isEmpty()) {
        ESP_LOGE(TAG, "Cannot reconnect - no device ID");
        return;
    }
    
    ESP_LOGI(TAG, "Attempting to reconnect...");
    
    // FIXED: Add proper implementation notes and error handling
    // In production implementation, this would:
    // 1. Get fresh access token from oauth_handler
    // 2. Query Webex API for device WebSocket URL (/devices/{deviceId})
    // 3. Extract websocketUrl from response
    // 4. Connect with proper authentication (Bearer token)
    // 5. Wait for connection confirmation
    
    // For now, log what's needed
    ESP_LOGI(TAG, "TODO: Implement full connection for device: %s", device_id.c_str());
    ESP_LOGI(TAG, "Required: OAuth token, device WebSocket URL lookup");
}

void XAPIWebSocket::onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            ESP_LOGI(TAG, "WebSocket disconnected");
            connected = false;
            break;
            
        case WStype_CONNECTED:
            ESP_LOGI(TAG, "WebSocket connected");
            connected = true;
            subscribeToEvents();
            break;
            
        case WStype_TEXT: {
            String message = String((char*)payload);
            ESP_LOGD(TAG, "Received: %s", message.substring(0, 100).c_str());
            parseStatusUpdate(message);
            break;
        }
            
        case WStype_ERROR:
            ESP_LOGE(TAG, "WebSocket error");
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
    
    ESP_LOGI(TAG, "Subscribed to status events");
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
        if (params["Status"].is<JsonObject>()) {
            JsonObject status = params["Status"];
            
            if (status["Audio"].is<JsonObject>()) {
                JsonObject audio = status["Audio"];
                if (audio["Microphones"]["Mute"].is<String>()) {
                    String mute = audio["Microphones"]["Mute"].as<String>();
                    current_state.mic_muted = (mute == "On");
                    update_pending = true;
                }
            }
            
            if (status["Video"].is<JsonObject>()) {
                JsonObject video = status["Video"];
                if (video["Input"]["MainVideoSource"].is<String>()) {
                    String source = video["Input"]["MainVideoSource"].as<String>();
                    current_state.camera_on = !source.isEmpty() && source != "None";
                    update_pending = true;
                }
            }
            
            if (status["Call"].is<JsonArray>()) {
                // Check if there's an active call
                JsonArray calls = status["Call"].as<JsonArray>();
                current_state.in_call = (calls.size() > 0);
                update_pending = true;
            }
        }
    }
    
    if (update_pending) {
        current_state.valid = true;
        ESP_LOGI(TAG, "Status update: Camera=%s, Mic=%s, InCall=%s",
                      current_state.camera_on ? "On" : "Off",
                      current_state.mic_muted ? "Muted" : "Unmuted",
                      current_state.in_call ? "Yes" : "No");
    }
}
