/**
 * @file bridge_client.cpp
 * @brief Bridge WebSocket Client Implementation
 */

#include "bridge_client.h"
#include <ArduinoJson.h>
#include <WiFi.h>

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
#endif

// Global instance for callback
BridgeClient* g_bridge_instance = nullptr;

BridgeClient::BridgeClient()
    : bridge_port(8080), connected(false), joined_room(false), 
      peer_connected(false), update_pending(false), command_pending(false),
      use_ssl(false), command_handler(nullptr), last_reconnect(0) {
    last_update.valid = false;
    last_update.camera_on = false;
    last_update.mic_muted = false;
    last_update.in_call = false;
    last_command.valid = false;
}

BridgeClient::~BridgeClient() {
    disconnect();
}

void BridgeClient::begin(const String& host, uint16_t port) {
    bridge_host = host;
    bridge_port = port;
    pairing_code = "";  // No pairing code = legacy mode
    g_bridge_instance = this;
    
    Serial.printf("[BRIDGE] Connecting to %s:%d (legacy mode)\n", host.c_str(), port);
    
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

void BridgeClient::beginWithPairing(const String& host, uint16_t port, const String& code) {
    bridge_host = host;
    bridge_port = port;
    pairing_code = code;
    pairing_code.toUpperCase();
    use_ssl = false;
    g_bridge_instance = this;
    
    Serial.printf("[BRIDGE] Connecting to %s:%d with pairing code: %s\n", 
                  host.c_str(), port, pairing_code.c_str());
    
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

void BridgeClient::beginWithUrl(const String& url, const String& code) {
    String host;
    uint16_t port;
    bool ssl;
    
    if (!parseUrl(url, host, port, ssl)) {
        Serial.printf("[BRIDGE] Failed to parse URL: %s\n", url.c_str());
        return;
    }
    
    bridge_host = host;
    bridge_port = port;
    pairing_code = code;
    pairing_code.toUpperCase();
    use_ssl = ssl;
    g_bridge_instance = this;
    
    Serial.printf("[BRIDGE] Connecting to %s:%d (SSL=%d) with pairing code: %s\n", 
                  host.c_str(), port, ssl, pairing_code.c_str());
    
    // Set up WebSocket event handler
    ws_client.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_bridge_instance) {
            g_bridge_instance->onWebSocketEvent(type, payload, length);
        }
    });
    
    // Connect to bridge server (SSL or plain)
    if (use_ssl) {
        // For SSL, we need to disable certificate verification
        // since ESP32 doesn't have the CA bundle for Let's Encrypt etc.
        ws_client.beginSSL(bridge_host, bridge_port, "/");
        ws_client.enableHeartbeat(15000, 3000, 2);  // Keep connection alive
    } else {
        ws_client.begin(bridge_host, bridge_port, "/");
    }
    ws_client.setReconnectInterval(5000);
}

bool BridgeClient::parseUrl(const String& url, String& host, uint16_t& port, bool& ssl) {
    String working = url;
    
    // Determine protocol
    if (working.startsWith("wss://")) {
        ssl = true;
        working = working.substring(6);  // Remove "wss://"
    } else if (working.startsWith("ws://")) {
        ssl = false;
        working = working.substring(5);  // Remove "ws://"
    } else {
        // No protocol - assume non-SSL
        ssl = false;
    }
    
    // Remove trailing slash and path
    int pathIdx = working.indexOf('/');
    if (pathIdx > 0) {
        working = working.substring(0, pathIdx);
    }
    
    // Check for port
    int colonIdx = working.indexOf(':');
    if (colonIdx > 0) {
        host = working.substring(0, colonIdx);
        port = working.substring(colonIdx + 1).toInt();
    } else {
        host = working;
        port = ssl ? 443 : 80;  // Default ports
    }
    
    // Validate
    if (host.isEmpty() || port == 0) {
        return false;
    }
    
    return true;
}

