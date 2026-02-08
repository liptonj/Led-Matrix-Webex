/**
 * @file supabase_realtime.cpp
 * @brief Supabase Realtime Client - Core WebSocket Implementation
 *
 * Core WebSocket connection management, event handling, and connection state tracking.
 * See phoenix_protocol.cpp for Phoenix Channels protocol handling.
 * See realtime_reconnect.cpp for reconnection logic.
 */

#include "supabase_realtime.h"
#include "../common/ca_certs.h"
#include "../common/url_utils.h"
#include "../config/config_manager.h"
#include "../debug/log_system.h"
#include "../core/dependencies.h"
#include "../app_state.h"

static const char* TAG = "REALTIME";

// Global instance
SupabaseRealtime supabaseRealtime;

namespace {
constexpr uint32_t REALTIME_MIN_HEAP_FIRST = 100000;  // Raised from 80000 for TLS+WebSocket headroom
constexpr uint32_t REALTIME_MIN_HEAP_STEADY = 60000;  // Increased from 45000
constexpr uint32_t REALTIME_MIN_HEAP_FLOOR = 50000;   // Increased from 35000
constexpr uint32_t REALTIME_LOW_HEAP_LOG_MS = 30000;

String normalizeJwt(const String& token) {
    String trimmed = token;
    trimmed.trim();
    if (trimmed.startsWith("Bearer ")) {
        trimmed = trimmed.substring(7);
    } else if (trimmed.startsWith("bearer ")) {
        trimmed = trimmed.substring(7);
    }
    trimmed.trim();
    return trimmed;
}

String redactKeyInUrl(const String& url, const String& keyName) {
    String redacted = url;
    String needle = keyName + "=";
    int start = redacted.indexOf(needle);
    if (start < 0) {
        return redacted;
    }
    int valueStart = start + needle.length();
    int valueEnd = redacted.indexOf('&', valueStart);
    if (valueEnd < 0) {
        valueEnd = redacted.length();
    }
    redacted = redacted.substring(0, valueStart) + "<redacted>" + redacted.substring(valueEnd);
    return redacted;
}
}  // namespace

SupabaseRealtime::SupabaseRealtime()
    : _connected(false), _connecting(false), _connectStartMs(0),
      _loggedFirstMessage(false), _loggedCloseFrame(false), _loggedJoinDetails(false),
      _messagePending(false),
      _joinRef(0), _msgRef(0), _lastHeartbeat(0), _lastHeartbeatResponse(0),
      _reconnectDelay(PHOENIX_RECONNECT_MIN_MS), _lastReconnectAttempt(0),
      _lowHeapLogAt(0), _messageHandler(nullptr),
      _hasConnected(false),
      _minHeapFirstConnect(REALTIME_MIN_HEAP_FIRST),
      _minHeapSteady(REALTIME_MIN_HEAP_STEADY),
      _minHeapFloor(REALTIME_MIN_HEAP_FLOOR),
      _msgQueueHead(0), _msgQueueTail(0),
      _channelCount(0) {
    _lastMessage.valid = false;
}

SupabaseRealtime::~SupabaseRealtime() {
    disconnect();
}

