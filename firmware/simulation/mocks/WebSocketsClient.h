/**
 * @file WebSocketsClient.h
 * @brief Mock WebSocket client for native simulation
 */

#ifndef WEBSOCKETSCLIENT_H
#define WEBSOCKETSCLIENT_H

#include "Arduino.h"
#include <functional>

typedef enum {
    WStype_ERROR,
    WStype_DISCONNECTED,
    WStype_CONNECTED,
    WStype_TEXT,
    WStype_BIN,
    WStype_PING,
    WStype_PONG,
    WStype_FRAGMENT_TEXT_START,
    WStype_FRAGMENT_BIN_START,
    WStype_FRAGMENT
} WStype_t;

typedef std::function<void(WStype_t type, uint8_t* payload, size_t length)> WebSocketClientEvent;

class WebSocketsClient {
public:
    WebSocketsClient() : _connected(false) {}
    
    void begin(const char* host, uint16_t port, const char* url = "/") {
        _host = host;
        _port = port;
        _url = url;
        printf("[WebSocket] Initialized: ws://%s:%d%s\n", host, port, url);
    }
    
    void beginSSL(const char* host, uint16_t port, const char* url = "/") {
        _host = host;
        _port = port;
        _url = url;
        printf("[WebSocket] Initialized: wss://%s:%d%s\n", host, port, url);
    }
    
    void beginSocketIO(const char* host, uint16_t port, const char* url = "/socket.io/?EIO=4") {
        begin(host, port, url);
    }
    
    void beginSocketIOSSL(const char* host, uint16_t port, const char* url = "/socket.io/?EIO=4") {
        beginSSL(host, port, url);
    }
    
    void onEvent(WebSocketClientEvent callback) {
        _eventCallback = callback;
        printf("[WebSocket] Event callback registered\n");
    }
    
    void loop() {
        // In real simulation, would check for events
    }
    
    bool isConnected() {
        return _connected;
    }
    
    void disconnect() {
        if (_connected) {
            _connected = false;
            printf("[WebSocket] Disconnected\n");
            if (_eventCallback) {
                _eventCallback(WStype_DISCONNECTED, nullptr, 0);
            }
        }
    }
    
    bool sendTXT(const char* payload) {
        printf("[WebSocket] Sending text: %s\n", payload);
        return _connected;
    }
    
    bool sendTXT(const String& payload) {
        return sendTXT(payload.c_str());
    }
    
    bool sendTXT(uint8_t* payload, size_t length) {
        printf("[WebSocket] Sending %zu bytes\n", length);
        return _connected;
    }
    
    bool sendBIN(uint8_t* payload, size_t length) {
        printf("[WebSocket] Sending binary: %zu bytes\n", length);
        return _connected;
    }
    
    bool sendPing() {
        printf("[WebSocket] Sending ping\n");
        return _connected;
    }
    
    void setReconnectInterval(unsigned long interval) {
        _reconnectInterval = interval;
    }
    
    void enableHeartbeat(uint32_t pingInterval, uint32_t pongTimeout, uint8_t disconnectTimeoutCount) {
        printf("[WebSocket] Heartbeat enabled: ping=%u, timeout=%u\n", pingInterval, pongTimeout);
    }
    
    void setAuthorization(const char* user, const char* password) {
        printf("[WebSocket] Authorization set for user: %s\n", user);
    }
    
    void setAuthorization(const char* auth) {
        printf("[WebSocket] Authorization header set\n");
    }
    
    void setExtraHeaders(const char* headers) {
        printf("[WebSocket] Extra headers set\n");
    }
    
    // For testing: simulate connection
    void simulateConnect() {
        _connected = true;
        printf("[WebSocket] Simulated connection\n");
        if (_eventCallback) {
            _eventCallback(WStype_CONNECTED, nullptr, 0);
        }
    }
    
    // For testing: simulate receiving a message
    void simulateMessage(const char* message) {
        if (_connected && _eventCallback) {
            printf("[WebSocket] Simulated message received: %s\n", message);
            _eventCallback(WStype_TEXT, 
                          reinterpret_cast<uint8_t*>(const_cast<char*>(message)), 
                          strlen(message));
        }
    }

private:
    bool _connected;
    String _host;
    uint16_t _port;
    String _url;
    WebSocketClientEvent _eventCallback;
    unsigned long _reconnectInterval = 5000;
};

#endif // WEBSOCKETSCLIENT_H
