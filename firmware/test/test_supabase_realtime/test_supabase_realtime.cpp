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

// Phoenix join message for postgres_changes
const char* phoenixJoinMessage = R"([1,1,"realtime:display:multi:pairing_code=eq.ABC123","phx_join",{"config":{"broadcast":{"self":false},"presence":{"key":""},"postgres_changes":[{"event":"*","schema":"display","table":"commands","filter":"pairing_code=eq.ABC123"}]},"access_token":"eyJhbGciOiJIUzI1NiJ9.test"}])";

// Phoenix join success response
const char* phoenixJoinReplyOk = R"([1,1,"realtime:display:multi:pairing_code=eq.ABC123","phx_reply",{"status":"ok","response":{"postgres_changes":[{"id":12345}]}}])";

// Phoenix join failure response
const char* phoenixJoinReplyError = R"([1,1,"realtime:display:multi","phx_reply",{"status":"error","response":{"reason":"invalid access token"}}])";

// Phoenix postgres_changes INSERT event
const char* phoenixInsertEvent = R"([null,null,"realtime:display:multi:pairing_code=eq.ABC123","postgres_changes",{"data":{"type":"INSERT","table":"commands","schema":"display","record":{"id":"cmd-uuid-1234","command":"set_brightness","payload":{"value":200},"pairing_code":"ABC123","created_at":"2026-01-28T12:00:00Z","acked_at":null},"old_record":null},"ids":[12345]}])";

// Phoenix postgres_changes UPDATE event
const char* phoenixUpdateEvent = R"([null,null,"realtime:display:multi:pairing_code=eq.ABC123","postgres_changes",{"data":{"type":"UPDATE","table":"device_state","schema":"display","record":{"id":"state-uuid","webex_status":"meeting","display_name":"John Doe","camera_on":false,"mic_muted":true,"in_call":true,"updated_at":"2026-01-28T12:05:00Z"},"old_record":{"webex_status":"active","camera_on":true,"mic_muted":false,"in_call":false}},"ids":[12346]}])";

// Phoenix postgres_changes DELETE event
const char* phoenixDeleteEvent = R"([null,null,"realtime:display:multi:pairing_code=eq.ABC123","postgres_changes",{"data":{"type":"DELETE","table":"commands","schema":"display","record":null,"old_record":{"id":"cmd-uuid-1234","command":"set_brightness","acked_at":"2026-01-28T12:01:00Z"}},"ids":[12345]}])";

// Phoenix broadcast event (for custom messages)
const char* phoenixBroadcastEvent = R"([null,null,"realtime:display:multi","broadcast",{"event":"status_update","payload":{"status":"active","message":"App connected"}}])";

// Phoenix leave message
const char* phoenixLeaveMessage = R"([null,2,"realtime:display:multi","phx_leave",{}])";

// Phoenix leave response
const char* phoenixLeaveReply = R"([null,2,"realtime:display:multi","phx_reply",{"status":"ok","response":{}}])";

// System event - presence state
const char* phoenixPresenceState = R"([null,null,"realtime:display:multi","presence_state",{"user1":{"metas":[{"phx_ref":"ABC123","online_at":1706443200}]}}])";

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
    // topic with filter
    const char* topic = arr[2].as<const char*>();
    TEST_ASSERT_NOT_NULL(topic);
    TEST_ASSERT_TRUE(strstr(topic, "realtime:") == topic);
    TEST_ASSERT_NOT_NULL(strstr(topic, "pairing_code=eq.ABC123"));
    // event
    TEST_ASSERT_EQUAL_STRING("phx_join", arr[3].as<const char*>());
}

