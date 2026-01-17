/**
 * @file xapi_websocket.h
 * @brief Webex xAPI WebSocket Client Header
 */

#ifndef XAPI_WEBSOCKET_H
#define XAPI_WEBSOCKET_H

#include <Arduino.h>
#include <WebSocketsClient.h>
#include "../config/config_manager.h"

// xAPI WebSocket endpoint
#define XAPI_WS_HOST "wdm-a.wbx2.com"
#define XAPI_WS_PORT 443
#define XAPI_WS_PATH "/device/websocket"

/**
 * @brief xAPI Update structure
 */
struct XAPIUpdate {
    bool camera_on;
    bool mic_muted;
    bool in_call;
    String call_status;
    bool valid;
};

/**
 * @brief xAPI WebSocket Client Class
 * 
 * Connects to RoomOS device for real-time status updates.
 */
class XAPIWebSocket {
public:
    XAPIWebSocket();
    ~XAPIWebSocket();
    
    /**
     * @brief Initialize the xAPI WebSocket client
     * @param config Pointer to configuration manager
     */
    void begin(ConfigManager* config);
    
    /**
     * @brief Process WebSocket events
     */
    void loop();
    
    /**
     * @brief Check if connected to device
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
     * @return XAPIUpdate structure
     */
    XAPIUpdate getUpdate();
    
    /**
     * @brief Disconnect from device
     */
    void disconnect();
    
    /**
     * @brief Reconnect to device
     */
    void reconnect();

private:
    WebSocketsClient ws_client;
    ConfigManager* config_manager;
    bool connected;
    bool update_pending;
    XAPIUpdate current_state;
    unsigned long last_reconnect;
    
    void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
    void subscribeToEvents();
    void parseStatusUpdate(const String& message);
    static void webSocketCallback(WStype_t type, uint8_t* payload, size_t length);
};

// Global instance pointer for callback
extern XAPIWebSocket* g_xapi_instance;

#endif // XAPI_WEBSOCKET_H
