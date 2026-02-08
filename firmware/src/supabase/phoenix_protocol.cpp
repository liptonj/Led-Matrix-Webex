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

String SupabaseRealtime::buildPhoenixMessage(const String& topic, const String& event,
                                              const JsonDocument& payload, int ref) {
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

    // Phoenix array format: [join_ref, ref, topic, event, payload]
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

    // Refresh access token on all private channels
    bool hasPrivate = false;
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].privateChannel) {
            hasPrivate = true;
            break;
        }
    }
    if (hasPrivate) {
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
}

bool SupabaseRealtime::subscribeToUserChannel(const String& user_uuid) {
    if (user_uuid.isEmpty()) {
        ESP_LOGW(TAG, "Cannot subscribe to user channel - user_uuid is empty");
        return false;
    }
    
    // The "realtime:" prefix is REQUIRED by the Supabase Realtime Phoenix protocol.
    // The JS SDK does the same: supabase.channel('user:UUID') internally creates
    // the channel with topic "realtime:user:UUID" and sends it in the join message.
    // The server only routes topics starting with "realtime:".
    // RLS helper realtime.topic() strips this prefix, returning just "user:UUID".
    String channelTopic = "realtime:user:" + user_uuid;
    
    // Check if channel already exists
    if (findChannel(channelTopic) != nullptr) {
        ESP_LOGD(TAG, "User channel already registered: %s", channelTopic.c_str());
        return true;
    }
    
    // Register in multi-channel array
    ChannelState& channel = _channels[CHANNEL_USER];
    channel.topic = channelTopic;
    channel.privateChannel = true;
    
    // Ensure _channelCount covers this slot
    if (_channelCount <= CHANNEL_USER) {
        _channelCount = CHANNEL_USER + 1;
    }
    
    ESP_LOGI(TAG, "Subscribing to user channel: %s", channelTopic.c_str());
    
    // Build join payload (broadcast-only, no postgres_changes)
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
        ESP_LOGE(TAG, "Failed to build user channel join message");
        return false;
    }
    
    // Send join message if connected, otherwise queue it
    if (!_connected) {
        if (_client) {
            channel.pendingJoinMessage = message;
            channel.pendingJoin = true;
            ESP_LOGI(TAG, "User channel subscription queued (not connected)");
            return true;
        } else {
            ESP_LOGW(TAG, "Cannot subscribe to user channel - not connected");
            return false;
        }
    }
    
    if (!esp_websocket_client_is_connected(_client)) {
        channel.pendingJoinMessage = message;
        channel.pendingJoin = true;
        ESP_LOGI(TAG, "User channel subscription queued (socket not ready)");
        return true;
    }
    
    int sent = esp_websocket_client_send_text(_client, message.c_str(), message.length(), portMAX_DELAY);
    if (sent < 0) {
        ESP_LOGE(TAG, "Failed to send user channel subscription: %d", sent);
        channel.pendingJoinMessage = message;
        channel.pendingJoin = true;
        return false;
    }
    
    ESP_LOGI(TAG, "User channel subscription sent (%d bytes)", sent);
    sendAccessToken();
    
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
    
    _msgRef++;
    
    // Build broadcast payload: { event: "...", payload: {...} }
    JsonDocument broadcastPayload;
    broadcastPayload["event"] = event;
    broadcastPayload["payload"] = data;
    
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
    // Use first registered channel's topic
    if (_channelCount > 0 && !_channels[0].topic.isEmpty()) {
        return sendBroadcast(_channels[0].topic, event, data);
    }
    
    ESP_LOGW(TAG, "Cannot send broadcast - no channel registered");
    return false;
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
                
                if (payload["response"].is<JsonObject>()) {
                    String reason = payload["response"]["reason"] | "unknown";
                    ESP_LOGE(TAG, "Join failed reason: %s", reason.c_str());
                    String responseStr;
                    serializeJson(payload["response"], responseStr);
                    ESP_LOGD(TAG, "Full response: %s", responseStr.c_str());
                } else {
                    String payloadStr;
                    serializeJson(payload, payloadStr);
                    ESP_LOGE(TAG, "Join error payload: %s", payloadStr.c_str());
                }
            }
            return;
        }
        // Unrecognized topic - log for debugging
        ESP_LOGD(TAG, "phx_reply for unknown topic: %s", topic.c_str());
        return;
    }
    
    // Handle presence events - server only sends these after a successful join.
    // This acts as a fallback subscription confirmation in case the join reply
    // was lost due to message queue race conditions.
    if (event == "presence_state" || event == "presence_diff") {
        ChannelState* channel = findChannel(topic);
        if (channel != nullptr && !channel->subscribed) {
            channel->subscribed = true;
            ESP_LOGI(TAG, "Subscribed (confirmed via presence event): %s", topic.c_str());
        }
        return;
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

        if (!dataVar.isNull() && dataVar.is<JsonObjectConst>()) {
            JsonObjectConst dataObj = dataVar.as<JsonObjectConst>();
            _lastMessage.valid = true;
            _lastMessage.topic = topic;
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
        _lastMessage.topic = topic;
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
