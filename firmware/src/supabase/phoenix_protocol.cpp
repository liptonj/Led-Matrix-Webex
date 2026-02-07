/**
 * @file phoenix_protocol.cpp
 * @brief Phoenix Channels Protocol Implementation
 *
 * Handles Phoenix Channels protocol message construction, parsing, and channel subscriptions.
 * See supabase_realtime.cpp for WebSocket connection management.
 */

#include "supabase_realtime.h"
#include "../config/config_manager.h"
#include "../debug/log_system.h"
#include "../core/dependencies.h"

static const char* TAG = "PHOENIX";

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
        ESP_LOGE(TAG, "Parse error: %s", error.c_str());
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
        ESP_LOGW(TAG, "Invalid message format");
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
        ESP_LOGD(TAG, "Sending heartbeat (ref=%d)", _msgRef);
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
    if (_accessToken.isEmpty()) {
        return;
    }
    
    // Send access token to all private channels
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].privateChannel && !_channels[i].topic.isEmpty()) {
            _msgRef++;
            JsonDocument payload;
            payload["access_token"] = _accessToken;
            String message = buildPhoenixMessage(_channels[i].topic, "access_token", payload, _msgRef);
            esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
        }
    }
    
    // Legacy fallback: send to _channelTopic if no channels registered
    if (_channelCount == 0 && !_channelTopic.isEmpty() && _privateChannel) {
        _msgRef++;
        JsonDocument payload;
        payload["access_token"] = _accessToken;
        String message = buildPhoenixMessage(_channelTopic, "access_token", payload, _msgRef);
        esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
    }
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
        ESP_LOGW(TAG, "Cannot subscribe to user channel - user_uuid is empty");
        return false;
    }
    
    // Set channel topic to realtime:user:{user_uuid}
    // The "realtime:" prefix is REQUIRED by the Supabase Realtime Phoenix protocol.
    // The JS SDK does the same: supabase.channel('user:UUID') internally creates
    // the channel with topic "realtime:user:UUID" and sends it in the join message.
    // The server only routes topics starting with "realtime:".
    // RLS helper realtime.topic() strips this prefix, returning just "user:UUID".
    String channelTopic = "realtime:user:" + user_uuid;
    setChannelTopic(channelTopic);
    
    ESP_LOGI(TAG, "Subscribing to user channel: %s", channelTopic.c_str());
    
    // Subscribe as private broadcast channel (no postgres_changes)
    _privateChannel = true;
    return subscribeMultiple("", nullptr, 0, "", false);
}

