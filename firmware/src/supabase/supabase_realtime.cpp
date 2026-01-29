/**
 * @file supabase_realtime.cpp
 * @brief Supabase Realtime Client Implementation
 *
 * Implements Phoenix Channels protocol for Supabase Realtime.
 * See: https://hexdocs.pm/phoenix/Phoenix.Socket.html
 *
 * Message format:
 * [join_ref, ref, topic, event, payload]
 */

#include "supabase_realtime.h"
#include "../common/ca_certs.h"
#include "../config/config_manager.h"

extern ConfigManager config_manager;

// Global instance
SupabaseRealtime supabaseRealtime;

namespace {
constexpr uint32_t REALTIME_MIN_HEAP = 60000;
constexpr uint32_t REALTIME_LOW_HEAP_LOG_MS = 30000;
}  // namespace

SupabaseRealtime::SupabaseRealtime()
    : _connected(false), _subscribed(false), _messagePending(false),
      _joinRef(0), _msgRef(0), _lastHeartbeat(0), _lastHeartbeatResponse(0),
      _reconnectDelay(PHOENIX_RECONNECT_MIN_MS), _lastReconnectAttempt(0),
      _lowHeapLogAt(0), _messageHandler(nullptr) {
    _lastMessage.valid = false;
}

SupabaseRealtime::~SupabaseRealtime() {
    disconnect();
}