void SupabaseRealtime::begin(const String& supabase_url, const String& anon_key,
                              const String& access_token) {
    _supabaseUrl = supabase_url;
    _anonKey = anon_key;
    _accessToken = normalizeJwt(access_token);
    _loggedJoinDetails = false;

    uint32_t minHeap = minHeapRequired();
    if (ESP.getFreeHeap() < minHeap) {
        _connecting = false;
        _connectStartMs = 0;
        unsigned long now = millis();
        if (now - _lowHeapLogAt > REALTIME_LOW_HEAP_LOG_MS) {
            _lowHeapLogAt = now;
            ESP_LOGW(TAG, "Skipping connect - low heap (%lu < %lu)",
                     ESP.getFreeHeap(), (unsigned long)minHeap);
        }
        return;
    }
    
    // Extract host from URL (https://xxx.supabase.co -> xxx.supabase.co)
    String host = _supabaseUrl;
    if (host.startsWith("https://")) {
        host = host.substring(8);
    } else if (host.startsWith("http://")) {
        host = host.substring(7);
    }
    
    // Remove trailing path if any
    int slashIdx = host.indexOf('/');
    if (slashIdx > 0) {
        host = host.substring(0, slashIdx);
    }
    
    // Build realtime WebSocket URL
    // Format: wss://{project}.supabase.co/realtime/v1/websocket?apikey={anon_key}&vsn=1.0.0
    // Access token is sent in the channel join payload for private channels.
    String encodedAnonKey = urlEncode(_anonKey);
    String wsPath = "/realtime/v1/websocket?apikey=" + encodedAnonKey + "&vsn=1.0.0";
    
    String redactedWsPath = redactKeyInUrl(wsPath, "apikey");
    ESP_LOGI(TAG, "Connecting to %s%s", host.c_str(), redactedWsPath.c_str());
    ESP_LOGI(TAG, "TLS context: time=%lu heap=%lu",
             (unsigned long)time(nullptr), ESP.getFreeHeap());
    ESP_LOGI(TAG, "WS headers: (default)");

    String uri = "wss://" + host + wsPath;
    esp_websocket_client_config_t config = {};
    _connecting = true;
    _connectStartMs = millis();
    config.uri = uri.c_str();
    config.disable_auto_reconnect = true;
    config.buffer_size = 2048;  // Reduced from 4096 to save heap
    config.task_stack = 10240;  // 10KB: TLS(5KB) + JSON + Phoenix + safety margin
    config.user_context = this;
    config.ping_interval_sec = 0;
    _wsHeaders = "";
    config.headers = nullptr;
    config.subprotocol = nullptr;
    auto& deps = getDependencies();
    if (deps.config.getTlsVerify()) {
        config.cert_pem = CA_CERT_BUNDLE_SUPABASE;
    } else {
        config.cert_pem = nullptr;
        config.skip_cert_common_name_check = true;
    }

    if (_client) {
        esp_websocket_client_stop(_client);
        esp_websocket_client_destroy(_client);
        _client = nullptr;
    }

    _client = esp_websocket_client_init(&config);
    if (_client) {
        esp_websocket_register_events(_client, WEBSOCKET_EVENT_ANY,
                                      &SupabaseRealtime::websocketEventHandler, this);
        esp_websocket_client_start(_client);
    } else {
        _connecting = false;
        ESP_LOGE(TAG, "Failed to initialize websocket client");
    }
}

void SupabaseRealtime::setAccessToken(const String& access_token) {
    _accessToken = normalizeJwt(access_token);
    _loggedJoinDetails = false;
    
    // If connected, re-authenticate
    if (_connected) {
        ESP_LOGI(TAG, "Token updated - reconnecting to re-authenticate");
        disconnect();
        // Will reconnect on next loop iteration
    }
}

void SupabaseRealtime::loop() {
    // Drain all queued messages (fixes race where rapid messages overwrote
    // a single-slot buffer, losing the join reply before loop() ran)
    while (true) {
        String message;
        portENTER_CRITICAL(&_rxMux);
        if (_msgQueueHead == _msgQueueTail) {
            portEXIT_CRITICAL(&_rxMux);
            break;
        }
        message = _msgQueue[_msgQueueHead];
        _msgQueue[_msgQueueHead] = "";  // Free String memory
        _msgQueueHead = (_msgQueueHead + 1) % MSG_QUEUE_SIZE;
        portEXIT_CRITICAL(&_rxMux);
        handleIncomingMessage(message);
    }
    
    unsigned long now = millis();
    
    // Send heartbeat
    if (_connected && now - _lastHeartbeat >= PHOENIX_HEARTBEAT_INTERVAL_MS) {
        sendHeartbeat();
    }
    
    // Check for heartbeat timeout
    if (_connected && _lastHeartbeatResponse > 0 &&
        now - _lastHeartbeatResponse > (PHOENIX_HEARTBEAT_TIMEOUT_MS)) {
        ESP_LOGW(TAG, "Heartbeat timeout - disconnecting");
        disconnect();
    }
    
    // Handle reconnection
    if (!_connected && now - _lastReconnectAttempt >= _reconnectDelay) {
        auto& deps = getDependencies();
        if (now >= deps.app_state.realtime_defer_until) {
            attemptReconnect();
        }
    }
    
    // Monitor WebSocket task stack usage (every 60 seconds)
    static unsigned long lastStackLog = 0;
    if (millis() - lastStackLog > 60000) {
        lastStackLog = millis();
        // Note: esp_websocket_client runs its own task internally
        // We log heap as a proxy for memory health since we can't directly access the WS task handle
        if (_connected) {
            uint32_t freeHeap = ESP.getFreeHeap();
            uint32_t minFreeHeap = ESP.getMinFreeHeap();
            if (minFreeHeap < 50000) {
                ESP_LOGW(TAG, "Low heap during WebSocket: free=%lu min=%lu", freeHeap, minFreeHeap);
            }
        }
    }
}

