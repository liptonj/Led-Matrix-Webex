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

// Global instance
SupabaseRealtime supabaseRealtime;

// Global pointer for callback
static SupabaseRealtime* g_realtime_instance = nullptr;

SupabaseRealtime::SupabaseRealtime()
    : _connected(false), _subscribed(false), _messagePending(false),
      _joinRef(0), _msgRef(0), _lastHeartbeat(0), _lastHeartbeatResponse(0),
      _reconnectDelay(PHOENIX_RECONNECT_MIN_MS), _lastReconnectAttempt(0),
      _messageHandler(nullptr) {
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
    
    g_realtime_instance = this;
    
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
    
    // Set up WebSocket event handler
    _wsClient.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_realtime_instance) {
            g_realtime_instance->onWebSocketEvent(type, payload, length);
        }
    });
    
    // Connect with SSL
    _wsClient.beginSSL(host.c_str(), 443, wsPath.c_str(), CA_CERT_BUNDLE_SUPABASE);
    _wsClient.setReconnectInterval(0);  // We handle reconnection manually
    _wsClient.enableHeartbeat(0, 0, 0);  // We handle heartbeat via Phoenix protocol
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
    _wsClient.loop();
    
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
    
    if (tableCount <= 0) {
        Serial.println("[REALTIME] No tables specified");
        return false;
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
    JsonDocument payload;
    JsonObject config = payload["config"].to<JsonObject>();
    config["broadcast"]["self"] = false;
    config["presence"]["key"] = "";
    
    // Add postgres_changes subscription for each table
    JsonArray pgChanges = config["postgres_changes"].to<JsonArray>();
    for (int i = 0; i < tableCount; i++) {
        JsonObject change = pgChanges.add<JsonObject>();
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
    
    String message = buildPhoenixMessage(_channelTopic, "phx_join", payload, _joinRef);
    
    Serial.printf("[REALTIME] Joining channel: %s\n", _channelTopic.c_str());
    _wsClient.sendTXT(message);
    
    return true;
}

void SupabaseRealtime::unsubscribe() {
    if (!_connected || _channelTopic.isEmpty()) {
        return;
    }
    
    _msgRef++;
    
    JsonDocument emptyPayload;
    String message = buildPhoenixMessage(_channelTopic, "phx_leave", emptyPayload);
    _wsClient.sendTXT(message);
    
    _subscribed = false;
    _channelTopic = "";
    
    Serial.println("[REALTIME] Unsubscribed from channel");
}

void SupabaseRealtime::disconnect() {
    unsubscribe();
    _wsClient.disconnect();
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
    _wsClient.sendTXT(message);
}

void SupabaseRealtime::onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("[REALTIME] Disconnected");
            _connected = false;
            _subscribed = false;
            break;
            
        case WStype_CONNECTED:
            Serial.println("[REALTIME] Connected");
            _connected = true;
            _lastHeartbeatResponse = millis();
            _reconnectDelay = PHOENIX_RECONNECT_MIN_MS;  // Reset backoff
            break;
            
        case WStype_TEXT: {
            String message = String((char*)payload, length);
            
            String topic, event;
            JsonDocument payloadDoc;
            int ref, joinRef;
            
            if (parsePhoenixMessage(message, topic, event, payloadDoc, ref, joinRef)) {
                handlePhoenixMessage(topic, event, payloadDoc);
            }
            break;
        }
        
        case WStype_PING:
        case WStype_PONG:
            // Handled automatically by library
            break;
            
        case WStype_ERROR:
            Serial.printf("[REALTIME] Error: %.*s\n", (int)length, payload ? (char*)payload : "unknown");
            break;
            
        default:
            break;
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
        JsonObject data = payload["data"];
        
        _lastMessage.valid = true;
        _lastMessage.event = data["type"].as<String>();  // INSERT, UPDATE, DELETE
        _lastMessage.table = data["table"].as<String>();
        _lastMessage.schema = data["schema"].as<String>();
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
    
    // Re-extract host and connect
    String host = _supabaseUrl;
    if (host.startsWith("https://")) {
        host = host.substring(8);
    }
    int slashIdx = host.indexOf('/');
    if (slashIdx > 0) {
        host = host.substring(0, slashIdx);
    }
    
    String wsPath = "/realtime/v1/websocket?apikey=" + _anonKey + "&vsn=1.0.0";
    _wsClient.beginSSL(host.c_str(), 443, wsPath.c_str(), CA_CERT_BUNDLE_SUPABASE);
}