void SupabaseRealtime::begin(const String& supabase_url, const String& anon_key,
                              const String& access_token) {
    _supabaseUrl = supabase_url;
    _anonKey = anon_key;
    _accessToken = access_token;

    if (ESP.getFreeHeap() < REALTIME_MIN_HEAP) {
        unsigned long now = millis();
        if (now - _lowHeapLogAt > REALTIME_LOW_HEAP_LOG_MS) {
            _lowHeapLogAt = now;
            Serial.printf("[REALTIME] Skipping connect - low heap (%lu < %lu)\n",
                          ESP.getFreeHeap(), (unsigned long)REALTIME_MIN_HEAP);
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
    String wsPath = "/realtime/v1/websocket?apikey=" + _anonKey + "&vsn=1.0.0";
    
    Serial.printf("[REALTIME] Connecting to %s%s\n", host.c_str(), wsPath.c_str());
    Serial.printf("[REALTIME] TLS context: time=%lu heap=%lu\n",
                  (unsigned long)time(nullptr), ESP.getFreeHeap());
    
    String uri = "wss://" + host + wsPath;
    esp_websocket_client_config_t config = {};
    config.uri = uri.c_str();
    config.disable_auto_reconnect = true;
    config.buffer_size = 4096;
    config.user_context = this;
    config.ping_interval_sec = 0;
    if (config_manager.getTlsVerify()) {
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
        Serial.println("[REALTIME] Failed to initialize websocket client");
    }
}

void SupabaseRealtime::setAccessToken(const String& access_token) {
    _accessToken = access_token;
    
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
        now - _lastHeartbeatResponse > PHOENIX_HEARTBEAT_TIMEOUT_MS * 2) {
        Serial.println("[REALTIME] Heartbeat timeout - disconnecting");
        disconnect();
    }
    
    // Handle reconnection
    if (!_connected && now - _lastReconnectAttempt >= _reconnectDelay) {
        attemptReconnect();
    }
}

bool SupabaseRealtime::subscribe(const String& schema, const String& table,
                                  const String& filter) {
    // Delegate to subscribeMultiple for single table
    const String tables[] = { table };
    return subscribeMultiple(schema, tables, 1, filter);
}

bool SupabaseRealtime::subscribeMultiple(const String& schema, const String tables[],
                                          int tableCount, const String& filter) {
    if (!_connected) {
        Serial.println("[REALTIME] Cannot subscribe - not connected");
        return false;
    }
    
    // Validate inputs
    if (tableCount <= 0 || tableCount > 10) {
        Serial.printf("[REALTIME] Invalid table count: %d (must be 1-10)\n", tableCount);
        return false;
    }
    
    if (tables == nullptr) {
        Serial.println("[REALTIME] Tables array is null");
        return false;
    }
    
    if (schema.isEmpty()) {
        Serial.println("[REALTIME] Schema is empty");
        return false;
    }
    
    // Check heap before proceeding (need at least 20KB for JSON operations)
    const uint32_t min_heap = 20000;
    if (ESP.getFreeHeap() < min_heap) {
        Serial.printf("[REALTIME] Insufficient heap for subscription (%lu < %lu)\n",
                      ESP.getFreeHeap(), (unsigned long)min_heap);
        return false;
    }
    
    // Validate all table names before processing
    for (int i = 0; i < tableCount; i++) {
        if (tables[i].isEmpty()) {
            Serial.printf("[REALTIME] Table %d is empty\n", i);
            return false;
        }
        if (tables[i].length() > 64) {
            Serial.printf("[REALTIME] Table name too long: %s\n", tables[i].c_str());
            return false;
        }
    }
    
    _joinRef++;
    _msgRef++;
    
    // Build channel topic using first table (topic is just an identifier)
    // Format: realtime:{schema}:multi:{filter}
    _channelTopic = "realtime:" + schema + ":multi";
    if (!filter.isEmpty()) {
        _channelTopic += ":" + filter;
    }
    
    // Build join payload with postgres_changes config
    // Reserve capacity upfront to prevent reallocations
    JsonDocument payload;
    payload.to<JsonObject>();  // Ensure it's an object
    
    // Check if we have enough capacity (estimate: ~200 bytes per table + overhead)
    size_t estimatedSize = 512 + (tableCount * 200) + filter.length() + _accessToken.length();
    if (payload.capacity() < estimatedSize) {
        Serial.printf("[REALTIME] WARNING: JSON capacity (%zu) may be insufficient for %d tables\n",
                      payload.capacity(), tableCount);
        // Try to continue anyway - ArduinoJson will handle overflow gracefully
    }
    
    JsonObject config = payload["config"].to<JsonObject>();
    if (config.isNull()) {
        Serial.println("[REALTIME] Failed to create config object");
        return false;
    }
    
    config["broadcast"]["self"] = false;
    config["presence"]["key"] = "";
    
    // Add postgres_changes subscription for each table
    JsonArray pgChanges = config["postgres_changes"].to<JsonArray>();
    if (pgChanges.isNull()) {
        Serial.println("[REALTIME] Failed to create postgres_changes array");
        return false;
    }
    
    for (int i = 0; i < tableCount; i++) {
        JsonObject change = pgChanges.add<JsonObject>();
        if (change.isNull()) {
            Serial.printf("[REALTIME] Failed to add table %d to postgres_changes\n", i);
            return false;
        }
        
        change["event"] = "*";  // Listen to all events (INSERT, UPDATE, DELETE)
        change["schema"] = schema;
        change["table"] = tables[i];
        if (!filter.isEmpty()) {
            change["filter"] = filter;
        }
        Serial.printf("[REALTIME] Adding subscription: %s.%s (filter: %s)\n",
                      schema.c_str(), tables[i].c_str(), 
                      filter.isEmpty() ? "none" : filter.c_str());
    }
    
    // Add access token for authorization
    payload["access_token"] = _accessToken;
    
    // Build Phoenix message
    String message = buildPhoenixMessage(_channelTopic, "phx_join", payload, _joinRef);
    
    // Validate message was built successfully
    if (message.isEmpty()) {
        Serial.println("[REALTIME] Failed to build Phoenix message");
        return false;
    }
    
    if (message.length() > 4096) {
        Serial.printf("[REALTIME] WARNING: Message very large (%zu bytes)\n", message.length());
    }
    
    Serial.printf("[REALTIME] Joining channel: %s\n", _channelTopic.c_str());
    if (_client) {
        esp_err_t err = esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
        if (err != ESP_OK) {
            Serial.printf("[REALTIME] Failed to send subscription message: %s\n", esp_err_to_name(err));
            return false;
        }
    } else {
        Serial.println("[REALTIME] WebSocket client is null");
        return false;
    }
    
    return true;
}

void SupabaseRealtime::unsubscribe() {
    if (!_connected || _channelTopic.isEmpty()) {
        return;
    }
    
    _msgRef++;
    
    JsonDocument emptyPayload;
    String message = buildPhoenixMessage(_channelTopic, "phx_leave", emptyPayload);
    if (_client) {
        esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
    }
    
    _subscribed = false;
    _channelTopic = "";
    
    Serial.println("[REALTIME] Unsubscribed from channel");
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
    _lastHeartbeatResponse = 0;
}

RealtimeMessage SupabaseRealtime::getMessage() {
    _messagePending = false;
    return _lastMessage;
}

String SupabaseRealtime::buildPhoenixMessage(const String& topic, const String& event,
                                              const JsonDocument& payload, int ref) {
    // Phoenix message format: [join_ref, ref, topic, event, payload]
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    
    if (event == "phx_join") {
        arr.add(_joinRef);
    } else {
        arr.add(nullptr);  // null for non-join messages
    }
    
    arr.add(ref > 0 ? ref : _msgRef);
    arr.add(topic);
    arr.add(event);
    arr.add(payload);
    
    String message;
    serializeJson(doc, message);
    return message;
}

bool SupabaseRealtime::parsePhoenixMessage(const String& message, String& topic,
                                            String& event, JsonDocument& payload,
                                            int& ref, int& joinRef) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, message);
    
    if (error) {
        Serial.printf("[REALTIME] Parse error: %s\n", error.c_str());
        return false;
    }
    
    if (!doc.is<JsonArray>() || doc.size() < 5) {
        Serial.println("[REALTIME] Invalid message format");
        return false;
    }
    
    JsonArray arr = doc.as<JsonArray>();
    
    // Handle null join_ref
    if (arr[0].is<int>()) {
        joinRef = arr[0].as<int>();
    } else {
        joinRef = 0;
    }
    
    // Handle null ref
    if (arr[1].is<int>()) {
        ref = arr[1].as<int>();
    } else {
        ref = 0;
    }
    
    topic = arr[2].as<String>();
    event = arr[3].as<String>();
    payload = arr[4];
    
    return true;
}

