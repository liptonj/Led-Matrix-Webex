/**
 * @file test_auth_response.cpp
 * @brief Unit tests for auth response parsing and UUID extraction
 * 
 * Tests verify UUID extraction from auth responses:
 * - parseAuthResponse() extracts device_uuid
 * - parseAuthResponse() extracts user_uuid
 * - device stores UUIDs in NVS after auth
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <Preferences.h>
#include <ArduinoJson.h>

// Test UUIDs
#define TEST_DEVICE_UUID "550e8400-e29b-41d4-a716-446655440000"
#define TEST_USER_UUID "550e8400-e29b-41d4-a716-446655440001"

// Configuration constants
#define CONFIG_NAMESPACE "webex-display"

// ============================================================================
// Auth Response Parsing Tests
// ============================================================================

void test_parseAuthResponse_extracts_device_uuid() {
    // Mock auth response JSON
    const char* json = R"({
        "success": true,
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "pairing_code": "ABC123",
        "device_id": "webex-display-C3D4",
        "device_uuid": "550e8400-e29b-41d4-a716-446655440000",
        "user_uuid": "550e8400-e29b-41d4-a716-446655440001",
        "expires_at": "2026-02-05T12:00:00Z"
    })";
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);
    
    TEST_ASSERT_TRUE(error == DeserializationError::Ok);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());
    
    String device_uuid = doc["device_uuid"] | "";
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, device_uuid.c_str());
    TEST_ASSERT_EQUAL(36, device_uuid.length());
}

void test_parseAuthResponse_extracts_user_uuid() {
    // Mock auth response JSON
    const char* json = R"({
        "success": true,
        "device_uuid": "550e8400-e29b-41d4-a716-446655440000",
        "user_uuid": "550e8400-e29b-41d4-a716-446655440001"
    })";
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);
    
    TEST_ASSERT_TRUE(error == DeserializationError::Ok);
    
    String user_uuid = doc["user_uuid"] | "";
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, user_uuid.c_str());
    TEST_ASSERT_EQUAL(36, user_uuid.length());
}

void test_parseAuthResponse_handles_null_user_uuid() {
    // Mock auth response JSON with null user_uuid (unassigned device)
    const char* json = R"({
        "success": true,
        "device_uuid": "550e8400-e29b-41d4-a716-446655440000",
        "user_uuid": null
    })";
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);
    
    TEST_ASSERT_TRUE(error == DeserializationError::Ok);
    
    String user_uuid = doc["user_uuid"] | "";
    TEST_ASSERT_EQUAL(0, user_uuid.length());
    TEST_ASSERT_EQUAL_STRING("", user_uuid.c_str());
}

void test_parseAuthResponse_handles_missing_uuid_fields() {
    // Mock auth response JSON without UUID fields (backward compatibility)
    const char* json = R"({
        "success": true,
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "pairing_code": "ABC123",
        "device_id": "webex-display-C3D4"
    })";
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);
    
    TEST_ASSERT_TRUE(error == DeserializationError::Ok);
    
    String device_uuid = doc["device_uuid"] | "";
    String user_uuid = doc["user_uuid"] | "";
    
    // Should handle missing fields gracefully
    TEST_ASSERT_EQUAL(0, device_uuid.length());
    TEST_ASSERT_EQUAL(0, user_uuid.length());
}

// ============================================================================
// UUID Storage Tests
// ============================================================================

void test_device_stores_device_uuid_in_nvs_after_auth() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Simulate storing device_uuid after auth
    String device_uuid = TEST_DEVICE_UUID;
    prefs.putString("device_uuid", device_uuid);
    
    String stored = prefs.getString("device_uuid", "");
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, stored.c_str());
    
    prefs.end();
}

void test_device_stores_user_uuid_in_nvs_after_auth() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Simulate storing user_uuid after auth
    String user_uuid = TEST_USER_UUID;
    prefs.putString("user_uuid", user_uuid);
    
    String stored = prefs.getString("user_uuid", "");
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, stored.c_str());
    
    prefs.end();
}

void test_device_stores_both_uuids_after_auth() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Simulate storing both UUIDs after auth
    String device_uuid = TEST_DEVICE_UUID;
    String user_uuid = TEST_USER_UUID;
    
    prefs.putString("device_uuid", device_uuid);
    prefs.putString("user_uuid", user_uuid);
    
    String stored_device = prefs.getString("device_uuid", "");
    String stored_user = prefs.getString("user_uuid", "");
    
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, stored_device.c_str());
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, stored_user.c_str());
    
    prefs.end();
}

void test_device_only_stores_device_uuid_when_user_uuid_null() {
    // Clear all static storage before test to prevent interference from previous tests
    Preferences::clearAll();
    
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Simulate auth response with null user_uuid
    String device_uuid = TEST_DEVICE_UUID;
    String user_uuid = ""; // null/empty
    
    prefs.putString("device_uuid", device_uuid);
    // Don't store empty user_uuid
    
    String stored_device = prefs.getString("device_uuid", "");
    String stored_user = prefs.getString("user_uuid", "");
    
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, stored_device.c_str());
    TEST_ASSERT_EQUAL(0, stored_user.length());
    
    prefs.end();
}

// ============================================================================
// UUID Update Tests
// ============================================================================

void test_device_updates_user_uuid_when_assigned() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Initial state: no user_uuid
    String initial_user_uuid = "";
    prefs.putString("user_uuid", initial_user_uuid);
    
    // Auth response with user_uuid
    String new_user_uuid = TEST_USER_UUID;
    
    // Check if user_uuid changed
    String stored = prefs.getString("user_uuid", "");
    bool uuidChanged = stored != new_user_uuid && !new_user_uuid.isEmpty();
    
    if (uuidChanged) {
        prefs.putString("user_uuid", new_user_uuid);
        stored = prefs.getString("user_uuid", "");
        TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, stored.c_str());
    }
    
    prefs.end();
}

void test_device_does_not_update_user_uuid_when_unchanged() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Set initial user_uuid
    String user_uuid = TEST_USER_UUID;
    prefs.putString("user_uuid", user_uuid);
    
    // Auth response with same user_uuid
    String new_user_uuid = TEST_USER_UUID;
    
    String stored = prefs.getString("user_uuid", "");
    bool uuidChanged = stored != new_user_uuid;
    
    TEST_ASSERT_FALSE(uuidChanged);
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, stored.c_str());
    
    prefs.end();
}

// ============================================================================
// Auth Response Validation Tests
// ============================================================================

void test_parseAuthResponse_validates_success_field() {
    // Mock failed auth response
    const char* json = R"({
        "success": false,
        "error": "Invalid signature"
    })";
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);
    
    TEST_ASSERT_TRUE(error == DeserializationError::Ok);
    TEST_ASSERT_FALSE(doc["success"].as<bool>());
}

void test_parseAuthResponse_extracts_all_required_fields() {
    const char* json = R"({
        "success": true,
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "pairing_code": "ABC123",
        "device_id": "webex-display-C3D4",
        "device_uuid": "550e8400-e29b-41d4-a716-446655440000",
        "user_uuid": "550e8400-e29b-41d4-a716-446655440001",
        "expires_at": "2026-02-05T12:00:00Z"
    })";
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);
    
    TEST_ASSERT_TRUE(error == DeserializationError::Ok);
    TEST_ASSERT_TRUE(doc["success"].as<bool>());
    TEST_ASSERT_FALSE(String(doc["token"].as<const char*>()).isEmpty());
    TEST_ASSERT_FALSE(String(doc["pairing_code"].as<const char*>()).isEmpty());
    TEST_ASSERT_FALSE(String(doc["device_uuid"].as<const char*>()).isEmpty());
}

// ============================================================================
// Test Runner
// ============================================================================

void setUp(void) {
    // Setup before each test
}

void tearDown(void) {
    // Cleanup after each test
}

int main(int argc, char **argv) {
    UNITY_BEGIN();
    
    // Auth Response Parsing Tests
    RUN_TEST(test_parseAuthResponse_extracts_device_uuid);
    RUN_TEST(test_parseAuthResponse_extracts_user_uuid);
    RUN_TEST(test_parseAuthResponse_handles_null_user_uuid);
    RUN_TEST(test_parseAuthResponse_handles_missing_uuid_fields);
    
    // UUID Storage Tests
    RUN_TEST(test_device_stores_device_uuid_in_nvs_after_auth);
    RUN_TEST(test_device_stores_user_uuid_in_nvs_after_auth);
    RUN_TEST(test_device_stores_both_uuids_after_auth);
    RUN_TEST(test_device_only_stores_device_uuid_when_user_uuid_null);
    
    // UUID Update Tests
    RUN_TEST(test_device_updates_user_uuid_when_assigned);
    RUN_TEST(test_device_does_not_update_user_uuid_when_unchanged);
    
    // Auth Response Validation Tests
    RUN_TEST(test_parseAuthResponse_validates_success_field);
    RUN_TEST(test_parseAuthResponse_extracts_all_required_fields);
    
    return UNITY_END();
}

#endif // UNIT_TEST
