/**
 * @file phoenix_protocol.cpp
 * @brief Phoenix Channels Protocol Implementation
 *
 * Handles Phoenix Channels protocol message construction, parsing, and channel subscriptions.
 * See supabase_realtime.cpp for WebSocket connection management.
 */

#include "supabase_realtime.h"
#include "../config/config_manager.h"
#include "../debug/remote_logger.h"
#include "../core/dependencies.h"

namespace {
String buildRedactedJoinPayload(const JsonDocument& payload) {
    JsonDocument copy;
    copy.set(payload);
    if (copy["access_token"].is<const char*>()) {
        copy["access_token"] = "<redacted>";
    }
    String out;
    serializeJson(copy, out);
    return out;
}
}  // namespace

String SupabaseRealtime::buildPhoenixMessage(const String& topic, const String& event,
                                              const JsonDocument& payload, int ref) {
    // Supabase Realtime protocol (v2) message format (object)
    // { topic, event, payload, ref, join_ref }
    JsonDocument doc;
    doc["topic"] = topic;
    doc["event"] = event;
    doc["payload"] = payload;

    int msgRef = (ref > 0 ? ref : _msgRef);
    doc["ref"] = String(msgRef);

    bool includeJoinRef = (event == "phx_join") || (event == "access_token") ||
                          (event == "broadcast") || (event == "presence") ||
                          (event == "phx_leave");
    if (includeJoinRef && _joinRef > 0) {
        doc["join_ref"] = String(_joinRef);
    }

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
        RLOG_ERROR("realtime", "Parse error: %s", error.c_str());
        return false;
    }

    if (doc.is<JsonObject>()) {
        topic = doc["topic"] | "";
        event = doc["event"] | "";
        payload = doc["payload"];

        if (doc["ref"].is<const char*>()) {
            ref = atoi(doc["ref"].as<const char*>());
        } else if (doc["ref"].is<int>()) {
            ref = doc["ref"].as<int>();
        } else {
            ref = 0;
        }

        if (doc["join_ref"].is<const char*>()) {
            joinRef = atoi(doc["join_ref"].as<const char*>());
        } else if (doc["join_ref"].is<int>()) {
            joinRef = doc["join_ref"].as<int>();
        } else {
            joinRef = 0;
        }
        return true;
    }

    // Legacy Phoenix array format: [join_ref, ref, topic, event, payload]
    if (!doc.is<JsonArray>() || doc.size() < 5) {
        Serial.println("[REALTIME] Invalid message format");
        return false;
    }
    
    JsonArray arr = doc.as<JsonArray>();
    
    if (arr[0].is<int>()) {
        joinRef = arr[0].as<int>();
    } else {
        joinRef = 0;
    }
    
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
        Serial.printf("[REALTIME] Sending heartbeat (ref=%d)\n", _msgRef);
        esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
    }

    if (_privateChannel) {
        sendAccessToken();
    }
}

void SupabaseRealtime::sendAccessToken() {
    if (!_client || !esp_websocket_client_is_connected(_client)) {
        return;
    }
    if (_accessToken.isEmpty() || _channelTopic.isEmpty()) {
        return;
    }
    _msgRef++;
    JsonDocument payload;
    payload["access_token"] = _accessToken;
    String message = buildPhoenixMessage(_channelTopic, "access_token", payload, _msgRef);
    esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
}

bool SupabaseRealtime::subscribe(const String& schema, const String& table,
                                  const String& filter) {
    // Delegate to subscribeMultiple for single table
    const String tables[] = { table };
    return subscribeMultiple(schema, tables, 1, filter);
}

bool SupabaseRealtime::subscribeBroadcast() {
    _privateChannel = true;
    return subscribeMultiple("", nullptr, 0, "", false);
}

bool SupabaseRealtime::subscribeToUserChannel(const String& user_uuid) {
    if (user_uuid.isEmpty()) {
        Serial.println("[REALTIME] Cannot subscribe to user channel - user_uuid is empty");
        return false;
    }
    
    // Set channel topic to realtime:user:{user_uuid}
    String channelTopic = "realtime:user:" + user_uuid;
    setChannelTopic(channelTopic);
    
    Serial.printf("[REALTIME] Subscribing to user channel: %s\n", channelTopic.c_str());
    
    // Subscribe as private broadcast channel (no postgres_changes)
    _privateChannel = true;
    return subscribeMultiple("", nullptr, 0, "", false);
}

