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
 * @brief Bridge Command structure
 */
struct BridgeCommand {
    String command;
    String requestId;
    String payload;  // JSON payload as string
    bool valid;
};

// Command handler callback type
typedef void (*BridgeCommandHandler)(const BridgeCommand& cmd);

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
    
    /**
     * @brief Set command handler callback
     * @param handler Function to call when command received
     */
    void setCommandHandler(BridgeCommandHandler handler) { command_handler = handler; }
    
    /**
     * @brief Check if there's a pending command
     * @return true if command available
     */
    bool hasCommand() const { return command_pending; }
    
    /**
     * @brief Get the latest command
     * @return BridgeCommand structure
     */
    BridgeCommand getCommand();
    
    /**
     * @brief Send command response back to app
     * @param requestId Request ID from the command
     * @param success Whether command succeeded
     * @param data Response data (JSON object as string)
     * @param error Error message if failed
     */
    void sendCommandResponse(const String& requestId, bool success, 
                            const String& data = "", const String& error = "");
    
    /**
     * @brief Send current config to app
     * @param config JSON config object as string
     */
    void sendConfig(const String& config);
    
    /**
     * @brief Send current status to app
     * @param status JSON status object as string
     */
    void sendStatus(const String& status);

private:
    WebSocketsClient ws_client;
    String bridge_host;
    uint16_t bridge_port;
    String pairing_code;
    bool connected;
    bool joined_room;
    bool peer_connected;
    bool update_pending;
    bool command_pending;
    BridgeUpdate last_update;
    BridgeCommand last_command;
    BridgeCommandHandler command_handler;
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
