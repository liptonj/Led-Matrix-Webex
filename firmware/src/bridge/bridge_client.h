/**
 * @file bridge_client.h
 * @brief Bridge WebSocket Client Header
 */

#ifndef BRIDGE_CLIENT_H
#define BRIDGE_CLIENT_H

#include <Arduino.h>
#include <WebSocketsClient.h>

/**
 * @brief Bridge Update structure
 */
struct BridgeUpdate {
    String status;
    String display_name;
    String last_activity;
    unsigned long timestamp;
    bool valid;
};

/**
 * @brief Bridge WebSocket Client Class
 * 
 * Connects to the Node.js bridge server for real-time presence updates.
 */
class BridgeClient {
public:
    BridgeClient();
    ~BridgeClient();
    
    /**
     * @brief Initialize and connect to bridge
     * @param host Bridge server hostname or IP
     * @param port Bridge server port
     */
    void begin(const String& host, uint16_t port);
    
    /**
     * @brief Process WebSocket events
     */
    void loop();
    
    /**
     * @brief Check if connected to bridge
     * @return true if connected
     */
    bool isConnected() const { return connected; }
    
    /**
     * @brief Check if there's a pending update
     * @return true if update available
     */
    bool hasUpdate() const { return update_pending; }
    
    /**
     * @brief Get the latest update
     * @return BridgeUpdate structure
     */
    BridgeUpdate getUpdate();
    
    /**
     * @brief Disconnect from bridge
     */
    void disconnect();
    
    /**
     * @brief Attempt to reconnect
     */
    void reconnect();
    
    /**
     * @brief Set bridge server address
     * @param host Bridge hostname
     * @param port Bridge port
     */
    void setServer(const String& host, uint16_t port);

private:
    WebSocketsClient ws_client;
    String bridge_host;
    uint16_t bridge_port;
    bool connected;
    bool update_pending;
    BridgeUpdate last_update;
    unsigned long last_reconnect;
    
    void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
    void parseMessage(const String& message);
    void sendSubscribe();
    void sendPing();
    static void webSocketCallback(WStype_t type, uint8_t* payload, size_t length);
};

// Global instance pointer for callback
extern BridgeClient* g_bridge_instance;

#endif // BRIDGE_CLIENT_H
