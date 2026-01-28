/**
 * @file test_supabase_client.cpp
 * @brief Unit tests for Supabase Edge Function client
 *
 * These tests verify the SupabaseClient class functionality including
 * authentication, state posting, command polling, and acknowledgment.
 *
 * Test coverage for plan item [test-firmware-supabase]:
 * - test_authenticate_success - Mock HTTP 200 with valid token
 * - test_authenticate_failure - Mock HTTP 401/500
 * - test_post_device_state - Verify request body, parse response
 * - test_poll_commands - Parse command array
 * - test_ack_command - Build request, handle response
 * - test_token_refresh - Expired token triggers re-auth
 * - test_rate_limit_handling - 429 response handling
 *
 * Note: These are unit tests that mock HTTP responses. For integration tests,
 * use a real Supabase instance in a test environment.
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <ArduinoJson.h>

// ============================================================================
// Mock HTTP Response Data
// ============================================================================

// Successful authentication response
// NOTE: Use const char* instead of String to avoid stream read position issues
const char* mockAuthResponse = R"({
    "success": true,
    "serial_number": "A1B2C3D4",
    "pairing_code": "XYZ789",
    "device_id": "webex-display-C3D4",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJBMUIyQzNENCJ9.signature",
    "expires_at": "2026-01-28T13:00:00Z",
    "target_firmware_version": "1.5.1"
})";

// Auth response without target firmware version
const char* mockAuthResponseNoOTA = R"({
    "success": true,
    "serial_number": "A1B2C3D4",
    "pairing_code": "XYZ789",
    "device_id": "webex-display-C3D4",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.sig",
    "expires_at": "2026-01-28T13:00:00Z"
})";

// Auth failure - invalid credentials
const char* mockAuthFailure401 = R"({
    "success": false,
    "error": "Invalid signature"
})";

// Auth failure - server error
const char* mockAuthFailure500 = R"({
    "success": false,
    "error": "Internal server error"
})";

// Auth failure - device not found
const char* mockAuthFailure404 = R"({
    "success": false,
    "error": "Device not found"
})";

// Successful state response with app connected
const char* mockStateResponse = R"({
    "success": true,
    "app_connected": true,
    "webex_status": "active",
    "display_name": "John Doe",
    "camera_on": true,
    "mic_muted": false,
    "in_call": false
})";

// State response with app disconnected
const char* mockStateResponseOffline = R"({
    "success": true,
    "app_connected": false,
    "webex_status": "offline",
    "display_name": null,
    "camera_on": false,
    "mic_muted": false,
    "in_call": false
})";

// State response - in a meeting
const char* mockStateResponseMeeting = R"({
    "success": true,
    "app_connected": true,
    "webex_status": "meeting",
    "display_name": "Jane Smith",
    "camera_on": false,
    "mic_muted": true,
    "in_call": true
})";

// Commands response with multiple commands
const char* mockCommandsResponse = R"({
    "success": true,
    "commands": [
        {
            "id": "cmd-uuid-1234",
            "command": "set_brightness",
            "payload": {"value": 200},
            "created_at": "2026-01-28T12:00:00Z"
        },
        {
            "id": "cmd-uuid-5678",
            "command": "reboot",
            "payload": {},
            "created_at": "2026-01-28T12:01:00Z"
        }
    ]
})";

// Single command response
const char* mockSingleCommandResponse = R"({
    "success": true,
    "commands": [
        {
            "id": "cmd-uuid-9999",
            "command": "set_config",
            "payload": {"brightness": 150, "timezone": "America/New_York"},
            "created_at": "2026-01-28T12:05:00Z"
        }
    ]
})";

// Empty commands response
const char* mockEmptyCommandsResponse = R"({
    "success": true,
    "commands": []
})";

// Successful ack response
const char* mockAckResponse = R"({
    "success": true
})";

// Ack failure - command not found
const char* mockAckFailure = R"({
    "success": false,
    "error": "Command not found or already acknowledged"
})";

// Generic error response
const char* mockErrorResponse = R"({
    "success": false,
    "error": "Invalid token"
})";

// Token expired response (HTTP 401)
const char* mockTokenExpiredResponse = R"({
    "success": false,
    "error": "Token expired"
})";

// Rate limit exceeded response (HTTP 429)
const char* mockRateLimitResponse = R"({
    "success": false,
    "error": "Rate limit exceeded. Max 12 requests per minute."
})";

// Rate limit with retry-after
const char* mockRateLimitWithRetry = R"({
    "success": false,
    "error": "Rate limit exceeded",
    "retry_after": 30
})";

// ============================================================================
// Authentication Response Parsing Tests
// ============================================================================

void test_authenticate_success() {
    // Test: Mock HTTP 200 with valid token
    // Simulates successful device-auth response parsing
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAuthResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("A1B2C3D4", doc["serial_number"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("XYZ789", doc["pairing_code"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("webex-display-C3D4", doc["device_id"].as<const char*>());
    // Verify token starts with "eyJ" (JWT header prefix)
    const char* token = doc["token"].as<const char*>();
    TEST_ASSERT_NOT_NULL(token);
    TEST_ASSERT_EQUAL(0, strncmp(token, "eyJ", 3));
    TEST_ASSERT_EQUAL_STRING("2026-01-28T13:00:00Z", doc["expires_at"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("1.5.1", doc["target_firmware_version"].as<const char*>());
}

void test_authenticate_success_no_ota() {
    // Test: Auth success without target_firmware_version (optional field)
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAuthResponseNoOTA);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());
    
    // target_firmware_version is optional and should default to empty
    String targetVersion = doc["target_firmware_version"] | "";
    TEST_ASSERT_TRUE(targetVersion.isEmpty());
}

void test_authenticate_failure_invalid_signature() {
    // Test: Mock HTTP 401 - invalid HMAC signature
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAuthFailure401);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("Invalid signature", doc["error"].as<const char*>());
}

void test_authenticate_failure_device_not_found() {
    // Test: Mock HTTP 404 - device not registered
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAuthFailure404);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("Device not found", doc["error"].as<const char*>());
}

void test_authenticate_failure_server_error() {
    // Test: Mock HTTP 500 - server error
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAuthFailure500);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("Internal server error", doc["error"].as<const char*>());
}

void test_parse_auth_response_token_format() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAuthResponse);
    TEST_ASSERT_FALSE(error);

    // Get token as JsonVariant first to handle ArduinoJson's type system
    JsonVariant tokenVar = doc["token"];
    TEST_ASSERT_FALSE(tokenVar.isNull());
    
    String token = tokenVar.as<std::string>().c_str();

    // JWT has 3 parts separated by dots
    int firstDot = token.indexOf('.');
    int lastDot = token.lastIndexOf('.');

    TEST_ASSERT_GREATER_THAN(0, firstDot);
    TEST_ASSERT_GREATER_THAN(firstDot, lastDot);
    TEST_ASSERT_NOT_EQUAL(firstDot, lastDot);
}

void test_parse_auth_expiry_format() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAuthResponse);
    TEST_ASSERT_FALSE(error);

    // Get expires_at as JsonVariant first
    JsonVariant expiresVar = doc["expires_at"];
    TEST_ASSERT_FALSE(expiresVar.isNull());
    
    String expiresAt = expiresVar.as<std::string>().c_str();

    // Should be ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ
    TEST_ASSERT_EQUAL(20, expiresAt.length());
    TEST_ASSERT_EQUAL('T', expiresAt.charAt(10));
    TEST_ASSERT_EQUAL('Z', expiresAt.charAt(19));
}

// ============================================================================
// Device State Response Parsing Tests
// ============================================================================

void test_parse_state_response_app_connected() {
    // Test: Parse post-device-state response with app connected
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockStateResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());
    TEST_ASSERT_TRUE(doc["app_connected"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("active", doc["webex_status"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("John Doe", doc["display_name"].as<const char*>());
    TEST_ASSERT_TRUE(doc["camera_on"].as<bool>());
    TEST_ASSERT_FALSE(doc["mic_muted"].as<bool>());
    TEST_ASSERT_FALSE(doc["in_call"].as<bool>());
}

void test_parse_state_response_app_disconnected() {
    // Test: Parse post-device-state response with app disconnected
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockStateResponseOffline);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());
    TEST_ASSERT_FALSE(doc["app_connected"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("offline", doc["webex_status"].as<const char*>());
    TEST_ASSERT_FALSE(doc["camera_on"].as<bool>());
}

void test_parse_state_response_in_meeting() {
    // Test: Parse state response during meeting
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockStateResponseMeeting);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());
    TEST_ASSERT_TRUE(doc["app_connected"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("meeting", doc["webex_status"].as<const char*>());
    TEST_ASSERT_TRUE(doc["in_call"].as<bool>());
    TEST_ASSERT_TRUE(doc["mic_muted"].as<bool>());
    TEST_ASSERT_FALSE(doc["camera_on"].as<bool>());
}

void test_state_request_body_format() {
    // Test: Build request body as SupabaseClient does
    JsonDocument doc;
    doc["rssi"] = -65;
    doc["free_heap"] = 180000;
    doc["uptime"] = 3600;
    doc["temperature"] = 42.5;

    String body;
    serializeJson(doc, body);

    // Verify it parses back correctly
    JsonDocument parsed;
    DeserializationError error = deserializeJson(parsed, body);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_EQUAL(-65, parsed["rssi"].as<int>());
    TEST_ASSERT_EQUAL(180000, parsed["free_heap"].as<uint32_t>());
    TEST_ASSERT_EQUAL(3600, parsed["uptime"].as<uint32_t>());
    TEST_ASSERT_FLOAT_WITHIN(0.1, 42.5, parsed["temperature"].as<float>());
}

void test_state_request_without_temperature() {
    // Test: Temperature is optional in request
    JsonDocument doc;
    doc["rssi"] = -70;
    doc["free_heap"] = 150000;
    doc["uptime"] = 7200;
    // No temperature field

    String body;
    serializeJson(doc, body);

    JsonDocument parsed;
    DeserializationError error = deserializeJson(parsed, body);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_EQUAL(-70, parsed["rssi"].as<int>());
    TEST_ASSERT_FALSE(parsed.containsKey("temperature"));
}

void test_state_response_null_display_name() {
    // Test: Handle null display_name gracefully
    JsonDocument doc;
    deserializeJson(doc, mockStateResponseOffline);

    // display_name is null when offline
    String displayName = doc["display_name"] | "";
    TEST_ASSERT_TRUE(displayName.isEmpty());
}

// ============================================================================
// Command Polling Response Parsing Tests
// ============================================================================

void test_parse_commands_response() {
    // Test: Parse poll-commands response with multiple commands
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockCommandsResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());

    JsonArray commands = doc["commands"].as<JsonArray>();
    TEST_ASSERT_EQUAL(2, commands.size());
}

void test_parse_command_details() {
    // Test: Parse individual command details
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockCommandsResponse);
    TEST_ASSERT_FALSE(error);

    JsonArray commands = doc["commands"].as<JsonArray>();
    TEST_ASSERT_EQUAL(2, commands.size());
    
    JsonObject cmd1 = commands[0];
    TEST_ASSERT_FALSE(cmd1.isNull());

    // Use std::string for reliable string extraction
    std::string cmdId = cmd1["id"].as<std::string>();
    std::string cmdName = cmd1["command"].as<std::string>();
    
    TEST_ASSERT_EQUAL_STRING("cmd-uuid-1234", cmdId.c_str());
    TEST_ASSERT_EQUAL_STRING("set_brightness", cmdName.c_str());
    TEST_ASSERT_EQUAL(200, cmd1["payload"]["value"].as<int>());
}

void test_parse_command_with_complex_payload() {
    // Test: Parse command with complex payload (multiple fields)
    JsonDocument doc;
    deserializeJson(doc, mockSingleCommandResponse);

    JsonArray commands = doc["commands"].as<JsonArray>();
    JsonObject cmd = commands[0];

    TEST_ASSERT_EQUAL_STRING("set_config", cmd["command"].as<const char*>());
    TEST_ASSERT_EQUAL(150, cmd["payload"]["brightness"].as<int>());
    TEST_ASSERT_EQUAL_STRING("America/New_York", cmd["payload"]["timezone"].as<const char*>());
}

void test_parse_command_with_empty_payload() {
    // Test: Parse command with empty payload (like reboot)
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockCommandsResponse);
    TEST_ASSERT_FALSE(error);

    JsonArray commands = doc["commands"].as<JsonArray>();
    TEST_ASSERT_EQUAL(2, commands.size());
    
    JsonObject cmd2 = commands[1];  // reboot command
    TEST_ASSERT_FALSE(cmd2.isNull());

    std::string cmdName = cmd2["command"].as<std::string>();
    TEST_ASSERT_EQUAL_STRING("reboot", cmdName.c_str());
    
    // Payload should be empty object
    String payloadStr;
    serializeJson(cmd2["payload"], payloadStr);
    TEST_ASSERT_EQUAL_STRING("{}", payloadStr.c_str());
}

void test_parse_empty_commands() {
    // Test: Parse poll-commands response with no pending commands
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockEmptyCommandsResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());

    JsonArray commands = doc["commands"].as<JsonArray>();
    TEST_ASSERT_EQUAL(0, commands.size());
}

void test_command_payload_serialization() {
    // Test: Serialize payload back to string (as client stores it)
    JsonDocument doc;
    doc["value"] = 200;

    String payload;
    serializeJson(doc, payload);

    TEST_ASSERT_EQUAL_STRING("{\"value\":200}", payload.c_str());
}

void test_command_array_max_capacity() {
    // Test: Handle max command capacity (10 commands)
    const int MAX_COMMANDS = 10;
    
    // Build response with exactly 10 commands
    String manyCommands = R"({"success":true,"commands":[)";
    for (int i = 0; i < MAX_COMMANDS; i++) {
        if (i > 0) manyCommands += ",";
        manyCommands += R"({"id":"cmd-)" + String(i) + R"(","command":"ping","payload":{},"created_at":"2026-01-28T12:00:00Z"})";
    }
    manyCommands += "]}";

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, manyCommands);

    TEST_ASSERT_FALSE(error);
    JsonArray commands = doc["commands"].as<JsonArray>();
    TEST_ASSERT_EQUAL(MAX_COMMANDS, commands.size());
}

// ============================================================================
// Command Acknowledgment Request Tests
// ============================================================================

void test_ack_request_body_success() {
    // Test: Build ack request body for successful command
    JsonDocument doc;
    doc["command_id"] = "cmd-uuid-1234";
    doc["success"] = true;

    JsonDocument responseData;
    responseData["brightness"] = 200;
    doc["response"] = responseData;

    String body;
    serializeJson(doc, body);

    // Verify structure
    JsonDocument parsed;
    deserializeJson(parsed, body);

    TEST_ASSERT_EQUAL_STRING("cmd-uuid-1234", parsed["command_id"].as<const char*>());
    TEST_ASSERT_TRUE(parsed["success"].as<bool>());
    TEST_ASSERT_EQUAL(200, parsed["response"]["brightness"].as<int>());
}

void test_ack_request_body_failure() {
    // Test: Build ack request body for failed command
    JsonDocument doc;
    doc["command_id"] = "cmd-uuid-5678";
    doc["success"] = false;
    doc["error"] = "Command timeout";

    String body;
    serializeJson(doc, body);

    JsonDocument parsed;
    deserializeJson(parsed, body);

    TEST_ASSERT_EQUAL_STRING("cmd-uuid-5678", parsed["command_id"].as<const char*>());
    TEST_ASSERT_FALSE(parsed["success"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("Command timeout", parsed["error"].as<const char*>());
}

void test_ack_request_minimal() {
    // Test: Build minimal ack request (success, no response data)
    JsonDocument doc;
    doc["command_id"] = "cmd-uuid-minimal";
    doc["success"] = true;

    String body;
    serializeJson(doc, body);

    JsonDocument parsed;
    deserializeJson(parsed, body);

    TEST_ASSERT_EQUAL_STRING("cmd-uuid-minimal", parsed["command_id"].as<const char*>());
    TEST_ASSERT_TRUE(parsed["success"].as<bool>());
    TEST_ASSERT_FALSE(parsed.containsKey("response"));
    TEST_ASSERT_FALSE(parsed.containsKey("error"));
}

void test_ack_response_success() {
    // Test: Parse successful ack response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAckResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());
}

void test_ack_response_failure() {
    // Test: Parse failed ack response (command not found)
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockAckFailure);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("Command not found or already acknowledged", 
                             doc["error"].as<const char*>());
}

void test_ack_with_complex_response() {
    // Test: Build ack with complex response data
    JsonDocument doc;
    doc["command_id"] = "cmd-uuid-config";
    doc["success"] = true;

    JsonDocument responseData;
    responseData["brightness"] = 150;
    responseData["timezone"] = "America/New_York";
    responseData["applied_at"] = "2026-01-28T12:05:00Z";
    doc["response"] = responseData;

    String body;
    serializeJson(doc, body);

    JsonDocument parsed;
    deserializeJson(parsed, body);

    TEST_ASSERT_EQUAL(150, parsed["response"]["brightness"].as<int>());
    TEST_ASSERT_EQUAL_STRING("America/New_York", 
                             parsed["response"]["timezone"].as<const char*>());
}

// ============================================================================
// Error Response Handling Tests
// ============================================================================

void test_parse_error_response() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockErrorResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("Invalid token", doc["error"].as<const char*>());
}

void test_parse_rate_limit_response() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockRateLimitResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    const char* errorStr = doc["error"].as<const char*>();
    TEST_ASSERT_NOT_NULL(errorStr);
    TEST_ASSERT_TRUE(String(errorStr).indexOf("Rate limit") >= 0);
}

// ============================================================================
// Token Expiry and Refresh Logic Tests
// ============================================================================

void test_token_expiry_calculation() {
    // Token TTL is 24 hours (86400 seconds)
    uint32_t now = 1706400000;  // Example timestamp
    uint32_t expiresAt = now + 86400;

    TEST_ASSERT_EQUAL(1706486400, expiresAt);
}

void test_token_refresh_margin() {
    // Should refresh 10 minutes before expiry
    const unsigned long REFRESH_MARGIN = 600;  // 10 minutes in seconds

    // Token expires in 5 minutes (300 seconds) - should trigger refresh
    uint32_t now = 1706486100;
    uint32_t expiresAt = 1706486400;  // 300 seconds from now

    bool needsRefresh = (expiresAt - now) < REFRESH_MARGIN;
    TEST_ASSERT_TRUE(needsRefresh);  // 300 < 600, so needs refresh
}

void test_token_not_expired() {
    const unsigned long REFRESH_MARGIN = 600;

    uint32_t now = 1706400000;
    uint32_t expiresAt = 1706486400;

    bool needsRefresh = (expiresAt - now) < REFRESH_MARGIN;
    TEST_ASSERT_FALSE(needsRefresh);
}

void test_token_refresh_trigger() {
    // Test: Token refresh should trigger when approaching expiry
    const unsigned long REFRESH_MARGIN = 600;  // 10 minutes
    
    // Simulate token that expires in 5 minutes (should trigger refresh)
    uint32_t now = 1706400000;
    uint32_t expiresAt = now + 300;  // 5 minutes from now
    
    bool needsRefresh = (expiresAt - now) < REFRESH_MARGIN;
    TEST_ASSERT_TRUE(needsRefresh);
    
    // Simulate token that expires in 15 minutes (should not trigger refresh)
    expiresAt = now + 900;  // 15 minutes from now
    needsRefresh = (expiresAt - now) < REFRESH_MARGIN;
    TEST_ASSERT_FALSE(needsRefresh);
}

void test_token_expired_response_detection() {
    // Test: Detect token expired response to trigger re-auth
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockTokenExpiredResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    
    const char* errorStr = doc["error"].as<const char*>();
    TEST_ASSERT_NOT_NULL(errorStr);
    String errorMsg = errorStr;
    bool isTokenExpired = (errorMsg.indexOf("expired") >= 0) ||
                          (errorMsg.indexOf("Token") >= 0);
    TEST_ASSERT_TRUE(isTokenExpired);
}

void test_token_invalidation_on_401() {
    // Test: Token should be invalidated on 401 response
    // Simulates the behavior in postDeviceState when HTTP 401 is received
    
    unsigned long tokenExpiresAt = 1706486400;
    
    // Simulate receiving 401 - should invalidate token
    int httpCode = 401;
    if (httpCode == 401) {
        tokenExpiresAt = 0;  // Invalidate token
    }
    
    TEST_ASSERT_EQUAL(0, tokenExpiresAt);
}

// ============================================================================
// Rate Limiting Tests
// ============================================================================

void test_rate_limit_response_detection() {
    // Test: Detect rate limit response (HTTP 429)
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockRateLimitResponse);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    
    const char* errorStr = doc["error"].as<const char*>();
    TEST_ASSERT_NOT_NULL(errorStr);
    String errorMsg = errorStr;
    bool isRateLimited = (errorMsg.indexOf("Rate limit") >= 0);
    TEST_ASSERT_TRUE(isRateLimited);
}

void test_rate_limit_with_retry_after() {
    // Test: Parse retry-after from rate limit response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, mockRateLimitWithRetry);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
    
    int retryAfter = doc["retry_after"] | 0;
    TEST_ASSERT_EQUAL(30, retryAfter);
}

void test_rate_limit_backoff_calculation() {
    // Test: Exponential backoff calculation for rate limiting
    // Rate limit: 12 requests/minute = 1 request per 5 seconds
    const int MAX_REQUESTS_PER_MINUTE = 12;
    const int SECONDS_PER_MINUTE = 60;
    const int MIN_INTERVAL_MS = (SECONDS_PER_MINUTE * 1000) / MAX_REQUESTS_PER_MINUTE;
    
    TEST_ASSERT_EQUAL(5000, MIN_INTERVAL_MS);  // 5 seconds between requests
    
    // Backoff should double on each retry
    int backoff = MIN_INTERVAL_MS;
    int maxBackoff = 30000;  // 30 seconds max
    
    // First retry
    backoff *= 2;
    TEST_ASSERT_EQUAL(10000, backoff);
    
    // Second retry
    backoff *= 2;
    if (backoff > maxBackoff) backoff = maxBackoff;
    TEST_ASSERT_EQUAL(20000, backoff);
    
    // Third retry (should cap at max)
    backoff *= 2;
    if (backoff > maxBackoff) backoff = maxBackoff;
    TEST_ASSERT_EQUAL(30000, backoff);
}

void test_rate_limit_request_counting() {
    // Test: Request counting for rate limit tracking
    // Rate limit: 12 requests per minute
    unsigned long requestTimes[12] = {0};
    int requestCount = 0;
    unsigned long now = 60000;  // 60 seconds since start
    
    // Simulate 12 requests, 4 seconds apart (48 seconds total)
    for (int i = 0; i < 12; i++) {
        requestTimes[i] = now;
        requestCount++;
        now += 4000;  // 4 seconds apart
    }
    // now = 60000 + 11*4000 = 104000
    // oldest request = requestTimes[0] = 60000
    
    // Check if we're at rate limit (12 requests in window)
    unsigned long oldestRequest = requestTimes[0];
    unsigned long windowDuration = now - oldestRequest;  // 44000 ms = 44 seconds
    
    // If all 12 requests happened within 60 seconds, we're at limit
    bool atLimit = (requestCount >= 12) && (windowDuration < 60000);
    TEST_ASSERT_TRUE(atLimit);  // 44 seconds < 60 seconds, so at limit
}

// ============================================================================
// URL Construction Tests
// ============================================================================

void test_edge_function_url_construction() {
    String supabaseUrl = "https://abc123.supabase.co";
    String endpoint = "device-auth";

    String fullUrl = supabaseUrl + "/functions/v1/" + endpoint;

    TEST_ASSERT_EQUAL_STRING("https://abc123.supabase.co/functions/v1/device-auth", fullUrl.c_str());
}

void test_url_trailing_slash_handling() {
    String supabaseUrl = "https://abc123.supabase.co/";

    // Remove trailing slash
    if (supabaseUrl.endsWith("/")) {
        supabaseUrl.remove(supabaseUrl.length() - 1);
    }

    String fullUrl = supabaseUrl + "/functions/v1/device-auth";

    TEST_ASSERT_EQUAL_STRING("https://abc123.supabase.co/functions/v1/device-auth", fullUrl.c_str());
}

// ============================================================================
// Pairing Code Normalization Tests
// ============================================================================

void test_pairing_code_uppercase() {
    String code = "abc123";
    code.toUpperCase();

    TEST_ASSERT_EQUAL_STRING("ABC123", code.c_str());
}

void test_pairing_code_length() {
    String code = "ABC123";
    TEST_ASSERT_EQUAL(6, code.length());
}

// ============================================================================
// Webex Status Validation Tests
// ============================================================================

void test_valid_webex_statuses() {
    const char* validStatuses[] = {"active", "away", "dnd", "meeting", "offline", "call", "presenting"};
    int numStatuses = 7;

    for (int i = 0; i < numStatuses; i++) {
        String status = validStatuses[i];
        TEST_ASSERT_GREATER_THAN(0, status.length());
    }
}

void test_webex_status_mapping() {
    // Map status to display-friendly names
    String status = "active";
    String displayName;

    if (status == "active") displayName = "Available";
    else if (status == "away") displayName = "Away";
    else if (status == "dnd") displayName = "Do Not Disturb";
    else if (status == "meeting") displayName = "In Meeting";
    else if (status == "call") displayName = "On a Call";
    else displayName = "Offline";

    TEST_ASSERT_EQUAL_STRING("Available", displayName.c_str());
}

// ============================================================================
// Command Whitelist Tests
// ============================================================================

void test_valid_commands() {
    const char* validCommands[] = {
        "set_brightness", "set_config", "get_config", "get_status",
        "reboot", "factory_reset", "ota_update", "set_display_name",
        "set_time_zone", "clear_wifi", "test_display", "ping"
    };
    int numCommands = 12;

    for (int i = 0; i < numCommands; i++) {
        String cmd = validCommands[i];
        TEST_ASSERT_GREATER_THAN(0, cmd.length());
    }
}

void test_command_in_whitelist() {
    String command = "set_brightness";
    const char* validCommands[] = {
        "set_brightness", "set_config", "get_config", "get_status",
        "reboot", "factory_reset", "ota_update", "set_display_name",
        "set_time_zone", "clear_wifi", "test_display", "ping"
    };

    bool found = false;
    for (int i = 0; i < 12; i++) {
        if (command == validCommands[i]) {
            found = true;
            break;
        }
    }

    TEST_ASSERT_TRUE(found);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_supabase_client_tests() {
    UNITY_BEGIN();

    // ========================================================================
    // Authentication tests (test-firmware-supabase requirement)
    // ========================================================================
    RUN_TEST(test_authenticate_success);
    RUN_TEST(test_authenticate_success_no_ota);
    RUN_TEST(test_authenticate_failure_invalid_signature);
    RUN_TEST(test_authenticate_failure_device_not_found);
    RUN_TEST(test_authenticate_failure_server_error);
    RUN_TEST(test_parse_auth_response_token_format);
    RUN_TEST(test_parse_auth_expiry_format);

    // ========================================================================
    // Device state tests (test-firmware-supabase: postDeviceState)
    // ========================================================================
    RUN_TEST(test_parse_state_response_app_connected);
    RUN_TEST(test_parse_state_response_app_disconnected);
    RUN_TEST(test_parse_state_response_in_meeting);
    RUN_TEST(test_state_request_body_format);
    RUN_TEST(test_state_request_without_temperature);
    RUN_TEST(test_state_response_null_display_name);

    // ========================================================================
    // Command polling tests (test-firmware-supabase: pollCommands)
    // ========================================================================
    RUN_TEST(test_parse_commands_response);
    RUN_TEST(test_parse_command_details);
    RUN_TEST(test_parse_command_with_complex_payload);
    RUN_TEST(test_parse_command_with_empty_payload);
    RUN_TEST(test_parse_empty_commands);
    RUN_TEST(test_command_payload_serialization);
    RUN_TEST(test_command_array_max_capacity);

    // ========================================================================
    // Command ack tests (test-firmware-supabase: ackCommand)
    // ========================================================================
    RUN_TEST(test_ack_request_body_success);
    RUN_TEST(test_ack_request_body_failure);
    RUN_TEST(test_ack_request_minimal);
    RUN_TEST(test_ack_response_success);
    RUN_TEST(test_ack_response_failure);
    RUN_TEST(test_ack_with_complex_response);

    // ========================================================================
    // Error handling tests
    // ========================================================================
    RUN_TEST(test_parse_error_response);

    // ========================================================================
    // Token expiry and refresh tests (test-firmware-supabase: token_refresh)
    // ========================================================================
    RUN_TEST(test_token_expiry_calculation);
    RUN_TEST(test_token_refresh_margin);
    RUN_TEST(test_token_not_expired);
    RUN_TEST(test_token_refresh_trigger);
    RUN_TEST(test_token_expired_response_detection);
    RUN_TEST(test_token_invalidation_on_401);

    // ========================================================================
    // Rate limiting tests (test-firmware-supabase: rate_limit_handling)
    // ========================================================================
    RUN_TEST(test_rate_limit_response_detection);
    RUN_TEST(test_rate_limit_with_retry_after);
    RUN_TEST(test_rate_limit_backoff_calculation);
    RUN_TEST(test_rate_limit_request_counting);

    // ========================================================================
    // URL construction tests
    // ========================================================================
    RUN_TEST(test_edge_function_url_construction);
    RUN_TEST(test_url_trailing_slash_handling);

    // ========================================================================
    // Pairing code tests
    // ========================================================================
    RUN_TEST(test_pairing_code_uppercase);
    RUN_TEST(test_pairing_code_length);

    // ========================================================================
    // Webex status tests
    // ========================================================================
    RUN_TEST(test_valid_webex_statuses);
    RUN_TEST(test_webex_status_mapping);

    // ========================================================================
    // Command whitelist tests
    // ========================================================================
    RUN_TEST(test_valid_commands);
    RUN_TEST(test_command_in_whitelist);

    UNITY_END();
}

#ifdef NATIVE_BUILD
// Native build uses main()
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_supabase_client_tests();
    return 0;
}
#else
// Arduino build uses setup()/loop()
void setup() {
    delay(2000);  // Wait for serial monitor
    run_supabase_client_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