bool SupabaseRealtime::subscribeMultiple(const String& schema, const String tables[],
                                          int tableCount, const String& filter,
                                          bool includePostgresChanges) {
    if (!_connected) {
        if (_client) {
            ESP_LOGI(TAG, "Not connected yet - will queue subscription");
        } else {
            ESP_LOGW(TAG, "Cannot subscribe - not connected");
            return false;
        }
    }
    
    // Validate inputs
    if (includePostgresChanges) {
        _privateChannel = false;
        if (tableCount <= 0 || tableCount > 10) {
            ESP_LOGW(TAG, "Invalid table count: %d (must be 1-10)", tableCount);
            return false;
        }
        
        if (tables == nullptr) {
            ESP_LOGW(TAG, "Tables array is null");
            return false;
        }
        
        if (schema.isEmpty()) {
            ESP_LOGW(TAG, "Schema is empty");
            return false;
        }
    }
    
    // Check heap before proceeding (need at least 20KB for JSON operations)
    const uint32_t min_heap = 20000;
    if (ESP.getFreeHeap() < min_heap) {
        ESP_LOGW(TAG, "Insufficient heap for subscription (%lu < %lu)",
                 ESP.getFreeHeap(), (unsigned long)min_heap);
        return false;
    }
    
    // Validate all table names before processing
    if (includePostgresChanges) {
        for (int i = 0; i < tableCount; i++) {
            if (tables[i].isEmpty()) {
                ESP_LOGW(TAG, "Table %d is empty", i);
                return false;
            }
            if (tables[i].length() > 64) {
                ESP_LOGW(TAG, "Table name too long: %s", tables[i].c_str());
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
        ESP_LOGW(TAG, "WARNING: Low heap (%lu bytes) for %d tables (estimated %zu bytes needed)",
                 ESP.getFreeHeap(), tableCount, estimatedSize);
        // Continue anyway - ArduinoJson will handle memory allocation
    }
    
    JsonObject config = payload["config"].to<JsonObject>();
    if (config.isNull()) {
        ESP_LOGE(TAG, "Failed to create config object");
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
            ESP_LOGW(TAG, "Failed to create postgres_changes array");
            return false;
        }
        
        const bool kIncludeFilter = true;  // Debug: set false to test without filter
        for (int i = 0; i < tableCount; i++) {
            JsonObject change = pgChanges.add<JsonObject>();
            if (change.isNull()) {
                ESP_LOGW(TAG, "Failed to add table %d to postgres_changes", i);
                return false;
            }
            
            change["event"] = "*";  // Listen to all events (INSERT, UPDATE, DELETE)
            change["schema"] = schema;
            change["table"] = tables[i];
            if (kIncludeFilter && !filter.isEmpty()) {
                change["filter"] = filter;
            }
            ESP_LOGI(TAG, "Adding subscription: %s.%s (filter: %s)",
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
        ESP_LOGI(TAG, "Join details: schema=%s tables=%s filter=%s topic=%s token_len=%d",
                 includePostgresChanges ? schema.c_str() : "none",
                 tableList.c_str(),
                 (includePostgresChanges && !filter.isEmpty()) ? filter.c_str() : "none",
                 _channelTopic.c_str(),
                 _accessToken.length());
        _loggedJoinDetails = true;
    }
    
    String payloadJson = buildRedactedJoinPayload(payload);
    ESP_LOGD(TAG, "Join payload (redacted): %s", payloadJson.c_str());

    // Build Phoenix message
    String message = buildPhoenixMessage(_channelTopic, "phx_join", payload, _joinRef);
    String payloadFull;
    serializeJson(payload, payloadFull);
    _lastJoinPayload = payloadFull;
    
    // Validate message was built successfully
    if (message.isEmpty()) {
        ESP_LOGE(TAG, "Failed to build Phoenix message");
        return false;
    }
    
    if (message.length() > 4096) {
        ESP_LOGW(TAG, "WARNING: Message very large (%zu bytes)", message.length());
    }
    
    // Debug: log first 500 chars of message for troubleshooting
    if (!_loggedJoinDetails) {
        String msgPreview = message.substring(0, 500);
        ESP_LOGD(TAG, "Join message preview (%zu bytes): %s%s",
                 message.length(), msgPreview.c_str(),
                 message.length() > 500 ? "..." : "");
    }
    
    ESP_LOGI(TAG, "Joining channel: %s", _channelTopic.c_str());
    if (!_client) {
        ESP_LOGW(TAG, "WebSocket client is null");
        return false;
    }
    if (!esp_websocket_client_is_connected(_client)) {
        _pendingJoinMessage = message;
        _pendingJoin = true;
        ESP_LOGI(TAG, "WebSocket not connected - queued subscription");
        return true;
    }

    int sent = esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
    if (sent < 0) {
        ESP_LOGE(TAG, "Failed to send subscription message: %d", sent);
        _pendingJoinMessage = message;
        _pendingJoin = true;
        return false;
    }
    _pendingJoin = false;
    _pendingJoinMessage = "";

    return true;
}

void SupabaseRealtime::unsubscribe() {
    if (!_connected) {
        return;
    }
    
    // Leave all subscribed channels
    JsonDocument emptyPayload;
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].subscribed && !_channels[i].topic.isEmpty()) {
            _msgRef++;
            String message = buildPhoenixMessage(_channels[i].topic, "phx_leave", emptyPayload);
            if (_client && esp_websocket_client_is_connected(_client)) {
                esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
            }
            _channels[i].subscribed = false;
        }
    }
    
    // Legacy fallback: leave _channelTopic if set
    if (!_channelTopic.isEmpty()) {
        _msgRef++;
        String message = buildPhoenixMessage(_channelTopic, "phx_leave", emptyPayload);
        if (_client && esp_websocket_client_is_connected(_client)) {
            esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
        }
    }
    
    _subscribed = false;
    
    ESP_LOGI(TAG, "Unsubscribed from channels");
}