void SupabaseRealtime::disconnect() {
    unsubscribe();
    if (_client) {
        esp_websocket_client_stop(_client);
        esp_websocket_client_destroy(_client);
        _client = nullptr;
    }
    _connected = false;
    _connecting = false;
    _lastHeartbeatResponse = 0;

    // Clear all channel states (including rejection flags so channels retry on reconnect)
    for (size_t i = 0; i < _channelCount; i++) {
        _channels[i].subscribed = false;
        _channels[i].joinRejected = false;
        _channels[i].pendingJoin = false;
        _channels[i].pendingJoinMessage = "";
        _channels[i].lastJoinPayload = "";
    }
    _channelCount = 0;

    // Flush message queue
    portENTER_CRITICAL(&_rxMux);
    for (size_t i = 0; i < MSG_QUEUE_SIZE; i++) {
        _msgQueue[i] = "";
    }
    _msgQueueHead = 0;
    _msgQueueTail = 0;
    _rxBuffer = "";
    portEXIT_CRITICAL(&_rxMux);
}

RealtimeMessage SupabaseRealtime::getMessage() {
    _messagePending = false;
    return _lastMessage;
}

void SupabaseRealtime::handleIncomingMessage(const String& message) {
    String topic, event;
    JsonDocument payloadDoc;
    int ref, joinRef;

    if (parsePhoenixMessage(message, topic, event, payloadDoc, ref, joinRef)) {
        handlePhoenixMessage(topic, event, payloadDoc);
    }
}