bool SupabaseRealtime::subscribeMultiple(const String& schema, const String tables[],
                                          int tableCount, const String& filter,
                                          bool includePostgresChanges) {
    if (!_connected) {
        if (_client) {
            Serial.println("[REALTIME] Not connected yet - will queue subscription");
        } else {
            Serial.println("[REALTIME] Cannot subscribe - not connected");
            return false;
        }
    }
    
    // Validate inputs
    if (includePostgresChanges) {
        _privateChannel = false;
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
    }
    
    // Check heap before proceeding (need at least 20KB for JSON operations)
    const uint32_t min_heap = 20000;
    if (ESP.getFreeHeap() < min_heap) {
        Serial.printf("[REALTIME] Insufficient heap for subscription (%lu < %lu)\n",
                      ESP.getFreeHeap(), (unsigned long)min_heap);
        return false;
    }
    
    // Validate all table names before processing
    if (includePostgresChanges) {
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
    }
    
    _joinRef++;
    _msgRef++;
    
    // Supabase Realtime expects an arbitrary channel name (must not be "realtime")
    if (_channelTopic.isEmpty() || _channelTopic == "realtime") {
        _channelTopic = "display-db-changes";
    }
    
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
        RLOG_ERROR("realtime", "Failed to create config object");
        return false;
    }
    
    config["broadcast"]["self"] = false;
    config["presence"]["key"] = "";
    if (_privateChannel) {
        config["private"] = true;
    }
    
    if (includePostgresChanges) {
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
    }
    
    // Add access token for authorization
    payload["access_token"] = _accessToken;

    if (!_loggedJoinDetails) {
        String tableList = "none";
        if (includePostgresChanges) {
            tableList = "";
            for (int i = 0; i < tableCount; i++) {
                if (i > 0) {
                    tableList += ",";
                }
                tableList += tables[i];
            }
        }
        Serial.printf("[REALTIME] Join details: schema=%s tables=%s filter=%s topic=%s token_len=%d\n",
                      includePostgresChanges ? schema.c_str() : "none",
                      tableList.c_str(),
                      (includePostgresChanges && !filter.isEmpty()) ? filter.c_str() : "none",
                      _channelTopic.c_str(),
                      _accessToken.length());
        _loggedJoinDetails = true;
    }
    
    String payloadJson = buildRedactedJoinPayload(payload);
    Serial.printf("[REALTIME] Join payload (redacted): %s\n", payloadJson.c_str());

    // Build Phoenix message
    String message = buildPhoenixMessage(_channelTopic, "phx_join", payload, _joinRef);
    String payloadFull;
    serializeJson(payload, payloadFull);
    _lastJoinPayload = payloadFull;
    
    // Validate message was built successfully
    if (message.isEmpty()) {
        RLOG_ERROR("realtime", "Failed to build Phoenix message");
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
        RLOG_ERROR("realtime", "Failed to send subscription message: %d", sent);
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
    
    Serial.println("[REALTIME] Unsubscribed from channel");
}

void SupabaseRealtime::handlePhoenixMessage(const String& topic, const String& event,
                                             const JsonDocument& payload) {
    // Any valid message indicates the socket is alive.
    _lastHeartbeatResponse = millis();

    // Handle heartbeat response
    if (topic == "phoenix" && event == "phx_reply") {
        Serial.println("[REALTIME] Heartbeat reply received");
        return;
    }
    
    // Handle channel join response
    if (event == "phx_reply" && topic == _channelTopic) {
        String status = payload["status"] | "error";
        if (status == "ok") {
            _subscribed = true;
            Serial.println("[REALTIME] Successfully joined channel");
            auto& deps = getDependencies();
            if (deps.config.getPairingRealtimeDebug()) {
                String responseStr;
                if (payload["response"].is<JsonObject>()) {
                    serializeJson(payload["response"], responseStr);
                } else {
                    serializeJson(payload, responseStr);
                }
                Serial.printf("[REALTIME] Join ok response: %s\n", responseStr.c_str());
            }
        } else {
            RLOG_ERROR("realtime", "Join failed: status=%s", status.c_str());
            
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
        auto& deps = getDependencies();
        if (deps.config.getPairingRealtimeDebug()) {
            String payloadStr;
            serializeJson(payload, payloadStr);
            Serial.printf("[REALTIME] postgres_changes inbound: %s\n", payloadStr.c_str());
        }
        JsonVariantConst dataVar;
        if (payload["data"].is<JsonObjectConst>()) {
            dataVar = payload["data"];
        } else if (payload["data"].is<JsonArrayConst>()) {
            JsonArrayConst dataArr = payload["data"].as<JsonArrayConst>();
            if (!dataArr.isNull() && dataArr.size() > 0 && dataArr[0].is<JsonObjectConst>()) {
                dataVar = dataArr[0];
                Serial.printf("[REALTIME] postgres_changes array size=%d (using first)\n",
                              dataArr.size());
            }
        } else if (payload.is<JsonObjectConst>() &&
                   (payload["schema"].is<const char*>() || payload["table"].is<const char*>())) {
            dataVar = payload.as<JsonObjectConst>();
        }

        // Access data fields directly from const JsonDocument
        if (!dataVar.isNull() && dataVar.is<JsonObjectConst>()) {
            JsonObjectConst dataObj = dataVar.as<JsonObjectConst>();
            _lastMessage.valid = true;
            _lastMessage.event = dataObj["type"] | dataObj["eventType"] | "";
            _lastMessage.table = dataObj["table"] | dataObj["relation"] | "";
            _lastMessage.schema = dataObj["schema"] | "";
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
            String payloadStr;
            serializeJson(payload, payloadStr);
            Serial.printf("[REALTIME] postgres_changes payload: %s\n", payloadStr.c_str());
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
