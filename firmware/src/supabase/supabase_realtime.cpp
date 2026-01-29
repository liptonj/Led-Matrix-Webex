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
#include <mbedtls/base64.h>
#include "../common/ca_certs.h"
#include "../config/config_manager.h"

extern ConfigManager config_manager;

// Global instance
SupabaseRealtime supabaseRealtime;

namespace {
constexpr uint32_t REALTIME_MIN_HEAP_FIRST = 60000;
constexpr uint32_t REALTIME_MIN_HEAP_STEADY = 45000;
constexpr uint32_t REALTIME_MIN_HEAP_FLOOR = 35000;
constexpr uint32_t REALTIME_LOW_HEAP_LOG_MS = 30000;

String urlEncode(const String& str) {
    String encoded = "";
    for (unsigned int i = 0; i < str.length(); i++) {
        char c = str.charAt(i);
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            encoded += c;
        } else {
            encoded += '%';
            if (c < 16) encoded += '0';
            char hex[3];
            sprintf(hex, "%02X", (unsigned char)c);
            encoded += hex;
        }
    }
    return encoded;
}

bool decodeJwtPayloadJson(const String& jwt, String& outJson, int* outErr, String* payloadSegmentOut) {
    int firstDot = jwt.indexOf('.');
    if (firstDot < 0) {
        return false;
    }
    int secondDot = jwt.indexOf('.', firstDot + 1);
    if (secondDot < 0) {
        return false;
    }

    String payload = jwt.substring(firstDot + 1, secondDot);
    
    // Store original for output
    if (payloadSegmentOut) {
        *payloadSegmentOut = payload;
    }
    
    // Base64url to base64 conversion:
    // 1. Replace '-' with '+' and '_' with '/'
    // 2. Add padding '=' to make length multiple of 4
    // Note: base64url doesn't use '=' padding, so we strip any existing '=' first
    String sanitized;
    sanitized.reserve(payload.length());
    for (size_t i = 0; i < payload.length(); i++) {
        char c = payload[i];
        // Base64url characters: A-Z, a-z, 0-9, '-', '_'
        // Skip any '=' characters that might be present (shouldn't be in base64url)
        if (c == '=') {
            continue;
        }
        if ((c >= 'A' && c <= 'Z') ||
            (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') ||
            c == '-' || c == '_') {
            sanitized += c;
        }
        // Skip any other characters (whitespace, etc.)
    }
    
    // Convert base64url to base64
    sanitized.replace('-', '+');
    sanitized.replace('_', '/');
    
    // Add padding
    int mod = sanitized.length() % 4;
    if (mod != 0) {
        int padLen = 4 - mod;
        for (int i = 0; i < padLen; i++) {
            sanitized += '=';
        }
    }

    size_t decodedLen = 0;
    int ret = mbedtls_base64_decode(nullptr, 0, &decodedLen,
                                    reinterpret_cast<const unsigned char*>(sanitized.c_str()),
                                    sanitized.length());
    if (outErr) {
        *outErr = ret;
    }
    if (ret != 0 || decodedLen == 0) {
        return false;
    }

    unsigned char* decoded = new unsigned char[decodedLen + 1];
    if (!decoded) {
        return false;
    }
    size_t outLen = 0;
    ret = mbedtls_base64_decode(decoded, decodedLen, &outLen,
                                reinterpret_cast<const unsigned char*>(sanitized.c_str()),
                                sanitized.length());
    if (outErr) {
        *outErr = ret;
    }
    if (ret != 0) {
        delete[] decoded;
        return false;
    }
    decoded[outLen] = '\0';
    outJson = String(reinterpret_cast<const char*>(decoded), outLen);
    delete[] decoded;
    return true;
}

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
    // Format: wss://{project}.supabase.co/realtime/v1/websocket?apikey={anon_key}&token={jwt_token}&vsn=1.0.0
    // For authenticated connections, Supabase Realtime requires:
    // 1. apikey: The anon/public key for initial connection
    // 2. token: The JWT access token for authenticated channel access (RLS policies)
    // URL-encode both to handle any special characters
    String encodedAnonKey = urlEncode(_anonKey);
    String encodedToken = urlEncode(_accessToken);
    String wsPath = "/realtime/v1/websocket?apikey=" + encodedAnonKey + "&token=" + encodedToken + "&vsn=1.0.0";
    
    Serial.printf("[REALTIME] Connecting to %s%s\n", host.c_str(), wsPath.c_str());
    Serial.printf("[REALTIME] Anon key length: %d (encoded: %d)\n", _anonKey.length(), encodedAnonKey.length());
    Serial.printf("[REALTIME] Token length: %d (encoded: %d)\n", _accessToken.length(), encodedToken.length());
    Serial.printf("[REALTIME] TLS context: time=%lu heap=%lu\n",
                  (unsigned long)time(nullptr), ESP.getFreeHeap());

    String uri = "wss://" + host + wsPath;
    esp_websocket_client_config_t config = {};
    _connecting = true;
    _connectStartMs = millis();
    config.uri = uri.c_str();
    config.disable_auto_reconnect = true;
    config.buffer_size = 4096;
    config.task_stack = 8192;  // TLS handshake needs extra stack on ESP32-S3
    config.user_context = this;
    config.ping_interval_sec = 0;
    _wsHeaders = "";
    config.headers = nullptr;
    config.subprotocol = nullptr;
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
        _connecting = false;
        Serial.println("[REALTIME] Failed to initialize websocket client");
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
        if (_client) {
            Serial.println("[REALTIME] Not connected yet - will queue subscription");
        } else {
            Serial.println("[REALTIME] Cannot subscribe - not connected");
            return false;
        }
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
    
    // Supabase Realtime expects an arbitrary channel name (must not be "realtime")
    _channelTopic = "display-db-changes";
    
    // Build join payload with postgres_changes config
    // ArduinoJson v7 handles memory allocation automatically
    JsonDocument payload;
    payload.to<JsonObject>();  // Ensure it's an object
    
    // Estimate required memory (rough estimate: ~200 bytes per table + overhead)
    // ArduinoJson will allocate as needed, but we check heap to ensure we have enough
    size_t estimatedSize = 512 + (tableCount * 200) + filter.length() + _accessToken.length();
    if (ESP.getFreeHeap() < estimatedSize + 10000) {  // Add 10KB buffer
        Serial.printf("[REALTIME] WARNING: Low heap (%lu bytes) for %d tables (estimated %zu bytes needed)\n",
                      ESP.getFreeHeap(), tableCount, estimatedSize);
        // Continue anyway - ArduinoJson will handle memory allocation
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
    
    const bool kIncludeFilter = true;  // Debug: set false to test without filter
    for (int i = 0; i < tableCount; i++) {
        JsonObject change = pgChanges.add<JsonObject>();
        if (change.isNull()) {
            Serial.printf("[REALTIME] Failed to add table %d to postgres_changes\n", i);
            return false;
        }
        
        change["event"] = "*";  // Listen to all events (INSERT, UPDATE, DELETE)
        change["schema"] = schema;
        change["table"] = tables[i];
        if (kIncludeFilter && !filter.isEmpty()) {
            change["filter"] = filter;
        }
        Serial.printf("[REALTIME] Adding subscription: %s.%s (filter: %s)\n",
                      schema.c_str(), tables[i].c_str(), 
                      (kIncludeFilter && !filter.isEmpty()) ? filter.c_str() : "none");
    }
    
    // Add access token for authorization
    payload["access_token"] = _accessToken;

    if (!_loggedJoinDetails) {
        String tableList;
        for (int i = 0; i < tableCount; i++) {
            if (i > 0) {
                tableList += ",";
            }
            tableList += tables[i];
        }
        Serial.printf("[REALTIME] Join details: schema=%s tables=%s filter=%s topic=%s token_len=%d\n",
                      schema.c_str(),
                      tableList.c_str(),
                      filter.isEmpty() ? "none" : filter.c_str(),
                      _channelTopic.c_str(),
                      _accessToken.length());
        Serial.printf("[REALTIME] Access token (full): %s\n", _accessToken.c_str());

        int dotCount = 0;
        for (size_t i = 0; i < _accessToken.length(); i++) {
            if (_accessToken[i] == '.') {
                dotCount++;
            }
        }
        Serial.printf("[REALTIME] Token structure: dots=%d starts_with_ey=%d\n",
                      dotCount, _accessToken.startsWith("ey") ? 1 : 0);

        String claimsJson;
        int decodeErr = 0;
        String payloadSegment;
        if (dotCount >= 2 && decodeJwtPayloadJson(_accessToken, claimsJson, &decodeErr, &payloadSegment)) {
            JsonDocument claimsDoc;
            DeserializationError err = deserializeJson(claimsDoc, claimsJson);
            if (!err) {
                String role = claimsDoc["role"] | "";
                String tokenType = claimsDoc["token_type"] | "";
                String pairingCode = claimsDoc["pairing_code"] | "";
                String sub = claimsDoc["sub"] | "";
                long exp = claimsDoc["exp"] | 0;
                Serial.printf("[REALTIME] JWT claims: role=%s token_type=%s pairing_code=%s sub=%s exp=%ld\n",
                              role.isEmpty() ? "?" : role.c_str(),
                              tokenType.isEmpty() ? "?" : tokenType.c_str(),
                              pairingCode.isEmpty() ? "?" : pairingCode.c_str(),
                              sub.isEmpty() ? "?" : sub.c_str(),
                              exp);
            } else {
                Serial.printf("[REALTIME] JWT decode failed: %s\n", err.c_str());
            }
        } else {
            Serial.printf("[REALTIME] JWT decode failed: unable to parse token payload (err=%d payload_len=%d)\n",
                          decodeErr, payloadSegment.length());
            if (!payloadSegment.isEmpty()) {
                Serial.printf("[REALTIME] JWT payload segment (base64url, sanitized): %s\n",
                              payloadSegment.c_str());
            }
        }
        _loggedJoinDetails = true;
    }
    
    String payloadJson;
    serializeJson(payload, payloadJson);
    Serial.printf("[REALTIME] Join payload: %s\n", payloadJson.c_str());

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
    
    // Debug: log first 500 chars of message for troubleshooting
    if (!_loggedJoinDetails) {
        String msgPreview = message.substring(0, 500);
        Serial.printf("[REALTIME] Join message preview (%zu bytes): %s%s\n",
                      message.length(), msgPreview.c_str(),
                      message.length() > 500 ? "..." : "");
    }
    
    Serial.printf("[REALTIME] Joining channel: %s\n", _channelTopic.c_str());
    if (!_client) {
        Serial.println("[REALTIME] WebSocket client is null");
        return false;
    }
    if (!esp_websocket_client_is_connected(_client)) {
        _pendingJoinMessage = message;
        _pendingJoin = true;
        Serial.println("[REALTIME] WebSocket not connected - queued subscription");
        return true;
    }

    int sent = esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
    if (sent < 0) {
        Serial.printf("[REALTIME] Failed to send subscription message (ret=%d)\n", sent);
        _pendingJoinMessage = message;
        _pendingJoin = true;
        return false;
    }
    _pendingJoin = false;
    _pendingJoinMessage = "";

    return true;
}

void SupabaseRealtime::unsubscribe() {
    if (!_connected || _channelTopic.isEmpty()) {
        return;
    }
    
    _msgRef++;
    
    JsonDocument emptyPayload;
    String message = buildPhoenixMessage(_channelTopic, "phx_leave", emptyPayload);
    if (_client && esp_websocket_client_is_connected(_client)) {
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
    _connecting = false;
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
    if (_client && esp_websocket_client_is_connected(_client)) {
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
                Serial.printf("[REALTIME] Failed to send queued subscription (ret=%d)\n", sent);
            } else {
                Serial.printf("[REALTIME] Sent queued subscription (%d bytes)\n", sent);
                instance->_pendingJoin = false;
                instance->_pendingJoinMessage = "";
            }
        }
        return;
    }

    if (event_id == WEBSOCKET_EVENT_DISCONNECTED || event_id == WEBSOCKET_EVENT_CLOSED) {
        if (instance->_connected) {
            Serial.println("[REALTIME] Disconnected (was connected)");
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
        Serial.printf("[REALTIME] WebSocket error event (event_id=%ld)\n", (long)event_id);
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
            Serial.printf("[REALTIME] Join failed: status=%s\n", status.c_str());
            
            // Try to extract error details
            if (payload["response"].is<JsonObject>()) {
                String reason = payload["response"]["reason"] | "unknown";
                Serial.printf("[REALTIME] Reason: %s\n", reason.c_str());
                
                // Log full response for debugging
                String responseStr;
                serializeJson(payload["response"], responseStr);
                Serial.printf("[REALTIME] Full response: %s\n", responseStr.c_str());
            } else {
                // Log entire payload if response structure is unexpected
                String payloadStr;
                serializeJson(payload, payloadStr);
                Serial.printf("[REALTIME] Join error payload: %s\n", payloadStr.c_str());
            }
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
    uint32_t minHeap = minHeapRequired();
    if (ESP.getFreeHeap() < minHeap) {
        unsigned long now = millis();
        if (now - _lowHeapLogAt > REALTIME_LOW_HEAP_LOG_MS) {
            _lowHeapLogAt = now;
            Serial.printf("[REALTIME] Skipping reconnect - low heap (%lu < %lu)\n",
                          ESP.getFreeHeap(), (unsigned long)minHeap);
        }
        return;
    }
    
    disconnect();
    begin(_supabaseUrl, _anonKey, _accessToken);
}

uint32_t SupabaseRealtime::minHeapRequired() const {
    uint32_t required = _hasConnected ? _minHeapSteady : _minHeapFirstConnect;
    if (required < _minHeapFloor) {
        required = _minHeapFloor;
    }
    return required;
}