void SupabaseRealtime::websocketEventHandler(void* handler_args, esp_event_base_t base,
                                             int32_t event_id, void* event_data) {
    auto* instance = static_cast<SupabaseRealtime*>(handler_args);
    if (!instance) {
        return;
    }

    if (event_id == WEBSOCKET_EVENT_CONNECTED) {
        ESP_LOGI(TAG, "WebSocket connected to Supabase");
        instance->_connected = true;
        instance->_connecting = false;
        instance->_loggedFirstMessage = false;
        instance->_loggedCloseFrame = false;
        instance->_hasConnected = true;
        instance->_lastHeartbeatResponse = millis();
        instance->_reconnectDelay = PHOENIX_RECONNECT_MIN_MS;
        
        // Rejoin all registered channels (rejection flags are cleared on disconnect/reconnect)
        if (instance->_client && esp_websocket_client_is_connected(instance->_client)) {
            for (size_t i = 0; i < instance->_channelCount; i++) {
                ChannelState& channel = instance->_channels[i];
                if (channel.topic.isEmpty() || channel.joinRejected) continue;
                
                // Check for pending join message first
                if (channel.pendingJoin && !channel.pendingJoinMessage.isEmpty()) {
                    ESP_LOGI(TAG, "Sending queued join for %s (%zu bytes)",
                             channel.topic.c_str(), channel.pendingJoinMessage.length());
                    int sent = esp_websocket_client_send_text(
                        instance->_client,
                        channel.pendingJoinMessage.c_str(),
                        channel.pendingJoinMessage.length(),
                        portMAX_DELAY);
                    if (sent < 0) {
                        ESP_LOGW(TAG, "Failed to send queued join for %s: %d", 
                                channel.topic.c_str(), sent);
                    } else {
                        ESP_LOGI(TAG, "Sent queued join for %s (%d bytes)", 
                                channel.topic.c_str(), sent);
                        channel.pendingJoin = false;
                        channel.pendingJoinMessage = "";
                    }
                } else if (!channel.lastJoinPayload.isEmpty()) {
                    // Rejoin using cached payload (reconnection)
                    JsonDocument payloadDoc;
                    if (!deserializeJson(payloadDoc, channel.lastJoinPayload)) {
                        channel.joinRef = ++instance->_joinRef;
                        instance->_msgRef++;
                        String msg = instance->buildPhoenixMessage(channel.topic, "phx_join",
                                                                   payloadDoc, channel.joinRef);
                        int sent = esp_websocket_client_send_text(
                            instance->_client, msg.c_str(), msg.length(), portMAX_DELAY);
                        if (sent < 0) {
                            ESP_LOGW(TAG, "Failed to rejoin %s: %d", channel.topic.c_str(), sent);
                        } else {
                            ESP_LOGI(TAG, "Rejoined %s (%d bytes)", channel.topic.c_str(), sent);
                        }
                    }
                }
            }
            // Send access token for all private channels
            instance->sendAccessToken();
        }
        return;
    }

    if (event_id == WEBSOCKET_EVENT_DISCONNECTED || event_id == WEBSOCKET_EVENT_CLOSED) {
        if (instance->_connected) {
            ESP_LOGW(TAG, "WebSocket disconnected (was connected)");
        } else {
            ESP_LOGI(TAG, "Disconnected (was not connected)");
        }
        instance->_connected = false;
        instance->_connecting = false;
        // Mark all channels as unsubscribed (will rejoin on reconnect)
        // Clear rejection flags so channels get a fresh attempt after reconnect
        for (size_t i = 0; i < instance->_channelCount; i++) {
            instance->_channels[i].subscribed = false;
            instance->_channels[i].joinRejected = false;
        }
        return;
    }

    if (event_id == WEBSOCKET_EVENT_ERROR) {
        auto* error_data = static_cast<esp_websocket_event_id_t*>(event_data);
        ESP_LOGE(TAG, "WebSocket error event: %ld", (long)event_id);
        if (error_data) {
            ESP_LOGD(TAG, "Error data pointer: %p", error_data);
        }
        instance->_connected = false;
        instance->_connecting = false;
        for (size_t i = 0; i < instance->_channelCount; i++) {
            instance->_channels[i].subscribed = false;
            instance->_channels[i].joinRejected = false;
        }
        return;
    }

    if (event_id == WEBSOCKET_EVENT_DATA) {
        auto* data = static_cast<esp_websocket_event_data_t*>(event_data);
        if (!data) {
            return;
        }

        if (data->op_code == 0x8) {  // close frame
            if (!instance->_loggedCloseFrame) {
                uint16_t closeCode = 0;
                String closeReason = "";
                if (data->data_len >= 2 && data->data_ptr) {
                    closeCode = (static_cast<uint8_t>(data->data_ptr[0]) << 8) |
                                static_cast<uint8_t>(data->data_ptr[1]);
                    if (data->data_len > 2) {
                        closeReason = String(data->data_ptr + 2, data->data_len - 2);
                    }
                }
                ESP_LOGW(TAG, "WebSocket close frame (code=%u len=%d reason=%s)",
                         static_cast<unsigned int>(closeCode), data->data_len,
                         closeReason.isEmpty() ? "none" : closeReason.c_str());
                instance->_loggedCloseFrame = true;
            }
            return;
        }

        if (data->op_code != 0x1) {  // text frame only
            return;
        }

        portENTER_CRITICAL(&instance->_rxMux);
        
        // Check buffer size limit before appending
        if (instance->_rxBuffer.length() + data->data_len > REALTIME_RX_BUFFER_MAX) {
            ESP_LOGW(TAG, "RX buffer overflow prevented: %zu + %d > %d",
                     instance->_rxBuffer.length(), data->data_len, REALTIME_RX_BUFFER_MAX);
            instance->_rxBuffer = "";  // Reset buffer on overflow
            portEXIT_CRITICAL(&instance->_rxMux);
            return;
        }
        
        instance->_rxBuffer.concat(String(data->data_ptr, data->data_len));
        if (data->payload_offset + data->data_len >= data->payload_len) {
            String completeMessage = instance->_rxBuffer;
            instance->_rxBuffer = "";

            // Log first message for diagnostics
            if (!instance->_loggedFirstMessage) {
                String snippet = completeMessage.substring(0, 200);
                ESP_LOGI(TAG, "First WS message (%d bytes): %s",
                         completeMessage.length(), snippet.c_str());
                instance->_loggedFirstMessage = true;
            }
            auto& deps = getDependencies();
            if (deps.config.getPairingRealtimeDebug()) {
                const int maxLen = 1024;
                String raw = completeMessage;
                if (raw.length() > maxLen) {
                    raw = raw.substring(0, maxLen) + "...";
                }
                ESP_LOGD(TAG, "[RAW] %s", raw.c_str());
            }

            // Push to circular queue
            size_t nextTail = (instance->_msgQueueTail + 1) % SupabaseRealtime::MSG_QUEUE_SIZE;
            if (nextTail != instance->_msgQueueHead) {
                instance->_msgQueue[instance->_msgQueueTail] = completeMessage;
                instance->_msgQueueTail = nextTail;
            } else {
                ESP_LOGW(TAG, "Message queue full - dropped message");
            }
        }
        portEXIT_CRITICAL(&instance->_rxMux);
    }
}