bool SupabaseRealtime::sendBroadcast(const String& topic, const String& event, const JsonDocument& data) {
    if (!_connected) {
        return false;
    }
    
    // Check if channel is subscribed
    const ChannelState* channel = findChannel(topic);
    if (channel == nullptr || !channel->subscribed) {
        ESP_LOGW(TAG, "Cannot send broadcast - channel not subscribed: %s", topic.c_str());
        return false;
    }
    
    if (!_client || !esp_websocket_client_is_connected(_client)) {
        return false;
    }
    
    // Check heap before JSON allocation
    if (ESP.getFreeHeap() < 20000) {
        ESP_LOGW(TAG, "Insufficient heap for broadcast: %d bytes free", ESP.getFreeHeap());
        return false;
    }
    
    // Increment message reference
    _msgRef++;
    
    // Build broadcast payload: { event: "...", payload: {...} }
    JsonDocument broadcastPayload;
    broadcastPayload["event"] = event;
    broadcastPayload["payload"] = data;
    
    // Build Phoenix message with "broadcast" event
    String message = buildPhoenixMessage(topic, "broadcast", broadcastPayload, _msgRef);
    
    if (message.isEmpty()) {
        ESP_LOGW(TAG, "Failed to build broadcast message");
        return false;
    }
    
    int sent = esp_websocket_client_send_text(_client, message.c_str(), 
                                              message.length(), portMAX_DELAY);
    
    if (sent < 0) {
        ESP_LOGW(TAG, "Failed to send broadcast: %d", sent);
        return false;
    }
    
    return true;
}

bool SupabaseRealtime::sendBroadcast(const String& event, const JsonDocument& data) {
    // Backward compatibility: use first channel's topic or legacy _channelTopic
    String topic;
    if (_channelCount > 0 && !_channels[0].topic.isEmpty()) {
        topic = _channels[0].topic;
    } else if (!_channelTopic.isEmpty()) {
        topic = _channelTopic;
    } else {
        ESP_LOGW(TAG, "Cannot send broadcast - no channel topic available");
        return false;
    }
    
    return sendBroadcast(topic, event, data);
}

