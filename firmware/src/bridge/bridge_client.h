/**
 * @file bridge_client.h
 * @brief Bridge WebSocket Client Header
 * 
 * Supports two modes:
 * 1. Legacy mode: Direct presence subscription (original behavior)
 * 2. Pairing mode: Join a pairing room to receive status from embedded app
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
    bool camera_on;
    bool mic_muted;
    bool in_call;
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
     * @brief Initialize and connect to bridge (legacy mode)
     * @param host Bridge server hostname or IP
     * @param port Bridge server port
     */
    void begin(const String& host, uint16_t port);
    
    /**
     * @brief Initialize and connect to bridge with pairing code
     * @param host Bridge server hostname or IP
     * @param port Bridge server port
     * @param pairing_code 6-character pairing code
     */
    void beginWithPairing(const String& host, uint16_t port, const String& pairing_code);
    
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
     * @brief Check if joined to pairing room
     * @return true if joined
     */
    bool isJoined() const { return joined_room; }
    
    /**
     * @brief Check if peer (app) is connected
     * @return true if app is connected
     */
    bool isPeerConnected() const { return peer_connected; }
    
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
    
    /**
     * @brief Set pairing code for connection
     * @param code Pairing code
     */
    void setPairingCode(const String& code);
    
    /**
     * @brief Get current pairing code
     * @return Pairing code
     */
    String getPairingCode() const { return pairing_code; }
    
    /**
     * @brief Check if using pairing mode
     * @return true if pairing mode enabled
     */
    bool isPairingMode() const { return !pairing_code.isEmpty(); }

private:
    WebSocketsClient ws_client;
    String bridge_host;
    uint16_t bridge_port;
    String pairing_code;
    bool connected;
    bool joined_room;
    bool peer_connected;
    bool update_pending;
    BridgeUpdate last_update;
    unsigned long last_reconnect;
    
    void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
    void parseMessage(const String& message);
    void sendSubscribe();
    void sendJoinRoom();
    void sendPing();
    static void webSocketCallback(WStype_t type, uint8_t* payload, size_t length);
};

// Global instance pointer for callback
extern BridgeClient* g_bridge_instance;

#endif // BRIDGE_CLIENT_H