uint32_t SupabaseRealtime::connectingDurationMs() const {
    if (!_connecting || _connectStartMs == 0) {
        return 0;
    }
    unsigned long now = millis();
    if (now < _connectStartMs) {
        // Handle wraparound
        return (ULONG_MAX - _connectStartMs) + now;
    }
    return now - _connectStartMs;
}

bool SupabaseRealtime::isConnected() const {
    if (!_connected) {
        return false;
    }
    // Check if at least one channel is subscribed
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].subscribed) {
            return true;
        }
    }
    return false;
}

ChannelState* SupabaseRealtime::findChannel(const String& topic) {
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].topic == topic) {
            return &_channels[i];
        }
    }
    return nullptr;
}

const ChannelState* SupabaseRealtime::findChannel(const String& topic) const {
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].topic == topic) {
            return &_channels[i];
        }
    }
    return nullptr;
}

int SupabaseRealtime::findChannelIndex(const String& topic) const {
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].topic == topic) {
            return static_cast<int>(i);
        }
    }
    return -1;
}

bool SupabaseRealtime::isChannelSubscribed(const String& topic) const {
    const ChannelState* channel = findChannel(topic);
    return channel != nullptr && channel->subscribed;
}

bool SupabaseRealtime::subscribeToDeviceChannel(const String& device_uuid) {
    if (device_uuid.isEmpty()) {
        ESP_LOGW(TAG, "Cannot subscribe to device channel - device_uuid is empty");
        return false;
    }
    
    if (_channelCount >= MAX_CHANNELS) {
        ESP_LOGW(TAG, "Cannot subscribe to device channel - max channels reached");
        return false;
    }
    
    // Check if channel already exists
    String channelTopic = "realtime:device:" + device_uuid;
    if (findChannel(channelTopic) != nullptr) {
        ESP_LOGD(TAG, "Device channel already subscribed: %s", channelTopic.c_str());
        return true;
    }
    
    // Set up device channel state
    ChannelState& channel = _channels[CHANNEL_DEVICE];
    channel.topic = channelTopic;
    channel.privateChannel = true;
    
    ESP_LOGI(TAG, "Subscribing to device channel: %s", channelTopic.c_str());
    
    // Build join payload for device channel (broadcast-only, no postgres_changes)
    JsonDocument payload;
    payload.to<JsonObject>();
    JsonObject config = payload["config"].to<JsonObject>();
    config["broadcast"]["self"] = false;
    config["presence"]["key"] = "";
    config["private"] = true;
    payload["access_token"] = _accessToken;
    
    String payloadFull;
    serializeJson(payload, payloadFull);
    channel.lastJoinPayload = payloadFull;
    
    // Build Phoenix join message
    channel.joinRef = ++_joinRef;
    _msgRef++;
    String message = buildPhoenixMessage(channelTopic, "phx_join", payload, channel.joinRef);
    
    if (message.isEmpty()) {
        ESP_LOGE(TAG, "Failed to build device channel join message");
        return false;
    }
    
    // Ensure _channelCount covers the device slot
    if (_channelCount <= CHANNEL_DEVICE) {
        _channelCount = CHANNEL_DEVICE + 1;
    }
    
    // Send join message if connected, otherwise queue it
    if (!_connected) {
        if (_client) {
            channel.pendingJoinMessage = message;
            channel.pendingJoin = true;
            ESP_LOGI(TAG, "Device channel subscription queued (not connected)");
            return true;
        } else {
            ESP_LOGW(TAG, "Cannot subscribe to device channel - not connected");
            return false;
        }
    }
    
    if (!esp_websocket_client_is_connected(_client)) {
        channel.pendingJoinMessage = message;
        channel.pendingJoin = true;
        ESP_LOGI(TAG, "Device channel subscription queued (socket not ready)");
        return true;
    }
    
    int sent = esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
    if (sent < 0) {
        ESP_LOGE(TAG, "Failed to send device channel subscription: %d", sent);
        channel.pendingJoinMessage = message;
        channel.pendingJoin = true;
        return false;
    }
    
    ESP_LOGI(TAG, "Device channel subscription sent (%d bytes)", sent);
    
    // Send access token for private channel
    sendAccessToken();
    
    return true;
}