void BridgeClient::setPairingCode(const String& code) {
    pairing_code = code;
    pairing_code.toUpperCase();
    
    // If already connected, send join message
    if (connected && !pairing_code.isEmpty()) {
        sendJoinRoom();
    }
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

BridgeCommand BridgeClient::getCommand() {
    command_pending = false;
    return last_command;
}

void BridgeClient::sendCommandResponse(const String& requestId, bool success, 
                                       const String& data, const String& error) {
    if (!connected) {
        return;
    }
    
    JsonDocument doc;
    doc["type"] = "command_response";
    doc["requestId"] = requestId;
    doc["success"] = success;
    
    if (!data.isEmpty()) {
        // Parse data string as JSON and add to response
        JsonDocument dataDoc;
        DeserializationError err = deserializeJson(dataDoc, data);
        if (!err) {
            doc["data"] = dataDoc;
        }
    }
    
    if (!error.isEmpty()) {
        doc["error"] = error;
    }
    
    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
    
    Serial.printf("[BRIDGE] Sent command response for %s (success=%d)\n", 
                  requestId.c_str(), success);
}

void BridgeClient::sendConfig(const String& config) {
    if (!connected) {
        return;
    }
    
    JsonDocument doc;
    doc["type"] = "config";
    
    // Parse config string and merge into response
    JsonDocument configDoc;
    DeserializationError err = deserializeJson(configDoc, config);
    if (!err) {
        doc["data"] = configDoc;
    }
    
    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
    
    Serial.println("[BRIDGE] Sent config to app");
}

void BridgeClient::sendStatus(const String& status) {
    if (!connected) {
        return;
    }
    
    JsonDocument doc;
    doc["type"] = "status";
    
    // Parse status string and merge into response
    JsonDocument statusDoc;
    DeserializationError err = deserializeJson(statusDoc, status);
    if (!err) {
        doc["data"] = statusDoc;
    }
    
    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
    
    Serial.println("[BRIDGE] Sent status to app");
}

void BridgeClient::disconnect() {
    ws_client.disconnect();
    connected = false;
    joined_room = false;
    peer_connected = false;
}

void BridgeClient::reconnect() {
    if (millis() - last_reconnect < 5000) {
        return;
    }
    
    last_reconnect = millis();
    
    if (bridge_host.isEmpty()) {
        Serial.println("[BRIDGE] Cannot reconnect - no host configured");
        return;
    }
    
    Serial.printf("[BRIDGE] Attempting to reconnect to %s://%s:%d...\n",
                  use_ssl ? "wss" : "ws", bridge_host.c_str(), bridge_port);
    
    if (use_ssl) {
        ws_client.beginSSL(bridge_host, bridge_port, "/");
    } else {
        ws_client.begin(bridge_host, bridge_port, "/");
    }
}

void BridgeClient::setServer(const String& host, uint16_t port) {
    if (host != bridge_host || port != bridge_port) {
        disconnect();
        bridge_host = host;
        bridge_port = port;
        
        if (!pairing_code.isEmpty()) {
            beginWithPairing(host, port, pairing_code);
        } else {
            begin(host, port);
        }
    }
}

void BridgeClient::onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("[BRIDGE] WebSocket disconnected");
            connected = false;
            joined_room = false;
            peer_connected = false;
            break;
            
        case WStype_CONNECTED:
            Serial.printf("[BRIDGE] Connected to %s\n", bridge_host.c_str());
            connected = true;
            
            // Send appropriate initial message based on mode
            if (!pairing_code.isEmpty()) {
                sendJoinRoom();
            } else {
                sendSubscribe();
            }
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
            Serial.printf("[BRIDGE] WebSocket error (len=%d)\n", length);
            if (payload && length > 0) {
                Serial.printf("[BRIDGE] Error details: %.*s\n", length, payload);
            }
            connected = false;
            joined_room = false;
            break;
            
        case WStype_FRAGMENT_TEXT_START:
        case WStype_FRAGMENT_BIN_START:
        case WStype_FRAGMENT:
        case WStype_FRAGMENT_FIN:
            Serial.println("[BRIDGE] Fragment received");
            break;
            
        case WStype_BIN:
            Serial.printf("[BRIDGE] Binary data received (%d bytes)\n", length);
            break;
            
        default:
            Serial.printf("[BRIDGE] Unknown event type: %d\n", type);
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
    
    if (type == "status") {
        // Status update from embedded app (pairing mode)
        last_update.status = doc["status"].as<String>();
        last_update.display_name = doc["display_name"].as<String>();
        last_update.camera_on = doc["camera_on"] | false;
        last_update.mic_muted = doc["mic_muted"] | false;
        last_update.in_call = doc["in_call"] | false;
        last_update.timestamp = millis();
        last_update.valid = true;
        update_pending = true;
        
        Serial.printf("[BRIDGE] Status from app: %s (in_call=%d, camera=%d, mic_muted=%d)\n", 
                      last_update.status.c_str(), 
                      last_update.in_call,
                      last_update.camera_on,
                      last_update.mic_muted);
                      
    } else if (type == "joined") {
        // Successfully joined pairing room
        JsonObject data = doc["data"];
        joined_room = true;
        peer_connected = data["appConnected"] | false;
        
        Serial.printf("[BRIDGE] Joined room: %s (app connected: %d)\n", 
                      data["code"].as<const char*>(),
                      peer_connected);
                      
    } else if (type == "peer_connected") {
        // App connected to our room
        peer_connected = true;
        Serial.println("[BRIDGE] Peer (app) connected");
        
    } else if (type == "peer_disconnected") {
        // App disconnected from our room
        peer_connected = false;
        Serial.println("[BRIDGE] Peer (app) disconnected");
        
    } else if (type == "presence") {
        // Legacy: Presence update from bridge
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
                      
    } else if (type == "command") {
        // Command from app via bridge
        last_command.command = doc["command"].as<String>();
        last_command.requestId = doc["requestId"].as<String>();
        
        // Serialize payload back to string for handler
        JsonObject payload = doc["payload"];
        if (!payload.isNull()) {
            serializeJson(payload, last_command.payload);
        } else {
            last_command.payload = "{}";
        }
        
        last_command.valid = true;
        command_pending = true;
        
        Serial.printf("[BRIDGE] Command received: %s (id=%s)\n", 
                      last_command.command.c_str(), 
                      last_command.requestId.c_str());
        
        // Call handler if set
        if (command_handler) {
            command_handler(last_command);
        }
        
    } else if (type == "get_config") {
        // App requesting config - handled in main.cpp
        Serial.println("[BRIDGE] Config request received");
        last_command.command = "get_config";
        last_command.requestId = doc["requestId"].as<String>();
        last_command.payload = "{}";
        last_command.valid = true;
        command_pending = true;
        
        if (command_handler) {
            command_handler(last_command);
        }
        
    } else if (type == "get_status") {
        // App requesting status
        Serial.println("[BRIDGE] Status request received");
        last_command.command = "get_status";
        last_command.requestId = doc["requestId"].as<String>();
        last_command.payload = "{}";
        last_command.valid = true;
        command_pending = true;
        
        if (command_handler) {
            command_handler(last_command);
        }
        
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

void BridgeClient::sendJoinRoom() {
    if (pairing_code.isEmpty()) {
        Serial.println("[BRIDGE] No pairing code set, cannot join room");
        return;
    }
    
    JsonDocument doc;
    doc["type"] = "join";
    doc["code"] = pairing_code;
    doc["clientType"] = "display";
    
    // Include device info for registration
    doc["deviceId"] = "webex-display-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    doc["firmware_version"] = FIRMWARE_VERSION;
    
    // Get IP address if available
    if (WiFi.isConnected()) {
        doc["ip_address"] = WiFi.localIP().toString();
    }
    
    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
    
    Serial.printf("[BRIDGE] Sent join message for room: %s\n", pairing_code.c_str());
}

void BridgeClient::sendPing() {
    JsonDocument doc;
    doc["type"] = "ping";
    
    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
}
