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
#include "../debug/remote_logger.h"
#include "../core/dependencies.h"

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
    : _connected(false), _subscribed(false), _connecting(false), _connectStartMs(0),
      _loggedFirstMessage(false), _loggedCloseFrame(false), _loggedJoinDetails(false),
      _pendingJoinMessage(""), _pendingJoin(false), _messagePending(false),
      _joinRef(0), _msgRef(0), _lastHeartbeat(0), _lastHeartbeatResponse(0),
      _reconnectDelay(PHOENIX_RECONNECT_MIN_MS), _lastReconnectAttempt(0),
      _lowHeapLogAt(0), _messageHandler(nullptr),
      _hasConnected(false),
      _minHeapFirstConnect(REALTIME_MIN_HEAP_FIRST),
      _minHeapSteady(REALTIME_MIN_HEAP_STEADY),
      _minHeapFloor(REALTIME_MIN_HEAP_FLOOR) {
    _lastMessage.valid = false;
    _privateChannel = false;
}

SupabaseRealtime::~SupabaseRealtime() {
    disconnect();
}

void SupabaseRealtime::setChannelTopic(const String& topic) {
    _channelTopic = topic;
}

void SupabaseRealtime::begin(const String& supabase_url, const String& anon_key,
                              const String& access_token) {
    _supabaseUrl = supabase_url;
    _anonKey = anon_key;
    _accessToken = normalizeJwt(access_token);
    _loggedJoinDetails = false;
    _privateChannel = false;

    uint32_t minHeap = minHeapRequired();
    if (ESP.getFreeHeap() < minHeap) {
        _connecting = false;
        _connectStartMs = 0;
        unsigned long now = millis();
        if (now - _lowHeapLogAt > REALTIME_LOW_HEAP_LOG_MS) {
            _lowHeapLogAt = now;
            Serial.printf("[REALTIME] Skipping connect - low heap (%lu < %lu)\n",
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
    Serial.printf("[REALTIME] Connecting to %s%s\n", host.c_str(), redactedWsPath.c_str());
    Serial.printf("[REALTIME] TLS context: time=%lu heap=%lu\n",
                  (unsigned long)time(nullptr), ESP.getFreeHeap());
    Serial.println("[REALTIME] WS headers: (default)");

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
        RLOG_ERROR("realtime", "Failed to initialize websocket client");
    }
}

void SupabaseRealtime::setAccessToken(const String& access_token) {
    _accessToken = normalizeJwt(access_token);
    _loggedJoinDetails = false;
    
    // If connected, re-authenticate
    if (_connected) {
        Serial.println("[REALTIME] Token updated - reconnecting to re-authenticate");
        disconnect();
        // Will reconnect on next loop iteration
    }
}

void SupabaseRealtime::loop() {
    if (_pendingMessageAvailable) {
        String message;
        portENTER_CRITICAL(&_rxMux);
        message = _pendingMessage;
        _pendingMessage = "";
        _pendingMessageAvailable = false;
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
        Serial.println("[REALTIME] Heartbeat timeout - disconnecting");
        disconnect();
    }
    
    // Handle reconnection
    if (!_connected && now - _lastReconnectAttempt >= _reconnectDelay) {
        attemptReconnect();
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
                RLOG_WARN("realtime", "Low heap during WebSocket: free=%lu min=%lu", freeHeap, minFreeHeap);
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
    _subscribed = false;
    _connecting = false;
    _lastHeartbeatResponse = 0;
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
        Serial.println("[REALTIME] Connected");
        RLOG_INFO("Realtime", "WebSocket connected to Supabase");
        instance->_connected = true;
        instance->_connecting = false;
        instance->_loggedFirstMessage = false;
        instance->_loggedCloseFrame = false;
        instance->_hasConnected = true;
        instance->_lastHeartbeatResponse = millis();
        instance->_reconnectDelay = PHOENIX_RECONNECT_MIN_MS;
        if (instance->_pendingJoin && instance->_client &&
            esp_websocket_client_is_connected(instance->_client)) {
            Serial.printf("[REALTIME] Sending queued join message (%zu bytes)\n",
                          instance->_pendingJoinMessage.length());
            int sent = esp_websocket_client_send_text(
                instance->_client,
                instance->_pendingJoinMessage.c_str(),
                instance->_pendingJoinMessage.length(),
                portMAX_DELAY);
            if (sent < 0) {
                RLOG_WARN("realtime", "Failed to send queued subscription: %d", sent);
            } else {
                Serial.printf("[REALTIME] Sent queued subscription (%d bytes)\n", sent);
                instance->_pendingJoin = false;
                instance->_pendingJoinMessage = "";
                if (instance->_privateChannel) {
                    instance->sendAccessToken();
                }
            }
        } else if (!instance->_lastJoinPayload.isEmpty() &&
                   !instance->_channelTopic.isEmpty() &&
                   instance->_client && esp_websocket_client_is_connected(instance->_client)) {
            JsonDocument payloadDoc;
            if (!deserializeJson(payloadDoc, instance->_lastJoinPayload)) {
                instance->_joinRef++;
                instance->_msgRef++;
                String msg = instance->buildPhoenixMessage(instance->_channelTopic, "phx_join",
                                                           payloadDoc, instance->_joinRef);
                int sent = esp_websocket_client_send_text(
                    instance->_client,
                    msg.c_str(),
                    msg.length(),
                    portMAX_DELAY);
                if (sent < 0) {
                    Serial.printf("[REALTIME] Failed to resend join (ret=%d)\n", sent);
                } else {
                    Serial.printf("[REALTIME] Resent join (%d bytes)\n", sent);
                    if (instance->_privateChannel) {
                        instance->sendAccessToken();
                    }
                }
            }
        } else {
            if (instance->_channelTopic.isEmpty()) {
                Serial.println("[REALTIME] No channel topic set - cannot join");
            } else if (instance->_lastJoinPayload.isEmpty()) {
                Serial.println("[REALTIME] No cached join payload - cannot join");
            } else {
                Serial.println("[REALTIME] Join not sent (no pending join)");
            }
        }
        return;
    }

    if (event_id == WEBSOCKET_EVENT_DISCONNECTED || event_id == WEBSOCKET_EVENT_CLOSED) {
        if (instance->_connected) {
            Serial.println("[REALTIME] Disconnected (was connected)");
            RLOG_WARN("Realtime", "WebSocket disconnected");
        } else {
            Serial.println("[REALTIME] Disconnected (was not connected)");
        }
        instance->_connected = false;
        instance->_subscribed = false;
        instance->_connecting = false;
        return;
    }

    if (event_id == WEBSOCKET_EVENT_ERROR) {
        auto* error_data = static_cast<esp_websocket_event_id_t*>(event_data);
        RLOG_ERROR("realtime", "WebSocket error event: %ld", (long)event_id);
        // Log additional error details if available
        if (error_data) {
            Serial.printf("[REALTIME] Error data pointer: %p\n", error_data);
        }
        instance->_connected = false;
        instance->_subscribed = false;
        instance->_connecting = false;
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
                Serial.printf("[REALTIME] WebSocket close frame (code=%u len=%d reason=%s)\n",
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
            Serial.printf("[REALTIME] RX buffer overflow prevented: %zu + %d > %d\n",
                          instance->_rxBuffer.length(), data->data_len, REALTIME_RX_BUFFER_MAX);
            instance->_rxBuffer = "";  // Reset buffer on overflow
            portEXIT_CRITICAL(&instance->_rxMux);
            return;
        }
        
        instance->_rxBuffer.concat(String(data->data_ptr, data->data_len));
        if (data->payload_offset + data->data_len >= data->payload_len) {
            instance->_pendingMessage = instance->_rxBuffer;
            instance->_rxBuffer = "";
            instance->_pendingMessageAvailable = true;
            if (!instance->_loggedFirstMessage) {
                String snippet = instance->_pendingMessage.substring(0, 200);
                Serial.printf("[REALTIME] First WS message (%d bytes): %s\n",
                              instance->_pendingMessage.length(), snippet.c_str());
                instance->_loggedFirstMessage = true;
            }
            auto& deps = getDependencies();
            if (deps.config.getPairingRealtimeDebug()) {
                const int maxLen = 1024;
                String raw = instance->_pendingMessage;
                if (raw.length() > maxLen) {
                    raw = raw.substring(0, maxLen) + "...";
                }
                Serial.printf("[REALTIME][RAW] %s\n", raw.c_str());
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
