/**
 * @file bridge_client.cpp
 * @brief Bridge WebSocket Client Implementation
 */

#include "bridge_client.h"
#include <ArduinoJson.h>

// Global instance for callback
BridgeClient* g_bridge_instance = nullptr;

BridgeClient::BridgeClient()
    : bridge_port(8080), connected(false), update_pending(false), last_reconnect(0) {
    last_update.valid = false;
}

BridgeClient::~BridgeClient() {
    disconnect();
}

void BridgeClient::begin(const String& host, uint16_t port) {
    bridge_host = host;
    bridge_port = port;
    g_bridge_instance = this;
    
    Serial.printf("[BRIDGE] Connecting to %s:%d\n", host.c_str(), port);
    
    // Set up WebSocket event handler
    ws_client.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_bridge_instance) {
            g_bridge_instance->onWebSocketEvent(type, payload, length);
        }
    });
    
    // Connect to bridge server
    ws_client.begin(bridge_host, bridge_port, "/");
    ws_client.setReconnectInterval(5000);
}

void BridgeClient::loop() {
    ws_client.loop();
    
    // Send periodic ping to keep connection alive
    static unsigned long last_ping = 0;
    if (connected && millis() - last_ping > 30000) {
        last_ping = millis();
        sendPing();
    }
}

BridgeUpdate BridgeClient::getUpdate() {
    update_pending = false;
    return last_update;
}

void BridgeClient::disconnect() {
    ws_client.disconnect();
    connected = false;
}

void BridgeClient::reconnect() {
    if (millis() - last_reconnect < 5000) {
        return;
    }
    
    last_reconnect = millis();
    Serial.println("[BRIDGE] Attempting to reconnect...");
    
    ws_client.begin(bridge_host, bridge_port, "/");
}

void BridgeClient::setServer(const String& host, uint16_t port) {
    if (host != bridge_host || port != bridge_port) {
        disconnect();
        bridge_host = host;
        bridge_port = port;
        begin(host, port);
    }
}

void BridgeClient::onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("[BRIDGE] WebSocket disconnected");
            connected = false;
            break;
            
        case WStype_CONNECTED:
            Serial.printf("[BRIDGE] Connected to %s\n", bridge_host.c_str());
            connected = true;
            sendSubscribe();
            break;
            
        case WStype_TEXT: {
            String message = String((char*)payload);
            parseMessage(message);
            break;
        }
            
        case WStype_PING:
            // Library handles pong automatically
            break;
            
        case WStype_PONG:
            // Response to our ping
            break;
            
        case WStype_ERROR:
            Serial.println("[BRIDGE] WebSocket error");
            connected = false;
            break;
            
        default:
            break;
    }
}

void BridgeClient::parseMessage(const String& message) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, message);
    
    if (error) {
        Serial.printf("[BRIDGE] Failed to parse message: %s\n", error.c_str());
        return;
    }
    
    String type = doc["type"].as<String>();
    
    if (type == "presence") {
        // Presence update from bridge
        JsonObject data = doc["data"];
        
        last_update.status = data["status"].as<String>();
        last_update.display_name = data["displayName"].as<String>();
        last_update.last_activity = data["lastActivity"].as<String>();
        last_update.timestamp = millis();
        last_update.valid = true;
        update_pending = true;
        
        Serial.printf("[BRIDGE] Presence update: %s\n", last_update.status.c_str());
        
    } else if (type == "connection") {
        // Connection status from bridge
        JsonObject data = doc["data"];
        String webex_status = data["webex"].as<String>();
        int clients = data["clients"] | 0;
        
        Serial.printf("[BRIDGE] Connection status - Webex: %s, Clients: %d\n", 
                      webex_status.c_str(), clients);
                      
    } else if (type == "error") {
        String error_msg = doc["message"].as<String>();
        Serial.printf("[BRIDGE] Error: %s\n", error_msg.c_str());
        
    } else if (type == "pong") {
        // Response to ping
    }
}

void BridgeClient::sendSubscribe() {
    JsonDocument doc;
    doc["type"] = "subscribe";
    doc["deviceId"] = "webex-display-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    
    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
    
    Serial.println("[BRIDGE] Sent subscribe message");
}

void BridgeClient::sendPing() {
    JsonDocument doc;
    doc["type"] = "ping";
    
    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
}
