/**
 * @file bridge_client.cpp
 * @brief Bridge WebSocket Client Implementation
 *
 * Uses Links2004 WebSockets library with SSL certificate bundle
 * for reliable connections to Cloudflare-proxied servers.
 */

#include "bridge_client.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <time.h>
#include "../common/ca_certs.h"
#include "../common/ws_client_compat.h"
#include "../config/config_manager.h"
#include "../debug.h"
#include "../auth/device_credentials.h"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
#endif

// Global instance for callback
BridgeClient* g_bridge_instance = nullptr;
extern ConfigManager config_manager;

BridgeClient::BridgeClient()
    : bridge_port(8080), connected(false), joined_room(false),
      peer_connected(false), update_pending(false), command_pending(false),
      use_ssl(false), command_handler(nullptr), last_reconnect(0) {
    ws_path = "/";
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
    use_ssl = false;
    ws_path = "/";
    g_bridge_instance = this;

    Serial.printf("[BRIDGE] Connecting to %s:%d (legacy mode)\n", host.c_str(), port);

    // Set up WebSocket event handler
    ws_client.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_bridge_instance) {
            g_bridge_instance->onWebSocketEvent(type, payload, length);
        }
    });

    // Connect to bridge server
    ws_client.begin(bridge_host, bridge_port, ws_path);
    ws_client.setReconnectInterval(5000);
}

void BridgeClient::beginWithPairing(const String& host, uint16_t port, const String& code) {
    bridge_host = host;
    bridge_port = port;
    pairing_code = code;
    pairing_code.toUpperCase();
    use_ssl = false;
    ws_path = "/";
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
    ws_client.begin(bridge_host, bridge_port, ws_path);
    ws_client.setReconnectInterval(5000);
}

void BridgeClient::beginWithUrl(const String& url, const String& code) {
    String host;
    uint16_t port;
    bool ssl;
    String path;

    if (!parseUrl(url, host, port, ssl, path)) {
        Serial.printf("[BRIDGE] Failed to parse URL: %s\n", url.c_str());
        return;
    }

    bridge_host = host;
    bridge_port = port;
    pairing_code = code;
    pairing_code.toUpperCase();
    use_ssl = ssl;
    ws_path = path.isEmpty() ? "/" : path;
    g_bridge_instance = this;

    Serial.printf("[BRIDGE] Connecting to %s://%s:%d%s with pairing code: %s\n",
                  ssl ? "wss" : "ws", host.c_str(), port, ws_path.c_str(), pairing_code.c_str());

    // Set up WebSocket event handler
    ws_client.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_bridge_instance) {
            g_bridge_instance->onWebSocketEvent(type, payload, length);
        }
    });

    // Connect to bridge server (SSL or plain)
    if (use_ssl) {
        Serial.println("[BRIDGE] Using SSL with DigiCert CA certificates");
        Serial.printf("[BRIDGE] Host: %s, Port: %d, Path: %s\n",
                      bridge_host.c_str(), bridge_port, ws_path.c_str());

        // Use DigiCert Global Root G2 for bridge.5ls.us (Cloudflared tunnel)
        if (config_manager.getTlsVerify()) {
            ws_client.beginSSL(bridge_host.c_str(), bridge_port, ws_path.c_str(),
                               CA_CERT_DIGICERT_GLOBAL_G2);
        } else {
            wsSetInsecure(ws_client, 0);
            ws_client.beginSSL(bridge_host.c_str(), bridge_port, ws_path.c_str(), nullptr);
        }
        ws_client.enableHeartbeat(15000, 3000, 2);  // Keep connection alive
    } else {
        ws_client.begin(bridge_host, bridge_port, ws_path);
    }
    ws_client.setReconnectInterval(10000);  // Let library handle reconnects
}

