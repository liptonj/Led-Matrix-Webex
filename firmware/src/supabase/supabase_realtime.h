/**
 * @file supabase_realtime.h
 * @brief Supabase Realtime Client (Phoenix Protocol) for ESP32
 *
 * Phase B implementation: WebSocket-based realtime updates from Supabase.
 * Uses Phoenix Channels protocol for bidirectional communication.
 *
 * Features:
 * - Phoenix protocol WebSocket connection
 * - Automatic heartbeat handling
 * - Channel subscription (postgres_changes)
 * - Reconnection with exponential backoff
 *
 * Note: This is optional - Phase A polling works well for most use cases.
 * Enable realtime for lower latency command delivery.
 */

#ifndef SUPABASE_REALTIME_H
#define SUPABASE_REALTIME_H

#include <Arduino.h>
#include <esp_event.h>
#include <esp_websocket_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#include <ArduinoJson.h>

// Phoenix protocol constants
#define PHOENIX_HEARTBEAT_INTERVAL_MS 30000
#define PHOENIX_HEARTBEAT_TIMEOUT_MS 60000
#define PHOENIX_RECONNECT_MIN_MS 1000
#define PHOENIX_RECONNECT_MAX_MS 60000

// Buffer size limits to prevent unbounded growth
#define REALTIME_RX_BUFFER_MAX 65536  // 64KB max for WebSocket messages

/**
 * @brief Realtime message received from Supabase
 */
struct RealtimeMessage {
    String event;          // insert, update, delete
    String table;          // Table name
    String schema;         // Schema name (display)
    JsonDocument payload;  // Full payload
    bool valid;
};

// Message handler callback type
typedef void (*RealtimeMessageHandler)(const RealtimeMessage& msg);

/**
 * @brief Supabase Realtime Client (Phoenix Protocol)
 *
 * Connects to Supabase Realtime for instant updates.
 */
class SupabaseRealtime {
public:
    SupabaseRealtime();
    ~SupabaseRealtime();

    /**
     * @brief Initialize and connect to Supabase Realtime
     * @param supabase_url Base Supabase URL
     * @param anon_key Supabase anon/public key
     * @param access_token Device JWT token (from device-auth)
     */
    void begin(const String& supabase_url, const String& anon_key, 
               const String& access_token);

    /**
     * @brief Update access token (after refresh)
     * @param access_token New JWT token
     */
    void setAccessToken(const String& access_token);

    /**
     * @brief Process WebSocket events (call in loop)
     */
    void loop();

    /**
     * @brief Check if connected to realtime
     * @return true if connected and subscribed
     */
    bool isConnected() const { return _connected && _subscribed; }
    bool isSocketConnected() const { return _connected; }
    bool isConnecting() const { return _connecting; }
    uint32_t connectingDurationMs() const;

    /**
     * @brief Subscribe to a single table channel
     * @param schema Database schema
     * @param table Table name
     * @param filter Optional filter (e.g., "pairing_code=eq.ABC123")
     * @return true if subscription request sent
     */
    bool subscribe(const String& schema, const String& table, 
                   const String& filter = "");

    /**
     * @brief Set channel topic for subscriptions
     * @param topic Channel topic (must not be "realtime")
     */
    void setChannelTopic(const String& topic);
    
    /**
     * @brief Subscribe to multiple tables on a single channel
     * @param schema Database schema
     * @param tables Array of table names
     * @param tableCount Number of tables
     * @param filter Filter to apply to all tables (e.g., "pairing_code=eq.ABC123")
     * @param includePostgresChanges Whether to include postgres_changes config
     * @return true if subscription request sent
     */
    bool subscribeMultiple(const String& schema, const String tables[], 
                           int tableCount, const String& filter = "",
                           bool includePostgresChanges = true);

    /**
     * @brief Subscribe to broadcast-only channel (no postgres_changes)
     * @return true if subscription request sent
     */
    bool subscribeBroadcast();

    /**
     * @brief Unsubscribe from current channel
     */
    void unsubscribe();

    /**
     * @brief Disconnect from realtime
     */
    void disconnect();

    /**
     * @brief Set message handler callback
     * @param handler Function to call when message received
     */
    void setMessageHandler(RealtimeMessageHandler handler) { _messageHandler = handler; }

    /**
     * @brief Check if there's a pending message
     * @return true if message available
     */
    bool hasMessage() const { return _messagePending; }

    /**
     * @brief Get the latest message
     * @return RealtimeMessage structure
     */
    RealtimeMessage getMessage();

    /**
     * @brief Minimum heap required to attempt a connect
     */
    uint32_t minHeapRequired() const;

    /**
     * @brief Whether the websocket has ever connected successfully
     */
    bool hasEverConnected() const { return _hasConnected; }

private:
    esp_websocket_client_handle_t _client = nullptr;
    portMUX_TYPE _rxMux = portMUX_INITIALIZER_UNLOCKED;
    String _rxBuffer;
    String _pendingMessage;
    bool _pendingMessageAvailable = false;
    String _supabaseUrl;
    String _anonKey;
    String _accessToken;
    String _wsHeaders;
    String _channelTopic;
    bool _privateChannel;
    bool _connected;
    bool _subscribed;
    bool _connecting;
    unsigned long _connectStartMs;
    bool _loggedFirstMessage;
    bool _loggedCloseFrame;
    bool _loggedJoinDetails;
    String _pendingJoinMessage;
    bool _pendingJoin;
    bool _messagePending;
    String _lastJoinPayload;
    int _joinRef;
    int _msgRef;
    unsigned long _lastHeartbeat;
    unsigned long _lastHeartbeatResponse;
    unsigned long _reconnectDelay;
    unsigned long _lastReconnectAttempt;
    unsigned long _lowHeapLogAt;
    RealtimeMessage _lastMessage;
    RealtimeMessageHandler _messageHandler;
    bool _hasConnected;
    uint32_t _minHeapFirstConnect;
    uint32_t _minHeapSteady;
    uint32_t _minHeapFloor;

    void handleIncomingMessage(const String& message);
    static void websocketEventHandler(void* handler_args, esp_event_base_t base,
                                      int32_t event_id, void* event_data);

    /**
     * @brief Build Phoenix message
     */
    String buildPhoenixMessage(const String& topic, const String& event, 
                                const JsonDocument& payload, int ref = 0);

    /**
     * @brief Parse Phoenix message
     */
    bool parsePhoenixMessage(const String& message, String& topic, 
                              String& event, JsonDocument& payload, 
                              int& ref, int& joinRef);

    /**
     * @brief Send heartbeat
     */
    void sendHeartbeat();

    /**
     * @brief Send access token refresh message on the channel
     */
    void sendAccessToken();

    /**
     * @brief Handle WebSocket events
     */

    /**
     * @brief Handle Phoenix message
     */
    void handlePhoenixMessage(const String& topic, const String& event, 
                               const JsonDocument& payload);

    /**
     * @brief Attempt reconnection
     */
    void attemptReconnect();

};

// Global instance
extern SupabaseRealtime supabaseRealtime;

#endif // SUPABASE_REALTIME_H