void SupabaseRealtime::handlePhoenixMessage(const String& topic, const String& event,
                                             const JsonDocument& payload) {
    // Any valid message indicates the socket is alive.
    _lastHeartbeatResponse = millis();

    // Handle heartbeat response
    if (topic == "phoenix" && event == "phx_reply") {
        ESP_LOGD(TAG, "Heartbeat reply received");
        return;
    }
    
    // Handle channel join response - route by topic
    if (event == "phx_reply") {
        ChannelState* channel = findChannel(topic);
        if (channel != nullptr) {
            String status = payload["status"] | "error";
            if (status == "ok") {
                channel->subscribed = true;
                _subscribed = true;  // Legacy flag for backward compatibility
                ESP_LOGI(TAG, "Successfully joined channel: %s", topic.c_str());
                auto& deps = getDependencies();
                if (deps.config.getPairingRealtimeDebug()) {
                    String responseStr;
                    if (payload["response"].is<JsonObject>()) {
                        serializeJson(payload["response"], responseStr);
                    } else {
                        serializeJson(payload, responseStr);
                    }
                    ESP_LOGD(TAG, "Join ok response: %s", responseStr.c_str());
                }
            } else {
                ESP_LOGE(TAG, "Join failed for channel %s: status=%s", topic.c_str(), status.c_str());
                
                // Try to extract error details
                if (payload["response"].is<JsonObject>()) {
                    String reason = payload["response"]["reason"] | "unknown";
                    ESP_LOGE(TAG, "Join failed reason: %s", reason.c_str());
                    
                    // Log full response for debugging
                    String responseStr;
                    serializeJson(payload["response"], responseStr);
                    ESP_LOGD(TAG, "Full response: %s", responseStr.c_str());
                } else {
                    // Log entire payload if response structure is unexpected
                    String payloadStr;
                    serializeJson(payload, payloadStr);
                    ESP_LOGE(TAG, "Join error payload: %s", payloadStr.c_str());
                }
            }
            return;
        }
        // Legacy fallback: check _channelTopic for backward compatibility
        if (topic == _channelTopic) {
            String status = payload["status"] | "error";
            if (status == "ok") {
                _subscribed = true;
                ESP_LOGI(TAG, "Successfully joined channel (legacy)");
            } else {
                ESP_LOGE(TAG, "Join failed: status=%s", status.c_str());
            }
            return;
        }
    }
    
    // Handle presence events - server only sends these after a successful join.
    // This acts as a fallback subscription confirmation in case the join reply
    // (phx_reply with status "ok") was lost due to the message queue race condition.
    if (event == "presence_state" || event == "presence_diff") {
        ChannelState* channel = findChannel(topic);
        if (channel != nullptr && !channel->subscribed) {
            channel->subscribed = true;
            _subscribed = true;  // Legacy flag
            ESP_LOGI(TAG, "Subscribed (confirmed via presence event): %s", topic.c_str());
            return;
        }
        // Legacy fallback
        if (topic == _channelTopic && !_subscribed) {
            _subscribed = true;
            ESP_LOGI(TAG, "Subscribed (confirmed via presence event - legacy)");
            return;
        }
    }

    // Handle postgres_changes events
    if (event == "postgres_changes") {
        auto& deps = getDependencies();
        if (deps.config.getPairingRealtimeDebug()) {
            String payloadStr;
            serializeJson(payload, payloadStr);
                ESP_LOGD(TAG, "postgres_changes inbound: %s", payloadStr.c_str());
        }
        JsonVariantConst dataVar;
        if (payload["data"].is<JsonObjectConst>()) {
            dataVar = payload["data"];
        } else if (payload["data"].is<JsonArrayConst>()) {
            JsonArrayConst dataArr = payload["data"].as<JsonArrayConst>();
            if (!dataArr.isNull() && dataArr.size() > 0 && dataArr[0].is<JsonObjectConst>()) {
                dataVar = dataArr[0];
                ESP_LOGD(TAG, "postgres_changes array size=%d (using first)", dataArr.size());
            }
        } else if (payload.is<JsonObjectConst>() &&
                   (payload["schema"].is<const char*>() || payload["table"].is<const char*>())) {
            dataVar = payload.as<JsonObjectConst>();
        }

        // Access data fields directly from const JsonDocument
        if (!dataVar.isNull() && dataVar.is<JsonObjectConst>()) {
            JsonObjectConst dataObj = dataVar.as<JsonObjectConst>();
            _lastMessage.valid = true;
            _lastMessage.topic = topic;  // Set topic for routing
            _lastMessage.event = dataObj["type"] | dataObj["eventType"] | "";
            _lastMessage.table = dataObj["table"] | dataObj["relation"] | "";
            _lastMessage.schema = dataObj["schema"] | "";
            _lastMessage.payload = payload;
            _messagePending = true;
            
            ESP_LOGD(TAG, "%s on %s.%s (channel: %s)",
                     _lastMessage.event.c_str(),
                     _lastMessage.schema.c_str(),
                     _lastMessage.table.c_str(),
                     topic.c_str());
            
            // Call handler if set
            if (_messageHandler) {
                _messageHandler(_lastMessage);
            }
        } else {
            ESP_LOGW(TAG, "Invalid postgres_changes data format");
            String payloadStr;
            serializeJson(payload, payloadStr);
            ESP_LOGD(TAG, "postgres_changes payload: %s", payloadStr.c_str());
        }
        return;
    }
    
    // Handle broadcast events
    if (event == "broadcast") {
        _lastMessage.valid = true;
        _lastMessage.topic = topic;  // Set topic for routing
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
        ESP_LOGD(TAG, "Event: %s on %s", event.c_str(), topic.c_str());
    }
}