void SupabaseRealtime::sendHeartbeat() {
    _lastHeartbeat = millis();
    _msgRef++;
    
    JsonDocument emptyPayload;
    String message = buildPhoenixMessage("phoenix", "heartbeat", emptyPayload);
    if (_client) {
        esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
    }
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
        instance->_connected = true;
        instance->_lastHeartbeatResponse = millis();
        instance->_reconnectDelay = PHOENIX_RECONNECT_MIN_MS;
        return;
    }

    if (event_id == WEBSOCKET_EVENT_DISCONNECTED || event_id == WEBSOCKET_EVENT_CLOSED) {
        Serial.println("[REALTIME] Disconnected");
        instance->_connected = false;
        instance->_subscribed = false;
        return;
    }

    if (event_id == WEBSOCKET_EVENT_ERROR) {
        Serial.println("[REALTIME] Error");
        instance->_connected = false;
        instance->_subscribed = false;
        return;
    }

    if (event_id == WEBSOCKET_EVENT_DATA) {
        auto* data = static_cast<esp_websocket_event_data_t*>(event_data);
        if (!data || data->op_code != 0x1) {  // text frame
            return;
        }

        portENTER_CRITICAL(&instance->_rxMux);
        instance->_rxBuffer.concat(String(data->data_ptr, data->data_len));
        if (data->payload_offset + data->data_len >= data->payload_len) {
            instance->_pendingMessage = instance->_rxBuffer;
            instance->_rxBuffer = "";
            instance->_pendingMessageAvailable = true;
        }
        portEXIT_CRITICAL(&instance->_rxMux);
    }
}


void SupabaseRealtime::handlePhoenixMessage(const String& topic, const String& event,
                                             const JsonDocument& payload) {
    // Handle heartbeat response
    if (topic == "phoenix" && event == "phx_reply") {
        _lastHeartbeatResponse = millis();
        return;
    }
    
    // Handle channel join response
    if (event == "phx_reply" && topic == _channelTopic) {
        String status = payload["status"] | "error";
        if (status == "ok") {
            _subscribed = true;
            Serial.println("[REALTIME] Successfully joined channel");
        } else {
            Serial.printf("[REALTIME] Join failed: %s\n", status.c_str());
            String reason = payload["response"]["reason"] | "unknown";
            Serial.printf("[REALTIME] Reason: %s\n", reason.c_str());
        }
        return;
    }
    
    // Handle postgres_changes events
    if (event == "postgres_changes") {
        // Access data fields directly from const JsonDocument
        if (payload["data"].is<JsonObject>()) {
            _lastMessage.valid = true;
            _lastMessage.event = payload["data"]["type"].as<String>();  // INSERT, UPDATE, DELETE
            _lastMessage.table = payload["data"]["table"].as<String>();
            _lastMessage.schema = payload["data"]["schema"].as<String>();
            _lastMessage.payload = payload;
            _messagePending = true;
            
            Serial.printf("[REALTIME] %s on %s.%s\n", 
                          _lastMessage.event.c_str(),
                          _lastMessage.schema.c_str(),
                          _lastMessage.table.c_str());
            
            // Call handler if set
            if (_messageHandler) {
                _messageHandler(_lastMessage);
            }
        } else {
            Serial.println("[REALTIME] Invalid postgres_changes data format");
        }
        return;
    }
    
    // Handle broadcast events
    if (event == "broadcast") {
        _lastMessage.valid = true;
        _lastMessage.event = "broadcast";
        _lastMessage.table = "";
        _lastMessage.schema = "";
        _lastMessage.payload = payload;
        _messagePending = true;
        
        if (_messageHandler) {
            _messageHandler(_lastMessage);
        }
        return;
    }
    
    // Log other events for debugging
    if (event != "phx_reply") {
        Serial.printf("[REALTIME] Event: %s on %s\n", event.c_str(), topic.c_str());
    }
}

void SupabaseRealtime::attemptReconnect() {
    _lastReconnectAttempt = millis();
    
    // Exponential backoff
    _reconnectDelay = min(_reconnectDelay * 2, (unsigned long)PHOENIX_RECONNECT_MAX_MS);
    
    if (_supabaseUrl.isEmpty()) {
        return;
    }
    
    Serial.printf("[REALTIME] Reconnecting (next attempt in %lu ms)...\n", _reconnectDelay);
    if (ESP.getFreeHeap() < REALTIME_MIN_HEAP) {
        unsigned long now = millis();
        if (now - _lowHeapLogAt > REALTIME_LOW_HEAP_LOG_MS) {
            _lowHeapLogAt = now;
            Serial.printf("[REALTIME] Skipping reconnect - low heap (%lu < %lu)\n",
                          ESP.getFreeHeap(), (unsigned long)REALTIME_MIN_HEAP);
        }
        return;
    }
    
    disconnect();
    begin(_supabaseUrl, _anonKey, _accessToken);
}