void test_parse_join_payload_config() {
    JsonDocument doc;
    deserializeJson(doc, phoenixJoinMessage);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject payload = arr[4];
    
    // Check config structure
    JsonObject config = payload["config"];
    TEST_ASSERT_FALSE(config.isNull());
    
    // broadcast.self should be false
    TEST_ASSERT_FALSE(config["broadcast"]["self"].as<bool>());
    
    // postgres_changes array
    JsonArray pgChanges = config["postgres_changes"];
    TEST_ASSERT_EQUAL(1, pgChanges.size());
    
    JsonObject change = pgChanges[0];
    TEST_ASSERT_EQUAL_STRING("*", change["event"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("display", change["schema"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("commands", change["table"].as<const char*>());
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
    
    // Response contains postgres_changes subscription IDs
    JsonArray pgChanges = payload["response"]["postgres_changes"];
    TEST_ASSERT_GREATER_THAN(0, pgChanges.size());
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
    
    // Event type
    TEST_ASSERT_EQUAL_STRING("postgres_changes", arr[3].as<const char*>());
    
    // Data structure
    JsonObject payload = arr[4];
    JsonObject data = payload["data"];
    
    TEST_ASSERT_EQUAL_STRING("INSERT", data["type"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("commands", data["table"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("display", data["schema"].as<const char*>());
}

void test_parse_insert_record() {
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject record = arr[4]["data"]["record"];
    
    TEST_ASSERT_EQUAL_STRING("cmd-uuid-1234", record["id"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("set_brightness", record["command"].as<const char*>());
    TEST_ASSERT_EQUAL(200, record["payload"]["value"].as<int>());
    TEST_ASSERT_EQUAL_STRING("ABC123", record["pairing_code"].as<const char*>());
}

void test_parse_update_event() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, phoenixUpdateEvent);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject data = arr[4]["data"];
    
    TEST_ASSERT_EQUAL_STRING("UPDATE", data["type"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("device_state", data["table"].as<const char*>());
    
    // New record values
    JsonObject record = data["record"];
    TEST_ASSERT_EQUAL_STRING("meeting", record["webex_status"].as<const char*>());
    TEST_ASSERT_FALSE(record["camera_on"].as<bool>());
    TEST_ASSERT_TRUE(record["mic_muted"].as<bool>());
    TEST_ASSERT_TRUE(record["in_call"].as<bool>());
    
    // Old record values (for comparison/audit)
    JsonObject oldRecord = data["old_record"];
    TEST_ASSERT_EQUAL_STRING("active", oldRecord["webex_status"].as<const char*>());
    TEST_ASSERT_TRUE(oldRecord["camera_on"].as<bool>());
}

void test_parse_delete_event() {
    JsonDocument doc;
    deserializeJson(doc, phoenixDeleteEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject data = arr[4]["data"];
    
    TEST_ASSERT_EQUAL_STRING("DELETE", data["type"].as<const char*>());
    
    // Record is null for DELETE, old_record contains deleted data
    TEST_ASSERT_TRUE(data["record"].isNull());
    
    JsonObject oldRecord = data["old_record"];
    TEST_ASSERT_EQUAL_STRING("cmd-uuid-1234", oldRecord["id"].as<const char*>());
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
    String topic = "realtime:display:commands";
    
    arr.add(joinRef);
    arr.add(msgRef);
    arr.add(topic);
    arr.add("phx_join");
    
    JsonDocument payloadDoc;
    JsonObject config = payloadDoc["config"].to<JsonObject>();
    config["broadcast"]["self"] = false;
    config["presence"]["key"] = "";
    
    JsonArray pgChanges = config["postgres_changes"].to<JsonArray>();
    JsonObject change = pgChanges.add<JsonObject>();
    change["event"] = "*";
    change["schema"] = "display";
    change["table"] = "commands";
    
    payloadDoc["access_token"] = "test-token";
    
    arr.add(payloadDoc);
    
    String message;
    serializeJson(doc, message);
    
    // Verify structure
    TEST_ASSERT_TRUE(message.startsWith("["));
    TEST_ASSERT_TRUE(message.indexOf("phx_join") > 0);
    TEST_ASSERT_TRUE(message.indexOf("postgres_changes") > 0);
}

void test_build_leave_message() {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    
    arr.add(nullptr);  // null join_ref for non-join
    arr.add(2);
    arr.add("realtime:display:multi");
    arr.add("phx_leave");
    arr.add(JsonObject());
    
    String message;
    serializeJson(doc, message);
    
    TEST_ASSERT_TRUE(message.indexOf("phx_leave") > 0);
}

// ============================================================================
// Channel Topic Format Tests
// ============================================================================

void test_topic_format_single_table() {
    String schema = "display";
    String table = "commands";
    String filter = "pairing_code=eq.ABC123";
    
    String topic = "realtime:" + schema + ":" + table;
    if (!filter.isEmpty()) {
        topic += ":" + filter;
    }
    
    TEST_ASSERT_EQUAL_STRING("realtime:display:commands:pairing_code=eq.ABC123", 
                             topic.c_str());
}

void test_topic_format_multi_table() {
    String schema = "display";
    String filter = "pairing_code=eq.XYZ789";
    
    // Multi-table uses "multi" instead of table name
    String topic = "realtime:" + schema + ":multi";
    if (!filter.isEmpty()) {
        topic += ":" + filter;
    }
    
    TEST_ASSERT_EQUAL_STRING("realtime:display:multi:pairing_code=eq.XYZ789", 
                             topic.c_str());
}

void test_filter_format_equality() {
    // Supabase filter format: column=op.value
    String filter = "pairing_code=eq.ABC123";
    
    // Should have = and eq.
    TEST_ASSERT_TRUE(filter.indexOf("=eq.") > 0);
}

// ============================================================================
// Realtime Message Extraction Tests
// ============================================================================

void test_extract_event_type_from_data() {
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    const char* eventType = arr[4]["data"]["type"].as<const char*>();
    
    // Event type should be uppercase
    TEST_ASSERT_EQUAL_STRING("INSERT", eventType);
}

void test_extract_table_name() {
    JsonDocument doc;
    deserializeJson(doc, phoenixUpdateEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    const char* table = arr[4]["data"]["table"].as<const char*>();
    
    TEST_ASSERT_EQUAL_STRING("device_state", table);
}

void test_extract_schema_name() {
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    const char* schema = arr[4]["data"]["schema"].as<const char*>();
    
    TEST_ASSERT_EQUAL_STRING("display", schema);
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

void test_empty_old_record_on_insert() {
    JsonDocument doc;
    deserializeJson(doc, phoenixInsertEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonVariant oldRecord = arr[4]["data"]["old_record"];
    
    // INSERT events have null old_record
    TEST_ASSERT_TRUE(oldRecord.isNull());
}

void test_empty_record_on_delete() {
    JsonDocument doc;
    deserializeJson(doc, phoenixDeleteEvent);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonVariant record = arr[4]["data"]["record"];
    
    // DELETE events have null record
    TEST_ASSERT_TRUE(record.isNull());
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

// Realtime INSERT event for commands table (matches actual Supabase format)
const char* realtimeCommandInsert = R"([null,null,"realtime:display:multi:pairing_code=eq.ABC123","postgres_changes",{"data":{"type":"INSERT","table":"commands","schema":"display","record":{"id":"cmd-realtime-001","command":"set_brightness","payload":{"value":150},"pairing_code":"ABC123","serial_number":"A1B2C3D4","status":"pending","created_at":"2026-01-28T14:00:00Z","acked_at":null,"expires_at":"2026-01-28T14:05:00Z","response":null,"error":null},"old_record":null},"ids":[99999]}])";

// Realtime INSERT event with already-acked command (should be skipped)
const char* realtimeCommandInsertAcked = R"([null,null,"realtime:display:multi:pairing_code=eq.ABC123","postgres_changes",{"data":{"type":"INSERT","table":"commands","schema":"display","record":{"id":"cmd-realtime-002","command":"reboot","payload":{},"pairing_code":"ABC123","serial_number":"A1B2C3D4","status":"acked","created_at":"2026-01-28T14:00:00Z","acked_at":"2026-01-28T14:00:05Z","expires_at":"2026-01-28T14:05:00Z","response":{},"error":null},"old_record":null},"ids":[99998]}])";

void test_extract_command_from_realtime_insert() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, realtimeCommandInsert);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    
    // Verify event type
    TEST_ASSERT_EQUAL_STRING("postgres_changes", arr[3].as<const char*>());
    
    // Extract record from data
    JsonObject data = arr[4]["data"];
    TEST_ASSERT_EQUAL_STRING("INSERT", data["type"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("commands", data["table"].as<const char*>());
    
    JsonObject record = data["record"];
    TEST_ASSERT_FALSE(record.isNull());
    
    // Extract command fields
    const char* cmdId = record["id"].as<const char*>();
    const char* cmdName = record["command"].as<const char*>();
    const char* status = record["status"].as<const char*>();
    int payloadValue = record["payload"]["value"].as<int>();
    
    TEST_ASSERT_EQUAL_STRING("cmd-realtime-001", cmdId);
    TEST_ASSERT_EQUAL_STRING("set_brightness", cmdName);
    TEST_ASSERT_EQUAL_STRING("pending", status);
    TEST_ASSERT_EQUAL(150, payloadValue);
}

void test_command_status_filter_pending() {
    JsonDocument doc;
    deserializeJson(doc, realtimeCommandInsert);
    
    JsonObject record = doc[4]["data"]["record"];
    const char* status = record["status"].as<const char*>();
    
    // Only process pending commands
    bool shouldProcess = (strcmp(status, "pending") == 0);
    TEST_ASSERT_TRUE(shouldProcess);
}

void test_command_status_filter_skip_acked() {
    JsonDocument doc;
    deserializeJson(doc, realtimeCommandInsertAcked);
    
    JsonObject record = doc[4]["data"]["record"];
    const char* status = record["status"].as<const char*>();
    
    // Should NOT process already acked commands
    bool shouldProcess = (strcmp(status, "pending") == 0);
    TEST_ASSERT_FALSE(shouldProcess);
}

void test_serialize_command_payload_to_string() {
    JsonDocument doc;
    deserializeJson(doc, realtimeCommandInsert);
    
    JsonObject cmdPayload = doc[4]["data"]["record"]["payload"];
    
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

// Realtime UPDATE event for pairings table - app connection
const char* realtimePairingUpdate = R"([null,null,"realtime:display:multi:pairing_code=eq.ABC123","postgres_changes",{"data":{"type":"UPDATE","table":"pairings","schema":"display","record":{"pairing_code":"ABC123","serial_number":"A1B2C3D4","device_id":"webex-display-C3D4","app_last_seen":"2026-01-28T14:10:00Z","device_last_seen":"2026-01-28T14:09:55Z","app_connected":true,"device_connected":true,"webex_status":"meeting","camera_on":false,"mic_muted":true,"in_call":true,"display_name":"Jane Smith","rssi":-65,"free_heap":180000,"uptime":7200,"temperature":42.5,"config":{},"created_at":"2026-01-28T12:00:00Z","updated_at":"2026-01-28T14:10:00Z"},"old_record":{"app_connected":false,"webex_status":"offline","camera_on":false,"mic_muted":false,"in_call":false}},"ids":[88888]}])";

// Realtime UPDATE event - app disconnected
const char* realtimePairingDisconnect = R"([null,null,"realtime:display:multi:pairing_code=eq.ABC123","postgres_changes",{"data":{"type":"UPDATE","table":"pairings","schema":"display","record":{"pairing_code":"ABC123","serial_number":"A1B2C3D4","app_connected":false,"device_connected":true,"webex_status":"offline","camera_on":false,"mic_muted":false,"in_call":false,"display_name":"","updated_at":"2026-01-28T14:15:00Z"},"old_record":{"app_connected":true,"webex_status":"meeting"}},"ids":[88889]}])";

void test_extract_app_state_from_pairing_update() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, realtimePairingUpdate);
    TEST_ASSERT_FALSE(error);
    
    JsonArray arr = doc.as<JsonArray>();
    JsonObject data = arr[4]["data"];
    
    TEST_ASSERT_EQUAL_STRING("UPDATE", data["type"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("pairings", data["table"].as<const char*>());
    
    JsonObject record = data["record"];
    
    // Extract app state fields
    bool appConnected = record["app_connected"] | false;
    String webexStatus = record["webex_status"] | "offline";
    String displayName = record["display_name"] | "";
    bool cameraOn = record["camera_on"] | false;
    bool micMuted = record["mic_muted"] | false;
    bool inCall = record["in_call"] | false;
    
    TEST_ASSERT_TRUE(appConnected);
    TEST_ASSERT_EQUAL_STRING("meeting", webexStatus.c_str());
    TEST_ASSERT_EQUAL_STRING("Jane Smith", displayName.c_str());
    TEST_ASSERT_FALSE(cameraOn);
    TEST_ASSERT_TRUE(micMuted);
    TEST_ASSERT_TRUE(inCall);
}

void test_detect_app_disconnect_from_pairing_update() {
    JsonDocument doc;
    deserializeJson(doc, realtimePairingDisconnect);
    
    JsonObject record = doc[4]["data"]["record"];
    
    bool appConnected = record["app_connected"] | false;
    String webexStatus = record["webex_status"] | "offline";
    
    TEST_ASSERT_FALSE(appConnected);
    TEST_ASSERT_EQUAL_STRING("offline", webexStatus.c_str());
}

void test_compare_old_and_new_pairing_state() {
    JsonDocument doc;
    deserializeJson(doc, realtimePairingUpdate);
    
    JsonObject data = doc[4]["data"];
    JsonObject record = data["record"];
    JsonObject oldRecord = data["old_record"];
    
    // Old state
    bool wasConnected = oldRecord["app_connected"] | false;
    String oldStatus = oldRecord["webex_status"] | "offline";
    
    // New state
    bool isConnected = record["app_connected"] | false;
    String newStatus = record["webex_status"] | "offline";
    
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
    
    const char* event = doc[3].as<const char*>();
    const char* table = doc[4]["data"]["table"].as<const char*>();
    const char* type = doc[4]["data"]["type"].as<const char*>();
    
    bool isCommandInsert = (strcmp(event, "postgres_changes") == 0 && 
                            strcmp(table, "commands") == 0 && 
                            strcmp(type, "INSERT") == 0);
    
    TEST_ASSERT_TRUE(isCommandInsert);
}

void test_detect_event_is_pairing_update() {
    JsonDocument doc;
    deserializeJson(doc, realtimePairingUpdate);
    
    const char* event = doc[3].as<const char*>();
    const char* table = doc[4]["data"]["table"].as<const char*>();
    const char* type = doc[4]["data"]["type"].as<const char*>();
    
    bool isPairingUpdate = (strcmp(event, "postgres_changes") == 0 && 
                            strcmp(table, "pairings") == 0 && 
                            strcmp(type, "UPDATE") == 0);
    
    TEST_ASSERT_TRUE(isPairingUpdate);
}

void test_route_event_to_correct_handler() {
    // Simulate routing logic from handleRealtimeMessage()
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
        
        if (strcmp(event, "postgres_changes") == 0) {
            const char* table = doc[4]["data"]["table"].as<const char*>();
            const char* type = doc[4]["data"]["type"].as<const char*>();
            
            if (table && type && strcmp(table, "commands") == 0 && strcmp(type, "INSERT") == 0) {
                handler = "handleSupabaseCommand";
            } else if (table && type && strcmp(table, "pairings") == 0 && strcmp(type, "UPDATE") == 0) {
                handler = "updateAppState";
            }
        } else if (strcmp(event, "broadcast") == 0) {
            handler = "handleBroadcast";
        } else if (strcmp(event, "phx_reply") == 0) {
            handler = "updateHeartbeat";
        }
        
        TEST_ASSERT_EQUAL_STRING(testCases[i].expectedHandler, handler);
    }
}

// ============================================================================
// Subscription Filter Verification
// ============================================================================

void test_filter_matches_pairing_code() {
    String filter = "pairing_code=eq.ABC123";
    String pairingCode = "ABC123";
    
    // Build expected filter
    String expectedFilter = "pairing_code=eq." + pairingCode;
    
    TEST_ASSERT_EQUAL_STRING(expectedFilter.c_str(), filter.c_str());
}

void test_multi_table_subscription_topic() {
    String schema = "display";
    String filter = "pairing_code=eq.XYZ789";
    const String tables[] = { "commands", "pairings" };
    int tableCount = 2;
    
    // Multi-table topic format
    String topic = "realtime:" + schema + ":multi";
    if (!filter.isEmpty()) {
        topic += ":" + filter;
    }
    
    TEST_ASSERT_EQUAL_STRING("realtime:display:multi:pairing_code=eq.XYZ789", topic.c_str());
    
    // Verify tables would be in postgres_changes array
    TEST_ASSERT_EQUAL(2, tableCount);
    TEST_ASSERT_EQUAL_STRING("commands", tables[0].c_str());
    TEST_ASSERT_EQUAL_STRING("pairings", tables[1].c_str());
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
    
    // Topic Format
    RUN_TEST(test_topic_format_single_table);
    RUN_TEST(test_topic_format_multi_table);
    RUN_TEST(test_filter_format_equality);
    
    // Message Extraction
    RUN_TEST(test_extract_event_type_from_data);
    RUN_TEST(test_extract_table_name);
    RUN_TEST(test_extract_schema_name);
    
    // Edge Cases
    RUN_TEST(test_null_refs_handling);
    RUN_TEST(test_empty_old_record_on_insert);
    RUN_TEST(test_empty_record_on_delete);
    
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
    // Subscription Filter Verification
    // ========================================================================
    RUN_TEST(test_filter_matches_pairing_code);
    RUN_TEST(test_multi_table_subscription_topic);
    
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
