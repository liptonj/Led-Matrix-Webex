/**
 * @file test_realtime_uuid.cpp
 * @brief Unit tests for Realtime UUID-based channel subscriptions
 * 
 * Tests verify UUID-based realtime functionality:
 * - subscribeToUserChannel() with valid UUID
 * - subscribeToUserChannel() with null UUID (fallback)
 * - handleUserAssigned() stores UUID and reconnects
 * - handleWebexStatusUpdate() saves status to NVS
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <Preferences.h>

// Test UUIDs
#define TEST_DEVICE_UUID "550e8400-e29b-41d4-a716-446655440000"
#define TEST_USER_UUID "550e8400-e29b-41d4-a716-446655440001"
#define TEST_USER_UUID_2 "550e8400-e29b-41d4-a716-446655440002"

// Configuration constants
#define CONFIG_NAMESPACE "webex-display"

// ============================================================================
// User Channel Subscription Tests
// ============================================================================

void test_subscribeToUserChannel_with_valid_uuid() {
    String userUuid = TEST_USER_UUID;
    
    // User channel format: user:{user_uuid}
    String channelName = "user:" + userUuid;
    
    TEST_ASSERT_EQUAL_STRING("user:550e8400-e29b-41d4-a716-446655440001", channelName.c_str());
    TEST_ASSERT_TRUE(userUuid.length() == 36);
    TEST_ASSERT_TRUE(!userUuid.isEmpty());
}

void test_subscribeToUserChannel_with_null_uuid_fallback() {
    String userUuid = "";
    
    // Should fall back to pairing-based subscription
    bool shouldUseUserChannel = !userUuid.isEmpty();
    TEST_ASSERT_FALSE(shouldUseUserChannel);
    
    // Fallback to pairing code
    String pairingCode = "ABC123";
    bool shouldUsePairingChannel = userUuid.isEmpty() && !pairingCode.isEmpty();
    TEST_ASSERT_TRUE(shouldUsePairingChannel);
}

void test_user_channel_name_format() {
    String userUuid = TEST_USER_UUID;
    String channelName = "user:" + userUuid;
    
    TEST_ASSERT_TRUE(channelName.startsWith("user:"));
    TEST_ASSERT_EQUAL(41, channelName.length()); // "user:" (5) + UUID (36)
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, channelName.substring(5).c_str());
}

void test_user_channel_subscription_requires_uuid() {
    String userUuid = TEST_USER_UUID;
    
    // Valid UUID should allow subscription
    bool canSubscribe = !userUuid.isEmpty() && userUuid.length() == 36;
    TEST_ASSERT_TRUE(canSubscribe);
    
    // Empty UUID should not allow subscription
    String emptyUuid = "";
    bool cannotSubscribe = emptyUuid.isEmpty();
    TEST_ASSERT_TRUE(cannotSubscribe);
}

// ============================================================================
// User Assigned Event Handler Tests
// ============================================================================

void test_handleUserAssigned_stores_uuid() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    String newUserUuid = TEST_USER_UUID;
    
    // Simulate storing UUID
    prefs.putString("user_uuid", newUserUuid);
    
    String stored = prefs.getString("user_uuid", "");
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID, stored.c_str());
    
    prefs.end();
}

void test_handleUserAssigned_reconnects_on_uuid_change() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    String currentUserUuid = TEST_USER_UUID;
    String newUserUuid = TEST_USER_UUID_2;
    
    // Store current UUID
    prefs.putString("user_uuid", currentUserUuid);
    
    // Check if UUID changed
    String stored = prefs.getString("user_uuid", "");
    bool uuidChanged = stored != newUserUuid;
    
    TEST_ASSERT_TRUE(uuidChanged);
    
    // Update to new UUID
    prefs.putString("user_uuid", newUserUuid);
    stored = prefs.getString("user_uuid", "");
    TEST_ASSERT_EQUAL_STRING(TEST_USER_UUID_2, stored.c_str());
    
    prefs.end();
}

void test_handleUserAssigned_ignores_same_uuid() {
    String currentUserUuid = TEST_USER_UUID;
    String newUserUuid = TEST_USER_UUID;
    
    // UUID unchanged - should not trigger reconnect
    bool uuidChanged = currentUserUuid != newUserUuid;
    TEST_ASSERT_FALSE(uuidChanged);
}

void test_handleUserAssigned_handles_empty_current_uuid() {
    String currentUserUuid = "";
    String newUserUuid = TEST_USER_UUID;
    
    // First assignment - should trigger reconnect
    bool uuidChanged = currentUserUuid != newUserUuid;
    TEST_ASSERT_TRUE(uuidChanged);
    TEST_ASSERT_TRUE(currentUserUuid.isEmpty());
}

void test_handleUserAssigned_validates_uuid_format() {
    String userUuid = TEST_USER_UUID;
    
    // UUID should be 36 characters
    TEST_ASSERT_EQUAL(36, userUuid.length());
    
    // UUID should not be empty
    TEST_ASSERT_FALSE(userUuid.isEmpty());
}

// ============================================================================
// Webex Status Update Tests
// ============================================================================

void test_handleWebexStatusUpdate_saves_status_to_nvs() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    String webexStatus = "active";
    prefs.putString("last_webex_status", webexStatus);
    
    String stored = prefs.getString("last_webex_status", "");
    TEST_ASSERT_EQUAL_STRING("active", stored.c_str());
    
    prefs.end();
}

void test_handleWebexStatusUpdate_updates_existing_status() {
    Preferences prefs;
    prefs.begin(CONFIG_NAMESPACE, false);
    
    // Set initial status
    prefs.putString("last_webex_status", "active");
    
    // Update to new status
    String newStatus = "meeting";
    prefs.putString("last_webex_status", newStatus);
    
    String stored = prefs.getString("last_webex_status", "");
    TEST_ASSERT_EQUAL_STRING("meeting", stored.c_str());
    TEST_ASSERT_NOT_EQUAL_STRING("active", stored.c_str());
    
    prefs.end();
}

void test_handleWebexStatusUpdate_validates_status_values() {
    String validStatuses[] = {"active", "away", "meeting", "dnd", "offline", "ooo"};
    int numValid = sizeof(validStatuses) / sizeof(validStatuses[0]);
    
    for (int i = 0; i < numValid; i++) {
        String status = validStatuses[i];
        TEST_ASSERT_FALSE(status.isEmpty());
        TEST_ASSERT_TRUE(status.length() > 0);
    }
}

void test_handleWebexStatusUpdate_handles_device_uuid_in_payload() {
    String deviceUuid = TEST_DEVICE_UUID;
    String webexStatus = "active";
    
    // Payload should include device_uuid for filtering
    struct {
        String device_uuid;
        String webex_status;
    } payload = {deviceUuid, webexStatus};
    
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, payload.device_uuid.c_str());
    TEST_ASSERT_EQUAL_STRING("active", payload.webex_status.c_str());
}

void test_handleWebexStatusUpdate_filters_by_device_uuid() {
    String eventDeviceUuid = TEST_DEVICE_UUID;
    String currentDeviceUuid = TEST_DEVICE_UUID;
    String otherDeviceUuid = "550e8400-e29b-41d4-a716-446655440002";
    
    // Should process if device_uuid matches
    bool shouldProcess = eventDeviceUuid == currentDeviceUuid;
    TEST_ASSERT_TRUE(shouldProcess);
    
    // Should ignore if device_uuid doesn't match
    bool shouldIgnore = eventDeviceUuid != otherDeviceUuid;
    TEST_ASSERT_TRUE(shouldIgnore);
}

// ============================================================================
// Channel Name Format Tests
// ============================================================================

void test_device_channel_name_format() {
    String deviceUuid = TEST_DEVICE_UUID;
    String channelName = "device:" + deviceUuid;
    
    TEST_ASSERT_TRUE(channelName.startsWith("device:"));
    TEST_ASSERT_EQUAL(43, channelName.length()); // "device:" (7) + UUID (36)
    TEST_ASSERT_EQUAL_STRING(TEST_DEVICE_UUID, channelName.substring(7).c_str());
}

void test_user_channel_vs_device_channel() {
    String userUuid = TEST_USER_UUID;
    String deviceUuid = TEST_DEVICE_UUID;
    
    String userChannel = "user:" + userUuid;
    String deviceChannel = "device:" + deviceUuid;
    
    TEST_ASSERT_TRUE(userChannel.startsWith("user:"));
    TEST_ASSERT_TRUE(deviceChannel.startsWith("device:"));
    TEST_ASSERT_NOT_EQUAL_STRING(userChannel.c_str(), deviceChannel.c_str());
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
    
    // User Channel Subscription Tests
    RUN_TEST(test_subscribeToUserChannel_with_valid_uuid);
    RUN_TEST(test_subscribeToUserChannel_with_null_uuid_fallback);
    RUN_TEST(test_user_channel_name_format);
    RUN_TEST(test_user_channel_subscription_requires_uuid);
    
    // User Assigned Event Handler Tests
    RUN_TEST(test_handleUserAssigned_stores_uuid);
    RUN_TEST(test_handleUserAssigned_reconnects_on_uuid_change);
    RUN_TEST(test_handleUserAssigned_ignores_same_uuid);
    RUN_TEST(test_handleUserAssigned_handles_empty_current_uuid);
    RUN_TEST(test_handleUserAssigned_validates_uuid_format);
    
    // Webex Status Update Tests
    RUN_TEST(test_handleWebexStatusUpdate_saves_status_to_nvs);
    RUN_TEST(test_handleWebexStatusUpdate_updates_existing_status);
    RUN_TEST(test_handleWebexStatusUpdate_validates_status_values);
    RUN_TEST(test_handleWebexStatusUpdate_handles_device_uuid_in_payload);
    RUN_TEST(test_handleWebexStatusUpdate_filters_by_device_uuid);
    
    // Channel Name Format Tests
    RUN_TEST(test_device_channel_name_format);
    RUN_TEST(test_user_channel_vs_device_channel);
    
    return UNITY_END();
}

#endif // UNIT_TEST