bool BridgeClient::parseUrl(const String& url, String& host, uint16_t& port, bool& ssl, String& path) {
    DEBUG_LOG("BRIDGE", "Parsing URL: %s", url.c_str());
    String working = url;

    // Determine protocol
    if (working.startsWith("wss://")) {
        ssl = true;
        working = working.substring(6);  // Remove "wss://"
        DEBUG_LOG("BRIDGE", "Protocol: wss (SSL)");
    } else if (working.startsWith("ws://")) {
        ssl = false;
        working = working.substring(5);  // Remove "ws://"
        DEBUG_LOG("BRIDGE", "Protocol: ws (plain)");
    } else {
        // No protocol - assume non-SSL
        ssl = false;
        DEBUG_LOG("BRIDGE", "No protocol prefix, assuming ws://");
    }

    // Split host[:port] and path
    int pathIdx = working.indexOf('/');
    if (pathIdx >= 0) {
        path = working.substring(pathIdx);
        working = working.substring(0, pathIdx);
    } else {
        path = "/";
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

    DEBUG_LOG("BRIDGE", "Parsed: host=%s port=%d ssl=%d path=%s",
              host.c_str(), port, ssl, path.c_str());

    // Validate
    if (host.isEmpty() || port == 0) {
        DEBUG_LOG("BRIDGE", "URL parse failed: host empty or port 0");
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
    // Only attempt reconnect every 30 seconds to reduce spam
    if (millis() - last_reconnect < 30000) {
        return;
    }

    last_reconnect = millis();

    if (bridge_host.isEmpty()) {
        Serial.println("[BRIDGE] Cannot reconnect - no host configured");
        return;
    }

    // Check if time is synced (required for SSL certificate validation)
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
        Serial.println("[BRIDGE] Warning: System time not synced - SSL may fail");
        return;  // Don't attempt reconnect without valid time for SSL
    }

    Serial.printf("[BRIDGE] Attempting manual reconnect to %s:%d (System time: %02d:%02d:%02d)\n",
                  bridge_host.c_str(), bridge_port,
                  timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);

    // Force disconnect to reset state
    ws_client.disconnect();
    connected = false;
    joined_room = false;
    peer_connected = false;

    // Small delay to allow cleanup
    delay(500);

    // Re-register event handler (in case it was lost)
    ws_client.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_bridge_instance) {
            g_bridge_instance->onWebSocketEvent(type, payload, length);
        }
    });

    // Reinitialize connection with saved parameters
    if (use_ssl) {
        Serial.printf("[BRIDGE] Reconnecting with SSL to %s:%d%s\n",
                      bridge_host.c_str(), bridge_port, ws_path.c_str());
        if (config_manager.getTlsVerify()) {
            ws_client.beginSSL(bridge_host.c_str(), bridge_port, ws_path.c_str(),
                               CA_CERT_DIGICERT_GLOBAL_G2);
        } else {
            wsSetInsecure(ws_client, 0);
            ws_client.beginSSL(bridge_host.c_str(), bridge_port, ws_path.c_str(), nullptr);
        }
        ws_client.enableHeartbeat(15000, 3000, 2);
    } else {
        Serial.printf("[BRIDGE] Reconnecting to %s:%d%s\n",
                      bridge_host.c_str(), bridge_port, ws_path.c_str());
        ws_client.begin(bridge_host, bridge_port, ws_path);
    }
    ws_client.setReconnectInterval(10000);

    Serial.println("[BRIDGE] Manual reconnect initiated");
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
    DEBUG_LOG("BRIDGE", "WS Event: type=%d len=%zu", type, length);

    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("[BRIDGE] ✗ WebSocket disconnected");
            if (connected || joined_room) {
                Serial.printf("[BRIDGE] Connection lost (was connected=%d, joined=%d)\n",
                              connected, joined_room);
            }
            DEBUG_LOG("BRIDGE", "Disconnected - was connected=%d joined=%d", connected, joined_room);
            connected = false;
            joined_room = false;
            peer_connected = false;
            Serial.println("[BRIDGE] Waiting for auto-reconnect (10s interval)...");
            break;

        case WStype_CONNECTED:
            Serial.printf("[BRIDGE] ✓ WebSocket connected to %s\n", bridge_host.c_str());
            DEBUG_LOG("BRIDGE", "Connected successfully to %s:%d", bridge_host.c_str(), bridge_port);
            connected = true;

            // Reset join state on new connection
            joined_room = false;
            peer_connected = false;

            // Send appropriate initial message based on mode
            if (!pairing_code.isEmpty()) {
                DEBUG_LOG("BRIDGE", "Sending join room for code: %s", pairing_code.c_str());
                Serial.printf("[BRIDGE] Joining room with pairing code: %s\n", pairing_code.c_str());
                sendJoinRoom();
            } else {
                DEBUG_LOG("BRIDGE", "Sending subscribe (legacy mode)");
                Serial.println("[BRIDGE] Subscribing in legacy mode");
                sendSubscribe();
            }
            break;

        case WStype_TEXT: {
            String message = String((char*)payload, length);
            DEBUG_LOG("BRIDGE", "Received: %s", message.c_str());
            parseMessage(message);
            break;
        }

        case WStype_PING:
            DEBUG_LOG("BRIDGE", "Ping received");
            // Library handles pong automatically
            break;

        case WStype_PONG:
            DEBUG_LOG("BRIDGE", "Pong received");
            // Response to our ping
            break;

        case WStype_ERROR:
            Serial.printf("[BRIDGE] WebSocket error (len=%zu)\n", length);
            if (payload && length > 0) {
                Serial.printf("[BRIDGE] Error details: %.*s\n", (int)length, payload);
                // Check for SSL certificate errors
                String error_str = String((char*)payload, length);
                if (error_str.indexOf("certificate") >= 0 || error_str.indexOf("SSL") >= 0 ||
                    error_str.indexOf("ssl") >= 0 || error_str.indexOf("TLS") >= 0) {
                    Serial.println("[BRIDGE] ⚠️  SSL/Certificate error detected!");
                    Serial.println("[BRIDGE] Hint: Check CA certificate configuration");
                }
            } else {
                Serial.println("[BRIDGE] Error with no details - possible SSL handshake failure");
                Serial.println("[BRIDGE] Hint: Verify time is synced and CA certificates are loaded");
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
            Serial.printf("[BRIDGE] Binary data received (%zu bytes)\n", length);
            break;

        default:
            Serial.printf("[BRIDGE] Unknown event type: %d\n", type);
            break;
    }
}

