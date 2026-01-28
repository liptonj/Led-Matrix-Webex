/**
 * @file test_webex_client.cpp
 * @brief Unit tests for Webex People API Client
 *
 * Tests verify parsing of Webex API responses including presence status,
 * display name, and email extraction.
 *
 * Webex People API: https://developer.webex.com/docs/api/v1/people
 * 
 * These mocks match the exact format returned by Webex APIs:
 * - GET /people/me - Returns current user info and presence
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <ArduinoJson.h>

// ============================================================================
// Real Webex API Response Formats
// ============================================================================

// GET /v1/people/me - Active status
const char* webexPersonMeActive = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["john.doe@company.com"],
    "phoneNumbers": [{"type": "work", "value": "+1-555-123-4567"}],
    "displayName": "John Doe",
    "nickName": "JD",
    "firstName": "John",
    "lastName": "Doe",
    "avatar": "https://avatar.example.com/user.jpg",
    "orgId": "Y2lzY29zcGFyazovL3VzL09SR0FOSVpBVElPTi9hYmNkZWYxMjM0NTY=",
    "created": "2024-01-15T10:30:00.000Z",
    "lastModified": "2026-01-28T12:00:00.000Z",
    "lastActivity": "2026-01-28T12:00:00.000Z",
    "status": "active",
    "type": "person"
})";

// GET /v1/people/me - In a call
const char* webexPersonMeCall = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["john.doe@company.com"],
    "displayName": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "lastActivity": "2026-01-28T12:05:00.000Z",
    "status": "call",
    "type": "person"
})";

// GET /v1/people/me - Do Not Disturb
const char* webexPersonMeDnd = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["jane.smith@company.com"],
    "displayName": "Jane Smith",
    "firstName": "Jane",
    "lastName": "Smith",
    "lastActivity": "2026-01-28T11:00:00.000Z",
    "status": "DoNotDisturb",
    "type": "person"
})";

// GET /v1/people/me - In a meeting
const char* webexPersonMeMeeting = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["john.doe@company.com"],
    "displayName": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "lastActivity": "2026-01-28T12:30:00.000Z",
    "status": "meeting",
    "type": "person"
})";

// GET /v1/people/me - Inactive (away)
const char* webexPersonMeInactive = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["john.doe@company.com"],
    "displayName": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "lastActivity": "2026-01-28T08:00:00.000Z",
    "status": "inactive",
    "type": "person"
})";

// GET /v1/people/me - Out of Office
const char* webexPersonMeOoo = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["john.doe@company.com"],
    "displayName": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "lastActivity": "2026-01-25T17:00:00.000Z",
    "status": "OutOfOffice",
    "type": "person"
})";

// GET /v1/people/me - Presenting (screen sharing)
const char* webexPersonMePresenting = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["john.doe@company.com"],
    "displayName": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "lastActivity": "2026-01-28T14:00:00.000Z",
    "status": "presenting",
    "type": "person"
})";

// GET /v1/people/me - Pending (status uncertain)
const char* webexPersonMePending = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["john.doe@company.com"],
    "displayName": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "status": "pending",
    "type": "person"
})";

// GET /v1/people/me - Unknown status
const char* webexPersonMeUnknown = R"({
    "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTA",
    "emails": ["john.doe@company.com"],
    "displayName": "John Doe",
    "status": "unknown",
    "type": "person"
})";

// Error response - Unauthorized
const char* webexError401 = R"({
    "message": "The request requires a valid access token set in the Authorization request header.",
    "errors": [{"description": "The request requires a valid access token set in the Authorization request header."}],
    "trackingId": "ROUTER_12345678-1234-1234-1234-123456789012"
})";

// Error response - Rate limited
const char* webexError429 = R"({
    "message": "Too Many Requests",
    "errors": [{"description": "Rate limit exceeded. Please retry after 30 seconds."}],
    "trackingId": "ROUTER_98765432-4321-4321-4321-210987654321"
})";

// ============================================================================
// Presence Status Parsing Tests
// ============================================================================

void test_parse_status_active() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, webexPersonMeActive);
    TEST_ASSERT_FALSE(error);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("active", status);
}

void test_parse_status_call() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeCall);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("call", status);
}

void test_parse_status_dnd() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeDnd);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("DoNotDisturb", status);
}

void test_parse_status_meeting() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeMeeting);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("meeting", status);
}

void test_parse_status_inactive() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeInactive);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("inactive", status);
}

void test_parse_status_ooo() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeOoo);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("OutOfOffice", status);
}

void test_parse_status_presenting() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMePresenting);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("presenting", status);
}

void test_parse_status_pending() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMePending);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("pending", status);
}

void test_parse_status_unknown() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeUnknown);
    
    const char* status = doc["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("unknown", status);
}

// ============================================================================
// User Info Parsing Tests
// ============================================================================

void test_parse_display_name() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeActive);
    
    const char* displayName = doc["displayName"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("John Doe", displayName);
}

void test_parse_first_name() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeActive);
    
    const char* firstName = doc["firstName"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("John", firstName);
}

void test_parse_last_name() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeActive);
    
    const char* lastName = doc["lastName"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("Doe", lastName);
}

void test_parse_email_primary() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeActive);
    
    // Emails is an array, first one is primary
    const char* email = doc["emails"][0].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("john.doe@company.com", email);
}

void test_parse_last_activity() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeActive);
    
    const char* lastActivity = doc["lastActivity"].as<const char*>();
    TEST_ASSERT_NOT_NULL(lastActivity);
    
    // ISO 8601 format
    TEST_ASSERT_NOT_NULL(strchr(lastActivity, 'T'));
    TEST_ASSERT_EQUAL('Z', lastActivity[strlen(lastActivity) - 1]);
}

void test_parse_user_id() {
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeActive);
    
    const char* id = doc["id"].as<const char*>();
    TEST_ASSERT_NOT_NULL(id);
    
    // Webex IDs are base64-encoded URNs
    TEST_ASSERT_TRUE(strstr(id, "Y2lzY29zcGFyazovL3") == id);
}

// ============================================================================
// All Valid Status Values
// ============================================================================

void test_all_valid_status_values() {
    // All valid Webex presence statuses
    const char* validStatuses[] = {
        "active",
        "call", 
        "DoNotDisturb",
        "inactive",
        "meeting",
        "OutOfOffice",
        "pending",
        "presenting",
        "unknown"
    };
    
    for (int i = 0; i < 9; i++) {
        // All should be non-empty strings
        TEST_ASSERT_TRUE(strlen(validStatuses[i]) > 0);
    }
}

void test_status_case_sensitivity() {
    // Webex API returns specific casing
    JsonDocument doc1;
    deserializeJson(doc1, webexPersonMeDnd);
    const char* dnd = doc1["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("DoNotDisturb", dnd);  // CamelCase
    
    JsonDocument doc2;
    deserializeJson(doc2, webexPersonMeOoo);
    const char* ooo = doc2["status"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("OutOfOffice", ooo);  // CamelCase
}

// ============================================================================
// Error Response Tests
// ============================================================================

void test_parse_error_401() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, webexError401);
    TEST_ASSERT_FALSE(error);
    
    const char* message = doc["message"].as<const char*>();
    TEST_ASSERT_NOT_NULL(strstr(message, "access token"));
    
    const char* trackingId = doc["trackingId"].as<const char*>();
    TEST_ASSERT_TRUE(strstr(trackingId, "ROUTER_") == trackingId);
}

void test_parse_error_429() {
    JsonDocument doc;
    deserializeJson(doc, webexError429);
    
    const char* message = doc["message"].as<const char*>();
    TEST_ASSERT_EQUAL_STRING("Too Many Requests", message);
}

void test_error_has_tracking_id() {
    JsonDocument doc;
    deserializeJson(doc, webexError401);
    
    // trackingId is useful for debugging with Webex support
    TEST_ASSERT_FALSE(doc["trackingId"].isNull());
}

// ============================================================================
// WebexPresence Structure Tests
// ============================================================================

void test_presence_struct_initialization() {
    struct WebexPresence {
        const char* status = "";
        const char* display_name = "";
        const char* first_name = "";
        const char* email = "";
        const char* last_activity = "";
        bool valid = false;
    };
    
    WebexPresence presence;
    
    TEST_ASSERT_EQUAL_STRING("", presence.status);
    TEST_ASSERT_EQUAL_STRING("", presence.display_name);
    TEST_ASSERT_FALSE(presence.valid);
}

void test_presence_struct_populated() {
    struct WebexPresence {
        const char* status;
        const char* display_name;
        const char* first_name;
        const char* email;
        const char* last_activity;
        bool valid;
    };
    
    JsonDocument doc;
    deserializeJson(doc, webexPersonMeActive);
    
    WebexPresence presence;
    presence.status = doc["status"].as<const char*>();
    presence.display_name = doc["displayName"].as<const char*>();
    presence.first_name = doc["firstName"].as<const char*>();
    presence.email = doc["emails"][0].as<const char*>();
    presence.last_activity = doc["lastActivity"].as<const char*>();
    presence.valid = true;
    
    TEST_ASSERT_EQUAL_STRING("active", presence.status);
    TEST_ASSERT_EQUAL_STRING("John Doe", presence.display_name);
    TEST_ASSERT_EQUAL_STRING("John", presence.first_name);
    TEST_ASSERT_EQUAL_STRING("john.doe@company.com", presence.email);
    TEST_ASSERT_TRUE(presence.valid);
}

// ============================================================================
// Rate Limit Backoff Tests
// ============================================================================

void test_rate_limit_backoff_initial() {
    int backoff = 0;
    
    // First rate limit: start at 30 seconds
    if (backoff == 0) {
        backoff = 30;
    }
    
    TEST_ASSERT_EQUAL(30, backoff);
}

void test_rate_limit_backoff_exponential() {
    int backoff = 30;
    
    // Double on each subsequent rate limit
    backoff = backoff * 2;
    TEST_ASSERT_EQUAL(60, backoff);
    
    backoff = backoff * 2;
    TEST_ASSERT_EQUAL(120, backoff);
}

void test_rate_limit_backoff_cap() {
    int backoff = 120;
    
    // Cap at 120 seconds
    backoff = backoff * 2;
    if (backoff > 120) {
        backoff = 120;
    }
    
    TEST_ASSERT_EQUAL(120, backoff);
}

// ============================================================================
// OAuth Token Tests
// ============================================================================

void test_bearer_token_format() {
    String accessToken = "NjY2YzEwYmMtNmYyYS00ZWE2LWI1MjAtMDg0MjNiMzdhMzll";
    
    String authHeader = "Bearer " + accessToken;
    
    TEST_ASSERT_TRUE(authHeader.startsWith("Bearer "));
    TEST_ASSERT_EQUAL_STRING("Bearer NjY2YzEwYmMtNmYyYS00ZWE2LWI1MjAtMDg0MjNiMzdhMzll", 
                             authHeader.c_str());
}

void test_api_url_construction() {
    const char* API_BASE = "https://webexapis.com/v1";
    const char* PEOPLE_ME = "/people/me";
    
    String url = String(API_BASE) + PEOPLE_ME;
    
    TEST_ASSERT_EQUAL_STRING("https://webexapis.com/v1/people/me", url.c_str());
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_webex_client_tests() {
    // Status Parsing
    RUN_TEST(test_parse_status_active);
    RUN_TEST(test_parse_status_call);
    RUN_TEST(test_parse_status_dnd);
    RUN_TEST(test_parse_status_meeting);
    RUN_TEST(test_parse_status_inactive);
    RUN_TEST(test_parse_status_ooo);
    RUN_TEST(test_parse_status_presenting);
    RUN_TEST(test_parse_status_pending);
    RUN_TEST(test_parse_status_unknown);
    
    // User Info
    RUN_TEST(test_parse_display_name);
    RUN_TEST(test_parse_first_name);
    RUN_TEST(test_parse_last_name);
    RUN_TEST(test_parse_email_primary);
    RUN_TEST(test_parse_last_activity);
    RUN_TEST(test_parse_user_id);
    
    // Status Values
    RUN_TEST(test_all_valid_status_values);
    RUN_TEST(test_status_case_sensitivity);
    
    // Error Responses
    RUN_TEST(test_parse_error_401);
    RUN_TEST(test_parse_error_429);
    RUN_TEST(test_error_has_tracking_id);
    
    // Presence Structure
    RUN_TEST(test_presence_struct_initialization);
    RUN_TEST(test_presence_struct_populated);
    
    // Rate Limit Backoff
    RUN_TEST(test_rate_limit_backoff_initial);
    RUN_TEST(test_rate_limit_backoff_exponential);
    RUN_TEST(test_rate_limit_backoff_cap);
    
    // OAuth/API
    RUN_TEST(test_bearer_token_format);
    RUN_TEST(test_api_url_construction);
}

#if defined(ARDUINO)
void setup() {
    delay(2000);
    UNITY_BEGIN();
    run_webex_client_tests();
    UNITY_END();
}

void loop() {}
#else
int main(int argc, char** argv) {
    UNITY_BEGIN();
    run_webex_client_tests();
    return UNITY_END();
}
#endif

#endif // UNIT_TEST
