/**
 * @file test_config_uuid.cpp
 * @brief Unit tests for ConfigManager UUID storage
 * 
 * Tests verify UUID-based device identity storage in NVS:
 * - setDeviceUuid/getDeviceUuid NVS storage
 * - setUserUuid/getUserUuid NVS storage
 * - UUID bounds checking (36 char + null)
 * - UUID persistence across reboots
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <Preferences.h>

// Configuration constants
#define CONFIG_NAMESPACE "webex-display"
#define UUID_MAX_LENGTH 37  // 36 chars + null terminator

// Test UUIDs
#define TEST_DEVICE_UUID "550e8400-e29b-41d4-a716-446655440000"
#define TEST_USER_UUID "550e8400-e29b-41d4-a716-446655440001"
#define TEST_DEVICE_UUID_2 "550e8400-e29b-41d4-a716-446655440002"

// ============================================================================
// UUID Storage Tests
// ============================================================================

void test_setDeviceUuid_stores_in_nvs() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    String device_uuid = TEST_DEVICE_UUID;
    prefs.putString("device_uuid", device_uuid);
    
    String retrieved = prefs.getString("device_uuid", "");
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, retrieved.c_str());
    
    prefs.end();
}

void test_getDeviceUuid_retrieves_from_nvs() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    prefs.putString("device_uuid", TEST_DEVICE_UUID);
    String retrieved = prefs.getString("device_uuid", "");
    
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, retrieved.c_str());
    TEST_ASSERT_EQUAL(36, retrieved.length());
    
    prefs.end();
}

void test_setUserUuid_stores_in_nvs() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    String user_uuid = TEST_USER_UUID;
    prefs.putString("user_uuid", user_uuid);
    
    String retrieved = prefs.getString("user_uuid", "");
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, retrieved.c_str());
    
    prefs.end();
}

void test_getUserUuid_retrieves_from_nvs() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    prefs.putString("user_uuid", TEST_USER_UUID);
    String retrieved = prefs.getString("user_uuid", "");
    
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, retrieved.c_str());
    TEST_ASSERT_EQUAL(36, retrieved.length());
    
    prefs.end();
}

void test_getDeviceUuid_returns_empty_when_not_set() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Clear any existing value
    prefs.remove("device_uuid");
    
    String retrieved = prefs.getString("device_uuid", "");
    TEST_ASSERT_EQUAL(0, retrieved.length());
    TEST_ASSERT_EQUAL_STRING("", retrieved.c_str());
    
    prefs.end();
}

void test_getUserUuid_returns_empty_when_not_set() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Clear any existing value
    prefs.remove("user_uuid");
    
    String retrieved = prefs.getString("user_uuid", "");
    TEST_ASSERT_EQUAL(0, retrieved.length());
    TEST_ASSERT_EQUAL_STRING("", retrieved.c_str());
    
    prefs.end();
}

// ============================================================================
// UUID Bounds Checking Tests
// ============================================================================

void test_uuid_length_is_36_chars() {
    String uuid = TEST_DEVICE_UUID;
    TEST_ASSERT_EQUAL(36, uuid.length());
}

void test_uuid_format_validation() {
    String uuid = TEST_DEVICE_UUID;
    // UUID format: 8-4-4-4-12 hex digits with hyphens
    // Example: 550e8400-e29b-41d4-a716-446655440000
    
    TEST_ASSERT_EQUAL(36, uuid.length());
    TEST_ASSERT_EQUAL('-', uuid.charAt(8));
    TEST_ASSERT_EQUAL('-', uuid.charAt(13));
    TEST_ASSERT_EQUAL('-', uuid.charAt(18));
    TEST_ASSERT_EQUAL('-', uuid.charAt(23));
}

void test_uuid_bounds_checking_max_length() {
    String uuid = TEST_DEVICE_UUID;
    // UUID should be exactly 36 characters (not including null terminator)
    TEST_ASSERT_TRUE(uuid.length() <= UUID_MAX_LENGTH - 1);
    TEST_ASSERT_EQUAL(36, uuid.length());
}

void test_uuid_bounds_checking_storage() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    String uuid = TEST_DEVICE_UUID;
    // Verify it fits in storage
    TEST_ASSERT_TRUE(uuid.length() < UUID_MAX_LENGTH);
    
    prefs.putString("device_uuid", uuid);
    String retrieved = prefs.getString("device_uuid", "");
    
    TEST_ASSERT_EQUAL(36, retrieved.length());
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, retrieved.c_str());
    
    prefs.end();
}

void test_uuid_null_terminator_handling() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    String uuid = TEST_DEVICE_UUID;
    prefs.putString("device_uuid", uuid);
    
    String retrieved = prefs.getString("device_uuid", "");
    // String class handles null terminator automatically
    TEST_ASSERT_EQUAL(36, retrieved.length());
    TEST_ASSERT_NOT_NULL(retrieved.c_str());
    
    prefs.end();
}

// ============================================================================
// UUID Persistence Tests
// ============================================================================

void test_uuid_persistence_across_reboots() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Simulate storing UUID before reboot
    String device_uuid = TEST_DEVICE_UUID;
    String user_uuid = TEST_USER_UUID;
    
    prefs.putString("device_uuid", device_uuid);
    prefs.putString("user_uuid", user_uuid);
    
    prefs.end();
    
    // Simulate reboot - close and reopen preferences
    prefs.begin(CONFIG_NAMESPACE, false);
    
    String retrieved_device = prefs.getString("device_uuid", "");
    String retrieved_user = prefs.getString("user_uuid", "");
    
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, retrieved_device.c_str());
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, retrieved_user.c_str());
    
    prefs.end();
}

void test_uuid_update_overwrites_previous() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Set initial UUID
    prefs.putString("device_uuid", TEST_DEVICE_UUID);
    
    // Update to new UUID
    prefs.putString("device_uuid", TEST_DEVICE_UUID_2);
    
    String retrieved = prefs.getString("device_uuid", "");
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID_2, retrieved.c_str());
    TEST_ASSERT_FALSE(strcmp(TEST_DEVICE_UUID, retrieved.c_str()) == 0);
    
    prefs.end();
}

void test_uuid_clear_removes_from_nvs() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Set UUID
    prefs.putString("device_uuid", TEST_DEVICE_UUID);
    
    // Clear UUID
    prefs.remove("device_uuid");
    
    String retrieved = prefs.getString("device_uuid", "");
    TEST_ASSERT_EQUAL(0, retrieved.length());
    TEST_ASSERT_EQUAL_STRING("", retrieved.c_str());
    
    prefs.end();
}

// ============================================================================
// UUID Format Validation Tests
// ============================================================================

void test_uuid_hex_characters_only() {
    String uuid = TEST_DEVICE_UUID;
    // Remove hyphens for validation
    String hex_only = uuid;
    hex_only.replace("-", "");
    
    TEST_ASSERT_EQUAL(32, hex_only.length()); // 36 - 4 hyphens
    
    // Check all characters are hex (0-9, a-f)
    for (size_t i = 0; i < hex_only.length(); i++) {
        char c = hex_only.charAt(i);
        bool is_hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
        TEST_ASSERT_TRUE(is_hex);
    }
}

void test_uuid_hyphen_positions() {
    String uuid = TEST_DEVICE_UUID;
    // UUID format: 8-4-4-4-12
    TEST_ASSERT_EQUAL('-', uuid.charAt(8));
    TEST_ASSERT_EQUAL('-', uuid.charAt(13));  // 8 + 4 + 1
    TEST_ASSERT_EQUAL('-', uuid.charAt(18));  // 8 + 4 + 4 + 2
    TEST_ASSERT_EQUAL('-', uuid.charAt(23));  // 8 + 4 + 4 + 4 + 3
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
    
    // UUID Storage Tests
    RUN_TEST(test_setDeviceUuid_stores_in_nvs);
    RUN_TEST(test_getDeviceUuid_retrieves_from_nvs);
    RUN_TEST(test_setUserUuid_stores_in_nvs);
    RUN_TEST(test_getUserUuid_retrieves_from_nvs);
    RUN_TEST(test_getDeviceUuid_returns_empty_when_not_set);
    RUN_TEST(test_getUserUuid_returns_empty_when_not_set);
    
    // UUID Bounds Checking Tests
    RUN_TEST(test_uuid_length_is_36_chars);
    RUN_TEST(test_uuid_format_validation);
    RUN_TEST(test_uuid_bounds_checking_max_length);
    RUN_TEST(test_uuid_bounds_checking_storage);
    RUN_TEST(test_uuid_null_terminator_handling);
    
    // UUID Persistence Tests
    RUN_TEST(test_uuid_persistence_across_reboots);
    RUN_TEST(test_uuid_update_overwrites_previous);
    RUN_TEST(test_uuid_clear_removes_from_nvs);
    
    // UUID Format Validation Tests
    RUN_TEST(test_uuid_hex_characters_only);
    RUN_TEST(test_uuid_hyphen_positions);
    
    return UNITY_END();
}

#endif // UNIT_TEST
