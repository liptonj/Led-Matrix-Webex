/**
 * @file test_supabase_realtime.cpp
 * @brief Unit tests for Supabase Realtime Client (Phoenix Protocol)
 *
 * Tests verify Phoenix message format parsing and building, channel
 * subscription logic, and realtime event handling.
 *
 * Phoenix message format: [join_ref, ref, topic, event, payload]
 * 
 * These mocks match the exact format used by Supabase Realtime:
 * - https://supabase.com/docs/guides/realtime
 * - Phoenix Channels protocol: https://hexdocs.pm/phoenix/Phoenix.Socket.html
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <algorithm>

// For native builds without Arduino min() macro
#ifndef min
#define min(a,b) ((a)<(b)?(a):(b))
#endif

// ============================================================================
// Real Phoenix Protocol Messages (from Supabase Realtime)
// ============================================================================

// Phoenix heartbeat message: [null, ref, "phoenix", "heartbeat", {}]
const char* phoenixHeartbeat = R"([null,1,"phoenix","heartbeat",{}])";

// Phoenix heartbeat response
const char* phoenixHeartbeatReply = R"([null,1,"phoenix","phx_reply",{"status":"ok","response":{}}])";

// Phoenix join message for device channel (UUID identity migration)
// Topic format: realtime:device:{device_uuid}
const char* phoenixJoinMessage = R"([1,1,"realtime:device:550e8400-e29b-41d4-a716-446655440000","phx_join",{"config":{"broadcast":{"self":false},"presence":{"key":""},"private":true},"access_token":"eyJhbGciOiJIUzI1NiJ9.test"}])";

// Phoenix join success response (UUID identity migration)
const char* phoenixJoinReplyOk = R"([1,1,"realtime:device:550e8400-e29b-41d4-a716-446655440000","phx_reply",{"status":"ok","response":{}}])";

// Phoenix join failure response
const char* phoenixJoinReplyError = R"([1,1,"realtime:display:multi","phx_reply",{"status":"error","response":{"reason":"invalid access token"}}])";

// Phoenix broadcast INSERT event for commands (UUID identity migration)
// Commands are now delivered via broadcast on device channel, not postgres_changes
const char* phoenixInsertEvent = R"([null,null,"realtime:device:550e8400-e29b-41d4-a716-446655440000","broadcast",{"event":"command","data":{"id":"cmd-uuid-1234","command":"set_brightness","payload":{"value":200},"device_uuid":"550e8400-e29b-41d4-a716-446655440000","created_at":"2026-01-28T12:00:00Z","status":"pending"}}])";

// Phoenix broadcast UPDATE event for webex status (UUID identity migration)
const char* phoenixUpdateEvent = R"([null,null,"realtime:user:123e4567-e89b-12d3-a456-426614174000","broadcast",{"event":"webex_status","data":{"device_uuid":"550e8400-e29b-41d4-a716-446655440000","webex_status":"meeting","display_name":"John Doe","camera_on":false,"mic_muted":true,"in_call":true,"updated_at":"2026-01-28T12:05:00Z"}}])";

// Phoenix broadcast DELETE event for commands (UUID identity migration)
const char* phoenixDeleteEvent = R"([null,null,"realtime:device:550e8400-e29b-41d4-a716-446655440000","broadcast",{"event":"command_deleted","data":{"id":"cmd-uuid-1234","command":"set_brightness","device_uuid":"550e8400-e29b-41d4-a716-446655440000","acked_at":"2026-01-28T12:01:00Z"}}])";

// Phoenix broadcast event (for custom messages - UUID identity migration)
const char* phoenixBroadcastEvent = R"([null,null,"realtime:user:123e4567-e89b-12d3-a456-426614174000","broadcast",{"event":"status_update","payload":{"status":"active","message":"App connected"}}])";

// Phoenix leave message (UUID identity migration)
const char* phoenixLeaveMessage = R"([null,2,"realtime:device:550e8400-e29b-41d4-a716-446655440000","phx_leave",{}])";

// Phoenix leave response (UUID identity migration)
const char* phoenixLeaveReply = R"([null,2,"realtime:device:550e8400-e29b-41d4-a716-446655440000","phx_reply",{"status":"ok","response":{}}])";

// System event - presence state (UUID identity migration)
const char* phoenixPresenceState = R"([null,null,"realtime:user:123e4567-e89b-12d3-a456-426614174000","presence_state",{"user1":{"metas":[{"phx_ref":"ABC123","online_at":1706443200}]}}])";

// ============================================================================
// Phoenix Message Parsing Tests
// ============================================================================

void test_parse_heartbeat_message() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, phoenixHeartbeat);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    TEST_ASSERT_EQUAL(5, arr.size());
    
    // join_ref is null
    TEST_ASSERT_TRUE(arr[0].isNull());
    // ref
    TEST_ASSERT_EQUAL(1, arr[1].as<int>());
    // topic
    TEST_ASSERT_EQUAL_STRING("phoenix", arr[2].as<const char*>());
    // event
    TEST_ASSERT_EQUAL_STRING("heartbeat", arr[3].as<const char*>());
    // payload is empty object
    TEST_ASSERT_TRUE(arr[4].is<JsonObject>());
}

void test_parse_heartbeat_reply() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, phoenixHeartbeatReply);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    TEST_ASSERT_EQUAL_STRING("phx_reply", arr[3].as<const char*>());
    
    JsonObject payload = arr[4];
    TEST_ASSERT_EQUAL_STRING("ok", payload["status"].as<const char*>());
}

void test_parse_join_message_structure() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, phoenixJoinMessage);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    TEST_ASSERT_EQUAL(5, arr.size());
    
    // join_ref for join messages
    TEST_ASSERT_EQUAL(1, arr[0].as<int>());
    // topic with device_uuid (UUID identity migration)
    const char* topic = arr[2].as<const char*>();
    TEST_ASSERT_NOT_NULL(topic);
    TEST_ASSERT_TRUE(strstr(topic, "realtime:device:") == topic);
    TEST_ASSERT_NOT_NULL(strstr(topic, "550e8400-e29b-41d4-a716-446655440000"));
    // event
    TEST_ASSERT_EQUAL_STRING("phx_join", arr[3].as<const char*>());
}

void test_parse_join_payload_config() {
    JsonDocument doc;
    deserializeJson(doc, phoenixJoinMessage);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject payload = arr[4];
    
    // Check config structure (UUID identity migration - broadcast-only channels)
    JsonObject config = payload["config"];
    TEST_ASSERT_FALSE(config.isNull());
    
    // broadcast.self should be false
    TEST_ASSERT_FALSE(config["broadcast"]["self"].as<bool>());
    
    // private channel flag should be true
    TEST_ASSERT_TRUE(config["private"].as<bool>());
    
    // postgres_changes not used in UUID-based channels (broadcast-only)
    TEST_ASSERT_FALSE(config.containsKey("postgres_changes"));
}

void test_parse_join_access_token() {
    JsonDocument doc;
    deserializeJson(doc, phoenixJoinMessage);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject payload = arr[4];
    
    // access_token must be present
    const char* token = payload["access_token"];
    TEST_ASSERT_NOT_NULL(token);
    TEST_ASSERT_TRUE(strlen(token) > 0);
    // JWT starts with eyJ
    TEST_ASSERT_EQUAL(0, strncmp(token, "eyJ", 3));
}

void test_parse_join_reply_success() {
    JsonDocument doc;
    deserializeJson(doc, phoenixJoinReplyOk);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject payload = arr[4];
    
    TEST_ASSERT_EQUAL_STRING("ok", payload["status"].as<const char*>());
    
    // UUID-based channels use broadcast-only (no postgres_changes subscription IDs)
    TEST_ASSERT_FALSE(payload["response"].containsKey("postgres_changes"));
}

void test_parse_join_reply_error() {
    JsonDocument doc;
    deserializeJson(doc, phoenixJoinReplyError);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject payload = arr[4];
    
    TEST_ASSERT_EQUAL_STRING("error", payload["status"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("invalid access token", 
                             payload["response"]["reason"].as<const char*>());
}

// ============================================================================
// Postgres Changes Event Tests
// ============================================================================

void test_parse_insert_event() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, phoenixInsertEvent);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    
    // Both join_ref and ref are null for server-push events
    TEST_ASSERT_TRUE(arr[0].isNull());
    TEST_ASSERT_TRUE(arr[1].isNull());
    
    // Event type (UUID identity migration - broadcast events, not postgres_changes)
    TEST_ASSERT_EQUAL_STRING("broadcast", arr[3].as<const char*>());
    
    // Data structure
    JsonObject payload = arr[4];
    TEST_ASSERT_EQUAL_STRING("command", payload["event"].as<const char*>());
    
    JsonObject data = payload["data"];
    TEST_ASSERT_EQUAL_STRING("cmd-uuid-1234", data["id"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("set_brightness", data["command"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", data["device_uuid"].as<const char*>());
}

void test_parse_insert_record() {
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject data = arr[4]["data"];
    
    TEST_ASSERT_EQUAL_STRING("cmd-uuid-1234", data["id"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("set_brightness", data["command"].as<const char*>());
    TEST_ASSERT_EQUAL(200, data["payload"]["value"].as<int>());
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", data["device_uuid"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("pending", data["status"].as<const char*>());
    
    // pairing_code should not be present (UUID identity migration)
    TEST_ASSERT_FALSE(data.containsKey("pairing_code"));
}

void test_parse_update_event() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, phoenixUpdateEvent);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    TEST_ASSERT_EQUAL_STRING("broadcast", arr[3].as<const char*>());
    
    JsonObject payload = arr[4];
    TEST_ASSERT_EQUAL_STRING("webex_status", payload["event"].as<const char*>());
    
    // New record values (UUID identity migration - broadcast format)
    JsonObject data = payload["data"];
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", data["device_uuid"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("meeting", data["webex_status"].as<const char*>());
    TEST_ASSERT_FALSE(data["camera_on"].as<bool>());
    TEST_ASSERT_TRUE(data["mic_muted"].as<bool>());
    TEST_ASSERT_TRUE(data["in_call"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("John Doe", data["display_name"].as<const char*>());
}

void test_parse_delete_event() {
    JsonDocument doc;
    deserializeJson(doc, phoenixDeleteEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    TEST_ASSERT_EQUAL_STRING("broadcast", arr[3].as<const char*>());
    
    JsonObject payload = arr[4];
    TEST_ASSERT_EQUAL_STRING("command_deleted", payload["event"].as<const char*>());
    
    // Data contains deleted command info (UUID identity migration - broadcast format)
    JsonObject data = payload["data"];
    TEST_ASSERT_EQUAL_STRING("cmd-uuid-1234", data["id"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("set_brightness", data["command"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", data["device_uuid"].as<const char*>());
}

void test_parse_broadcast_event() {
    JsonDocument doc;
    deserializeJson(doc, phoenixBroadcastEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    TEST_ASSERT_EQUAL_STRING("broadcast", arr[3].as<const char*>());
    
    JsonObject payload = arr[4];
    TEST_ASSERT_EQUAL_STRING("status_update", payload["event"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("active", payload["payload"]["status"].as<const char*>());
}

// ============================================================================
// Phoenix Message Building Tests
// ============================================================================

void test_build_heartbeat_message() {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    
    arr.add(nullptr);  // join_ref
    arr.add(1);        // ref
    arr.add("phoenix");
    arr.add("heartbeat");
    arr.add(JsonObject());
    
    String message;
    serializeJson(doc, message);
    
    // Should match expected format
    TEST_ASSERT_TRUE(message.indexOf("\"phoenix\"") > 0);
    TEST_ASSERT_TRUE(message.indexOf("\"heartbeat\"") > 0);
}

void test_build_join_message() {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    
    int joinRef = 1;
    int msgRef = 1;
    String deviceUuid = "550e8400-e29b-41d4-a716-446655440000";
    String topic = "realtime:device:" + deviceUuid;  // UUID identity migration
    
    arr.add(joinRef);
    arr.add(msgRef);
    arr.add(topic);
    arr.add("phx_join");
    
    JsonDocument payloadDoc;
    JsonObject config = payloadDoc["config"].to<JsonObject>();
    config["broadcast"]["self"] = false;
    config["presence"]["key"] = "";
    config["private"] = true;  // UUID-based channels are private
    
    // UUID-based channels use broadcast-only (no postgres_changes)
    // Commands and events are delivered via broadcast messages
    
    payloadDoc["access_token"] = "test-token";
    
    arr.add(payloadDoc);
    
    String message;
    serializeJson(doc, message);
    
    // Verify structure
    TEST_ASSERT_TRUE(message.startsWith("["));
    TEST_ASSERT_TRUE(message.indexOf("phx_join") > 0);
    TEST_ASSERT_TRUE(message.indexOf("realtime:device:") > 0);
    TEST_ASSERT_TRUE(message.indexOf(deviceUuid.c_str()) > 0);
}

void test_build_leave_message() {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    
    arr.add(nullptr);  // null join_ref for non-join
    arr.add(2);
    String deviceUuid = "550e8400-e29b-41d4-a716-446655440000";
    arr.add("realtime:device:" + deviceUuid);  // UUID identity migration
    arr.add("phx_leave");
    arr.add(JsonObject());
    
    String message;
    serializeJson(doc, message);
    
    TEST_ASSERT_TRUE(message.indexOf("phx_leave") > 0);
    TEST_ASSERT_TRUE(message.indexOf("realtime:device:") > 0);
}

// ============================================================================
// Channel Topic Format Tests
// ============================================================================

void test_topic_format_device_channel() {
    // UUID identity migration - device channel format
    String deviceUuid = "550e8400-e29b-41d4-a716-446655440000";
    String topic = "realtime:device:" + deviceUuid;
    
    TEST_ASSERT_EQUAL_STRING("realtime:device:550e8400-e29b-41d4-a716-446655440000", 
                             topic.c_str());
}

void test_topic_format_user_channel() {
    // UUID identity migration - user channel format
    String userUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    String topic = "realtime:user:" + userUuid;
    
    TEST_ASSERT_EQUAL_STRING("realtime:user:a1b2c3d4-e5f6-7890-abcd-ef1234567890", 
                             topic.c_str());
}

void test_channel_topic_uuid_format() {
    // UUID identity migration - channels use UUIDs directly in topic, not filters
    String deviceUuid = "550e8400-e29b-41d4-a716-446655440000";
    String topic = "realtime:device:" + deviceUuid;
    
    // Topic should contain UUID directly
    TEST_ASSERT_TRUE(topic.indexOf(deviceUuid) > 0);
    TEST_ASSERT_EQUAL(36, deviceUuid.length());  // UUID format length
}

// ============================================================================
// Realtime Message Extraction Tests
// ============================================================================

void test_extract_event_type_from_data() {
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    // UUID identity migration - events are broadcast, not postgres_changes
    const char* eventType = arr[3].as<const char*>();
    const char* eventName = arr[4]["event"].as<const char*>();
    
    TEST_ASSERT_EQUAL_STRING("broadcast", eventType);
    TEST_ASSERT_EQUAL_STRING("command", eventName);
}

void test_extract_event_name() {
    JsonDocument doc;
    deserializeJson(doc, phoenixUpdateEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    // UUID identity migration - extract event name from broadcast
    const char* eventName = arr[4]["event"].as<const char*>();
    
    TEST_ASSERT_EQUAL_STRING("webex_status", eventName);
}

void test_extract_device_uuid_from_broadcast() {
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    // UUID identity migration - extract device_uuid from broadcast data
    const char* deviceUuid = arr[4]["data"]["device_uuid"].as<const char*>();
    
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", deviceUuid);
}

// ============================================================================
// Edge Cases
// ============================================================================

void test_null_refs_handling() {
    // Server-push events have null join_ref and ref
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    
    // Both should be null
    TEST_ASSERT_TRUE(arr[0].isNull());
    TEST_ASSERT_TRUE(arr[1].isNull());
    
    // Should default to 0 when converted
    int joinRef = arr[0].is<int>() ? arr[0].as<int>() : 0;
    int ref = arr[1].is<int>() ? arr[1].as<int>() : 0;
    
    TEST_ASSERT_EQUAL(0, joinRef);
    TEST_ASSERT_EQUAL(0, ref);
}

void test_broadcast_events_have_data_not_record() {
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    // UUID identity migration - broadcast events have "data" field, not "record"/"old_record"
    JsonObject data = arr[4]["data"];
    
    TEST_ASSERT_FALSE(data.isNull());
    TEST_ASSERT_TRUE(data.containsKey("id"));
    TEST_ASSERT_TRUE(data.containsKey("command"));
    TEST_ASSERT_TRUE(data.containsKey("device_uuid"));
}

void test_broadcast_delete_has_data() {
    JsonDocument doc;
    deserializeJson(doc, phoenixDeleteEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    // UUID identity migration - broadcast delete events have "data" field
    JsonObject data = arr[4]["data"];
    
    TEST_ASSERT_FALSE(data.isNull());
    TEST_ASSERT_TRUE(data.containsKey("id"));
    TEST_ASSERT_TRUE(data.containsKey("device_uuid"));
}

// ============================================================================
// WebSocket URL Construction Tests
// ============================================================================

void test_realtime_url_construction() {
    String supabaseUrl = "https://abcdefghijklmnop.supabase.co";
    String anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
    
    // Extract host
    String host = supabaseUrl;
    if (host.startsWith("https://")) {
        host = host.substring(8);
    }
    int slashIdx = host.indexOf('/');
    if (slashIdx > 0) {
        host = host.substring(0, slashIdx);
    }
    
    TEST_ASSERT_EQUAL_STRING("abcdefghijklmnop.supabase.co", host.c_str());
    
    // Build path
    String wsPath = "/realtime/v1/websocket?apikey=" + anonKey + "&vsn=1.0.0";
    
    TEST_ASSERT_TRUE(wsPath.startsWith("/realtime/v1/websocket"));
    TEST_ASSERT_TRUE(wsPath.indexOf("apikey=") > 0);
    TEST_ASSERT_TRUE(wsPath.indexOf("vsn=1.0.0") > 0);
}

// ============================================================================
// Command Extraction from Realtime INSERT Events
// ============================================================================

// Realtime broadcast event for commands (UUID identity migration)
const char* realtimeCommandInsert = R"([null,null,"realtime:device:550e8400-e29b-41d4-a716-446655440000","broadcast",{"event":"command","data":{"id":"cmd-realtime-001","command":"set_brightness","payload":{"value":150},"device_uuid":"550e8400-e29b-41d4-a716-446655440000","serial_number":"A1B2C3D4","status":"pending","created_at":"2026-01-28T14:00:00Z","acked_at":null,"expires_at":"2026-01-28T14:05:00Z","response":null,"error":null}}])";

// Realtime broadcast event with already-acked command (should be skipped) (UUID identity migration)
const char* realtimeCommandInsertAcked = R"([null,null,"realtime:device:550e8400-e29b-41d4-a716-446655440000","broadcast",{"event":"command","data":{"id":"cmd-realtime-002","command":"reboot","payload":{},"device_uuid":"550e8400-e29b-41d4-a716-446655440000","serial_number":"A1B2C3D4","status":"acked","created_at":"2026-01-28T14:00:00Z","acked_at":"2026-01-28T14:00:05Z","expires_at":"2026-01-28T14:05:00Z","response":{},"error":null}}])";

void test_extract_command_from_realtime_insert() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, realtimeCommandInsert);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    
    // Verify event type (UUID identity migration - broadcast, not postgres_changes)
    TEST_ASSERT_EQUAL_STRING("broadcast", arr[3].as<const char*>());
    
    // Extract data from broadcast payload
    JsonObject payload = arr[4];
    TEST_ASSERT_EQUAL_STRING("command", payload["event"].as<const char*>());
    
    JsonObject data = payload["data"];
    TEST_ASSERT_FALSE(data.isNull());
    
    // Extract command fields
    const char* cmdId = data["id"].as<const char*>();
    const char* cmdName = data["command"].as<const char*>();
    const char* status = data["status"].as<const char*>();
    const char* deviceUuid = data["device_uuid"].as<const char*>();
    int payloadValue = data["payload"]["value"].as<int>();
    
    TEST_ASSERT_EQUAL_STRING("cmd-realtime-001", cmdId);
    TEST_ASSERT_EQUAL_STRING("set_brightness", cmdName);
    TEST_ASSERT_EQUAL_STRING("pending", status);
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", deviceUuid);
    TEST_ASSERT_EQUAL(150, payloadValue);
    
    // pairing_code should not be present
    TEST_ASSERT_FALSE(data.containsKey("pairing_code"));
}

void test_command_status_filter_pending() {
    JsonDocument doc;
    deserializeJson(doc, realtimeCommandInsert);
    
    // UUID identity migration - extract from broadcast data
    JsonObject data = doc[4]["data"];
    const char* status = data["status"].as<const char*>();
    
    // Only process pending commands
    bool shouldProcess = (strcmp(status, "pending") == 0);
    TEST_ASSERT_TRUE(shouldProcess);
}

void test_command_status_filter_skip_acked() {
    JsonDocument doc;
    deserializeJson(doc, realtimeCommandInsertAcked);
    
    // UUID identity migration - extract from broadcast data
    JsonObject data = doc[4]["data"];
    const char* status = data["status"].as<const char*>();
    
    // Should NOT process already acked commands
    bool shouldProcess = (strcmp(status, "pending") == 0);
    TEST_ASSERT_FALSE(shouldProcess);
}

void test_serialize_command_payload_to_string() {
    JsonDocument doc;
    deserializeJson(doc, realtimeCommandInsert);
    
    // UUID identity migration - extract from broadcast data
    JsonObject cmdPayload = doc[4]["data"]["payload"];
    
    // Serialize payload to string (as main.cpp does)
    String payloadStr;
    if (!cmdPayload.isNull()) {
        serializeJson(cmdPayload, payloadStr);
    } else {
        payloadStr = "{}";
    }
    
    TEST_ASSERT_EQUAL_STRING("{\"value\":150}", payloadStr.c_str());
}

// ============================================================================
// Pairings UPDATE Event Handling (App State Changes)
// ============================================================================

// Realtime broadcast event for app state update (UUID identity migration)
const char* realtimePairingUpdate = R"([null,null,"realtime:user:123e4567-e89b-12d3-a456-426614174000","broadcast",{"event":"app_state","data":{"device_uuid":"550e8400-e29b-41d4-a716-446655440000","serial_number":"A1B2C3D4","device_id":"webex-display-C3D4","app_last_seen":"2026-01-28T14:10:00Z","device_last_seen":"2026-01-28T14:09:55Z","app_connected":true,"device_connected":true,"webex_status":"meeting","camera_on":false,"mic_muted":true,"in_call":true,"display_name":"Jane Smith","rssi":-65,"free_heap":180000,"uptime":7200,"temperature":42.5,"config":{},"created_at":"2026-01-28T12:00:00Z","updated_at":"2026-01-28T14:10:00Z"}}])";

// Realtime broadcast event - app disconnected (UUID identity migration)
const char* realtimePairingDisconnect = R"([null,null,"realtime:user:123e4567-e89b-12d3-a456-426614174000","broadcast",{"event":"app_state","data":{"device_uuid":"550e8400-e29b-41d4-a716-446655440000","serial_number":"A1B2C3D4","app_connected":false,"device_connected":true,"webex_status":"offline","camera_on":false,"mic_muted":false,"in_call":false,"display_name":"","updated_at":"2026-01-28T14:15:00Z"}}])";

void test_extract_app_state_from_pairing_update() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, realtimePairingUpdate);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    TEST_ASSERT_EQUAL_STRING("broadcast", arr[3].as<const char*>());
    
    JsonObject payload = arr[4];
    TEST_ASSERT_EQUAL_STRING("app_state", payload["event"].as<const char*>());
    
    JsonObject data = payload["data"];
    
    // Extract app state fields (UUID identity migration - broadcast format)
    bool appConnected = data["app_connected"] | false;
    String webexStatus = data["webex_status"] | "offline";
    String displayName = data["display_name"] | "";
    String deviceUuid = data["device_uuid"] | "";
    bool cameraOn = data["camera_on"] | false;
    bool micMuted = data["mic_muted"] | false;
    bool inCall = data["in_call"] | false;
    
    TEST_ASSERT_TRUE(appConnected);
    TEST_ASSERT_EQUAL_STRING("meeting", webexStatus.c_str());
    TEST_ASSERT_EQUAL_STRING("Jane Smith", displayName.c_str());
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", deviceUuid.c_str());
    TEST_ASSERT_FALSE(cameraOn);
    TEST_ASSERT_TRUE(micMuted);
    TEST_ASSERT_TRUE(inCall);
    
    // pairing_code should not be present
    TEST_ASSERT_FALSE(data.containsKey("pairing_code"));
}

void test_detect_app_disconnect_from_pairing_update() {
    JsonDocument doc;
    deserializeJson(doc, realtimePairingDisconnect);
    
    // UUID identity migration - extract from broadcast data
    JsonObject data = doc[4]["data"];
    
    bool appConnected = data["app_connected"] | false;
    String webexStatus = data["webex_status"] | "offline";
    
    TEST_ASSERT_FALSE(appConnected);
    TEST_ASSERT_EQUAL_STRING("offline", webexStatus.c_str());
}

void test_compare_old_and_new_pairing_state() {
    // UUID identity migration - broadcast events don't have old_record
    // State comparison must be done by comparing current state with previous state
    JsonDocument doc;
    deserializeJson(doc, realtimePairingUpdate);
    
    JsonObject data = doc[4]["data"];
    
    // New state (UUID identity migration - broadcast format)
    bool isConnected = data["app_connected"] | false;
    String newStatus = data["webex_status"] | "offline";
    
    // Simulate previous state (would be stored in app_state)
    bool wasConnected = false;
    String oldStatus = "offline";
    
    // Detect app connection event
    bool justConnected = !wasConnected && isConnected;
    TEST_ASSERT_TRUE(justConnected);
    
    TEST_ASSERT_EQUAL_STRING("offline", oldStatus.c_str());
    TEST_ASSERT_EQUAL_STRING("meeting", newStatus.c_str());
}

// ============================================================================
// Event Type Detection and Routing
// ============================================================================

void test_detect_event_is_command_insert() {
    JsonDocument doc;
    deserializeJson(doc, realtimeCommandInsert);
    
    // UUID identity migration - detect broadcast command events
    const char* event = doc[3].as<const char*>();
    const char* eventName = doc[4]["event"].as<const char*>();
    
    bool isCommandInsert = (strcmp(event, "broadcast") == 0 && 
                            strcmp(eventName, "command") == 0);
    
    TEST_ASSERT_TRUE(isCommandInsert);
}

void test_detect_event_is_pairing_update() {
    JsonDocument doc;
    deserializeJson(doc, realtimePairingUpdate);
    
    // UUID identity migration - detect broadcast app_state events
    const char* event = doc[3].as<const char*>();
    const char* eventName = doc[4]["event"].as<const char*>();
    
    bool isPairingUpdate = (strcmp(event, "broadcast") == 0 && 
                            strcmp(eventName, "app_state") == 0);
    
    TEST_ASSERT_TRUE(isPairingUpdate);
}

void test_route_event_to_correct_handler() {
    // Simulate routing logic from handleRealtimeMessage() (UUID identity migration)
    struct {
        const char* message;
        const char* expectedHandler;
    } testCases[] = {
        { realtimeCommandInsert, "handleSupabaseCommand" },
        { realtimePairingUpdate, "updateAppState" },
        { phoenixBroadcastEvent, "handleBroadcast" },
        { phoenixHeartbeatReply, "updateHeartbeat" }
    };
    
    for (int i = 0; i < 4; i++) {
        JsonDocument doc;
        deserializeJson(doc, testCases[i].message);
        
        const char* event = doc[3].as<const char*>();
        const char* handler = "unknown";
        
        if (strcmp(event, "broadcast") == 0) {
            const char* eventName = doc[4]["event"].as<const char*>();
            
            if (eventName && strcmp(eventName, "command") == 0) {
                handler = "handleSupabaseCommand";
            } else if (eventName && strcmp(eventName, "app_state") == 0) {
                handler = "updateAppState";
            } else {
                handler = "handleBroadcast";
            }
        } else if (strcmp(event, "phx_reply") == 0) {
            handler = "updateHeartbeat";
        }
        
        TEST_ASSERT_EQUAL_STRING(testCases[i].expectedHandler, handler);
    }
}

// ============================================================================
// Subscription Filter Verification
// ============================================================================

void test_channel_topic_matches_device_uuid() {
    // UUID identity migration - channels use device_uuid directly in topic
    String deviceUuid = "550e8400-e29b-41d4-a716-446655440000";
    String topic = "realtime:device:" + deviceUuid;
    
    // Build expected topic
    String expectedTopic = "realtime:device:" + deviceUuid;
    
    TEST_ASSERT_EQUAL_STRING(expectedTopic.c_str(), topic.c_str());
}

void test_device_and_user_channel_subscriptions() {
    // UUID identity migration - separate device and user channels
    String deviceUuid = "550e8400-e29b-41d4-a716-446655440000";
    String userUuid = "123e4567-e89b-12d3-a456-426614174000";
    
    // Device channel topic format
    String deviceTopic = "realtime:device:" + deviceUuid;
    TEST_ASSERT_EQUAL_STRING("realtime:device:550e8400-e29b-41d4-a716-446655440000", deviceTopic.c_str());
    
    // User channel topic format
    String userTopic = "realtime:user:" + userUuid;
    TEST_ASSERT_EQUAL_STRING("realtime:user:123e4567-e89b-12d3-a456-426614174000", userTopic.c_str());
    
    // Both channels are used for different event types
    TEST_ASSERT_NOT_EQUAL(deviceTopic.c_str(), userTopic.c_str());
}

// ============================================================================
// Heartbeat and Connection Health Tests
// ============================================================================

void test_heartbeat_timeout_detection() {
    unsigned long lastHeartbeatResponse = 1000;  // 1 second
    unsigned long now = 25000;  // 25 seconds later
    unsigned long heartbeatTimeout = 20000;  // 20 second timeout
    
    bool timedOut = (now - lastHeartbeatResponse > heartbeatTimeout);
    TEST_ASSERT_TRUE(timedOut);
}

void test_heartbeat_within_timeout() {
    unsigned long lastHeartbeatResponse = 1000;
    unsigned long now = 15000;  // 15 seconds later
    unsigned long heartbeatTimeout = 20000;
    
    bool timedOut = (now - lastHeartbeatResponse > heartbeatTimeout);
    TEST_ASSERT_FALSE(timedOut);
}

void test_reconnect_backoff_calculation() {
    unsigned long minDelay = 1000;   // 1 second
    unsigned long maxDelay = 60000;  // 60 seconds
    unsigned long currentDelay = minDelay;
    
    // First retry: 2 seconds
    currentDelay = min(currentDelay * 2, maxDelay);
    TEST_ASSERT_EQUAL(2000, currentDelay);
    
    // Second retry: 4 seconds
    currentDelay = min(currentDelay * 2, maxDelay);
    TEST_ASSERT_EQUAL(4000, currentDelay);
    
    // Continue until max
    for (int i = 0; i < 10; i++) {
        currentDelay = min(currentDelay * 2, maxDelay);
    }
    TEST_ASSERT_EQUAL(60000, currentDelay);  // Capped at max
}

void test_reset_backoff_on_successful_connect() {
    unsigned long minDelay = 1000;
    unsigned long currentDelay = 32000;  // After several retries
    
    // Simulate successful connection - reset to min
    bool connected = true;
    if (connected) {
        currentDelay = minDelay;
    }
    
    TEST_ASSERT_EQUAL(1000, currentDelay);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_supabase_realtime_tests() {
    // Phoenix Message Parsing
    RUN_TEST(test_parse_heartbeat_message);
    RUN_TEST(test_parse_heartbeat_reply);
    RUN_TEST(test_parse_join_message_structure);
    RUN_TEST(test_parse_join_payload_config);
    RUN_TEST(test_parse_join_access_token);
    RUN_TEST(test_parse_join_reply_success);
    RUN_TEST(test_parse_join_reply_error);
    
    // Postgres Changes Events
    RUN_TEST(test_parse_insert_event);
    RUN_TEST(test_parse_insert_record);
    RUN_TEST(test_parse_update_event);
    RUN_TEST(test_parse_delete_event);
    RUN_TEST(test_parse_broadcast_event);
    
    // Message Building
    RUN_TEST(test_build_heartbeat_message);
    RUN_TEST(test_build_join_message);
    RUN_TEST(test_build_leave_message);
    
    // Topic Format (UUID identity migration)
    RUN_TEST(test_topic_format_device_channel);
    RUN_TEST(test_topic_format_user_channel);
    RUN_TEST(test_channel_topic_uuid_format);
    
    // Message Extraction (UUID identity migration)
    RUN_TEST(test_extract_event_type_from_data);
    RUN_TEST(test_extract_event_name);
    RUN_TEST(test_extract_device_uuid_from_broadcast);
    
    // Edge Cases (UUID identity migration)
    RUN_TEST(test_null_refs_handling);
    RUN_TEST(test_broadcast_events_have_data_not_record);
    RUN_TEST(test_broadcast_delete_has_data);
    
    // URL Construction
    RUN_TEST(test_realtime_url_construction);
    
    // ========================================================================
    // Command Extraction from Realtime INSERT Events
    // ========================================================================
    RUN_TEST(test_extract_command_from_realtime_insert);
    RUN_TEST(test_command_status_filter_pending);
    RUN_TEST(test_command_status_filter_skip_acked);
    RUN_TEST(test_serialize_command_payload_to_string);
    
    // ========================================================================
    // Pairings UPDATE Event Handling (App State Changes)
    // ========================================================================
    RUN_TEST(test_extract_app_state_from_pairing_update);
    RUN_TEST(test_detect_app_disconnect_from_pairing_update);
    RUN_TEST(test_compare_old_and_new_pairing_state);
    
    // ========================================================================
    // Event Type Detection and Routing
    // ========================================================================
    RUN_TEST(test_detect_event_is_command_insert);
    RUN_TEST(test_detect_event_is_pairing_update);
    RUN_TEST(test_route_event_to_correct_handler);
    
    // ========================================================================
    // Subscription Filter Verification (UUID identity migration)
    // ========================================================================
    RUN_TEST(test_channel_topic_matches_device_uuid);
    RUN_TEST(test_device_and_user_channel_subscriptions);
    
    // ========================================================================
    // Heartbeat and Connection Health Tests
    // ========================================================================
    RUN_TEST(test_heartbeat_timeout_detection);
    RUN_TEST(test_heartbeat_within_timeout);
    RUN_TEST(test_reconnect_backoff_calculation);
    RUN_TEST(test_reset_backoff_on_successful_connect);
}

#if defined(ARDUINO)
void setup() {
    delay(2000);
    UNITY_BEGIN();
    run_supabase_realtime_tests();
    UNITY_END();
}

void loop() {}
#else
int main(int argc, char** argv) {
    UNITY_BEGIN();
    run_supabase_realtime_tests();
    return UNITY_END();
}
#endif

#endif // UNIT_TEST