void BridgeClient::parseMessage(const String& message) {
    DEBUG_LOG("BRIDGE", "Parsing message: %s", message.c_str());

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, message);

    if (error) {
        Serial.printf("[BRIDGE] Failed to parse message: %s\n", error.c_str());
        DEBUG_LOG("BRIDGE", "JSON parse error: %s", error.c_str());
        return;
    }

    String type = doc["type"].as<String>();
    DEBUG_LOG("BRIDGE", "Message type: %s", type.c_str());

    if (type == "status") {
        // Status update from embedded app (pairing mode)
        // If we receive a status, the peer must be connected
        if (!peer_connected) {
            peer_connected = true;
            Serial.println("[BRIDGE] Peer (app) connected (inferred from status)");
        }

        last_update.status = doc["status"].as<String>();
        last_update.display_name = doc["display_name"].as<String>();
        last_update.camera_on = doc["camera_on"] | false;
        last_update.mic_muted = doc["mic_muted"] | false;
        last_update.in_call = doc["in_call"] | false;
        last_update.timestamp = millis();
        last_update.valid = true;
        update_pending = true;
        DEBUG_LOG("BRIDGE", "Status parsed: status=%s camera=%d mic=%d call=%d name=%s",
                  last_update.status.c_str(), last_update.camera_on,
                  last_update.mic_muted, last_update.in_call,
                  last_update.display_name.isEmpty() ? "(none)" : last_update.display_name.c_str());

        Serial.printf("[BRIDGE] Status from app: %s (in_call=%d, camera=%d, mic_muted=%d, name=%s)\n",
                      last_update.status.c_str(),
                      last_update.in_call,
                      last_update.camera_on,
                      last_update.mic_muted,
                      last_update.display_name.isEmpty() ? "(none)" : last_update.display_name.c_str());

    } else if (type == "joined") {
        // Successfully joined pairing room
        JsonObject data = doc["data"];
        joined_room = true;
        peer_connected = data["appConnected"] | false;

        String room_code = data["code"].as<String>();
        Serial.println("[BRIDGE] ═══════════════════════════════════════");
        Serial.printf("[BRIDGE] ✓ Joined room: %s\n", room_code.c_str());
        Serial.printf("[BRIDGE] ✓ App connected: %s\n", peer_connected ? "YES" : "NO");
        Serial.println("[BRIDGE] ═══════════════════════════════════════");
        DEBUG_LOG("BRIDGE", "Joined room %s, peer=%d", room_code.c_str(), peer_connected);

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

    // Use DeviceCredentials for consistent device identity
    if (deviceCredentials.isProvisioned()) {
        doc["deviceId"] = deviceCredentials.getDeviceId();
        doc["serial"] = deviceCredentials.getSerialNumber();

        // Include HMAC authentication
        uint32_t timestamp = DeviceCredentials::getTimestamp();
        String signature = deviceCredentials.signRequest(timestamp, "");

        doc["auth"]["timestamp"] = timestamp;
        doc["auth"]["signature"] = signature;
    } else {
        doc["deviceId"] = "webex-display-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    }

    String message;
    serializeJson(doc, message);
    DEBUG_LOG("BRIDGE", "Sending: %s", message.c_str());
    ws_client.sendTXT(message);

    Serial.println("[BRIDGE] Sent subscribe message");
}

void BridgeClient::sendJoinRoom() {
    if (pairing_code.isEmpty()) {
        Serial.println("[BRIDGE] No pairing code set, cannot join room");
        DEBUG_LOG("BRIDGE", "sendJoinRoom called but pairing_code is empty");
        return;
    }

    JsonDocument doc;
    doc["type"] = "join";
    doc["code"] = pairing_code;
    doc["clientType"] = "display";

    // Use DeviceCredentials for consistent device identity
    if (deviceCredentials.isProvisioned()) {
        doc["deviceId"] = deviceCredentials.getDeviceId();
        doc["serial"] = deviceCredentials.getSerialNumber();

        // Include HMAC authentication for secure bridge communication
        uint32_t timestamp = DeviceCredentials::getTimestamp();
        String signature = deviceCredentials.signRequest(timestamp, "");

        doc["auth"]["timestamp"] = timestamp;
        doc["auth"]["signature"] = signature;
    } else {
        // Fallback to legacy device ID if credentials not ready
        doc["deviceId"] = "webex-display-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    }

    doc["firmware_version"] = FIRMWARE_VERSION;

    // Get IP address if available
    if (WiFi.isConnected()) {
        doc["ip_address"] = WiFi.localIP().toString();
    }

    String message;
    serializeJson(doc, message);
    DEBUG_LOG("BRIDGE", "Sending: %s", message.c_str());
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

void BridgeClient::sendDebugLog(const String& level, const String& logMessage, const String& metadata) {
    if (!connected) {
        return;
    }

    JsonDocument doc;
    doc["type"] = "debug_log";
    doc["level"] = level;
    doc["log_message"] = logMessage;

    // Parse metadata if provided
    if (!metadata.isEmpty()) {
        JsonDocument metaDoc;
        DeserializationError err = deserializeJson(metaDoc, metadata);
        if (!err) {
            doc["log_metadata"] = metaDoc;
        }
    }

    String message;
    serializeJson(doc, message);
    ws_client.sendTXT(message);
}
