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
#include <ArduinoJson.h>

#ifdef NATIVE_BUILD
// Minimal type stubs for native test compilation
typedef void* esp_websocket_client_handle_t;
typedef const char* esp_event_base_t;
typedef int esp_websocket_event_id_t;
#define portMAX_DELAY 0xFFFFFFFF
inline bool esp_websocket_client_is_connected(esp_websocket_client_handle_t) { return false; }
inline int esp_websocket_client_send_text(esp_websocket_client_handle_t, const char*, int, int) { return 0; }
#else
#include <esp_event.h>
#include <esp_websocket_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#endif

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
    String topic;          // Channel topic for routing
    JsonDocument payload;  // Full payload
    bool valid;
};

// Message handler callback type
typedef void (*RealtimeMessageHandler)(const RealtimeMessage& msg);

/**
 * @brief Per-channel state for multi-channel subscriptions
 */
struct ChannelState {
    String topic;
    bool subscribed;
    bool privateChannel;
    bool joinRejected;       // Permanently rejected (e.g., authorization error)
    int joinRef;
    String lastJoinPayload;
    String pendingJoinMessage;
    bool pendingJoin;
    ChannelState() : subscribed(false), privateChannel(false), joinRejected(false),
                     joinRef(0), pendingJoin(false) {}
};

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
     * @return true if connected and at least one channel subscribed
     */
    bool isConnected() const;
    bool isSocketConnected() const { return _connected; }
    bool isConnecting() const { return _connecting; }
    uint32_t connectingDurationMs() const;

    /**
     * @brief Subscribe to user channel (user:{user_uuid}) for user-specific events
     * @param user_uuid User UUID to subscribe to
     * @return true if subscription request sent
     */
    bool subscribeToUserChannel(const String& user_uuid);

    /**
     * @brief Subscribe to device channel (device:{device_uuid}) for device-specific events
     * 
     * Channel topic format: realtime:device:{device_uuid} (Phoenix protocol)
     * Backend RLS topic: device:{device_uuid} (used for routing)
     * 
     * Used for device-specific events:
     *   - Commands: device:{device_uuid}:events
     *   - Firmware: device:{device_uuid}:firmware
     *   - Heartbeats: device:{device_uuid}:heartbeats
     * 
     * @param device_uuid Device UUID (from ConfigManager, set during device-auth)
     * @return true if subscription request sent
     */
    bool subscribeToDeviceChannel(const String& device_uuid);

    /**
     * @brief Check if a specific channel is subscribed
     * @param topic Channel topic to check
     * @return true if channel is subscribed
     */
    bool isChannelSubscribed(const String& topic) const;

    /**
     * @brief Send a broadcast message on the current channel
     * @param event Event name (e.g., "command_ack", "debug_log")
     * @param data JSON payload to broadcast
     * @return true if broadcast sent successfully
     * @note This method does NOT implement HTTP fallback. If the WebSocket
     *       connection is not available, the broadcast will fail silently.
     */
    bool sendBroadcast(const String& event, const JsonDocument& data);

    /**
     * @brief Send a broadcast message on a specific channel topic
     * @param topic Channel topic to broadcast on
     * @param event Event name
     * @param data JSON payload to broadcast
     * @return true if broadcast sent successfully
     */
    bool sendBroadcast(const String& topic, const String& event, const JsonDocument& data);

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

    // Circular message queue (replaces single _pendingMessage buffer to prevent
    // message loss when multiple WebSocket frames arrive between loop() calls)
    static constexpr size_t MSG_QUEUE_SIZE = 8;
    String _msgQueue[MSG_QUEUE_SIZE];
    size_t _msgQueueHead = 0;  // Read index  (loop() consumes from here)
    size_t _msgQueueTail = 0;  // Write index (ISR/event handler writes here)
    String _supabaseUrl;
    String _anonKey;
    String _accessToken;
    String _wsHeaders;
    bool _connected;
    bool _connecting;
    unsigned long _connectStartMs;
    bool _loggedFirstMessage;
    bool _loggedCloseFrame;
    bool _loggedJoinDetails;
    bool _messagePending;
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

    /**
     * @brief Find channel by topic
     * @param topic Channel topic to find
     * @return Pointer to channel state, or nullptr if not found
     */
    ChannelState* findChannel(const String& topic);
    const ChannelState* findChannel(const String& topic) const;
    int findChannelIndex(const String& topic) const;

private:
    // Multi-channel support constants
    static constexpr size_t MAX_CHANNELS = 2;
    static constexpr size_t CHANNEL_USER = 0;
    static constexpr size_t CHANNEL_DEVICE = 1;

    // Multi-channel state
    ChannelState _channels[MAX_CHANNELS];
    size_t _channelCount = 0;

};

// Global instance
extern SupabaseRealtime supabaseRealtime;

#endif // SUPABASE_REALTIME_H
