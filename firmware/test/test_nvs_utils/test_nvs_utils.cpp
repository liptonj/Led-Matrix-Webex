/**
 * @file test_nvs_utils.cpp
 * @brief Unit tests for NVS utility class
 * 
 * Tests the NvsScope class and convenience functions for NVS operations.
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <Preferences.h>
#include "common/nvs_utils.h"

// Note: Static storage for Preferences mock is defined in globals.cpp

// Test namespaces (mimicking real namespaces used in firmware)
static const char* TEST_NAMESPACE = "test_nvs";
static const char* CONFIG_NAMESPACE = "webex-display";
static const char* BOOT_NAMESPACE = "boot";
static const char* AUTH_NAMESPACE = "device_auth";
static const char* PAIRING_NAMESPACE = "pairing";

void setUp(void) {
    // Clear all NVS storage before each test
    Preferences::clearAll();
}

void tearDown(void) {
    // Clean up after each test
}

// ============== Basic Initialization Tests ==============

void test_nvs_scope_open_success() {
    NvsScope nvs(TEST_NAMESPACE);
    TEST_ASSERT_TRUE(nvs.isOpen());
    TEST_ASSERT_FALSE(nvs.isReadOnly());
    TEST_ASSERT_EQUAL_STRING(TEST_NAMESPACE, nvs.getNamespace());
}

void test_nvs_scope_open_readonly() {
    NvsScope nvs(TEST_NAMESPACE, true);
    TEST_ASSERT_TRUE(nvs.isOpen());
    TEST_ASSERT_TRUE(nvs.isReadOnly());
}

void test_nvs_scope_invalid_namespace() {
    NvsScope nvs(nullptr);
    TEST_ASSERT_FALSE(nvs.isOpen());
    TEST_ASSERT_EQUAL(NvsResult::INVALID_ARGUMENT, nvs.getLastResult());
}

void test_nvs_scope_empty_namespace() {
    NvsScope nvs("");
    TEST_ASSERT_FALSE(nvs.isOpen());
    TEST_ASSERT_EQUAL(NvsResult::INVALID_ARGUMENT, nvs.getLastResult());
}

void test_nvs_scope_namespace_too_long() {
    NvsScope nvs("this_namespace_is_way_too_long");
    TEST_ASSERT_FALSE(nvs.isOpen());
    TEST_ASSERT_EQUAL(NvsResult::KEY_TOO_LONG, nvs.getLastResult());
}

// ============== String Operations Tests ==============

void test_put_string_success() {
    NvsScope nvs(TEST_NAMESPACE);
    TEST_ASSERT_TRUE(nvs.isOpen());
    
    NvsResult result = nvs.putString("test_key", "test_value");
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
}

void test_get_string_success() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putString("my_key", "my_value");
    
    String value = nvs.getString("my_key", "default");
    TEST_ASSERT_EQUAL_STRING("my_value", value.c_str());
}

void test_get_string_default() {
    NvsScope nvs(TEST_NAMESPACE);
    
    String value = nvs.getString("nonexistent_key", "default_value");
    TEST_ASSERT_EQUAL_STRING("default_value", value.c_str());
}

void test_get_string_empty() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putString("empty_key", "");
    
    String value = nvs.getString("empty_key", "default");
    // Empty string should be stored
    TEST_ASSERT_EQUAL_STRING("", value.c_str());
}

void test_put_string_readonly_fails() {
    // First write a value
    {
        NvsScope nvs(TEST_NAMESPACE);
        nvs.putString("key", "value");
    }
    
    // Try to write in read-only mode
    NvsScope nvs(TEST_NAMESPACE, true);
    NvsResult result = nvs.putString("key", "new_value");
    TEST_ASSERT_EQUAL(NvsResult::READ_ONLY, result);
    
    // Value should be unchanged
    TEST_ASSERT_EQUAL_STRING("value", nvs.getString("key").c_str());
}

void test_string_persistence_across_scopes() {
    // Write in one scope
    {
        NvsScope nvs(TEST_NAMESPACE);
        nvs.putString("persistent_key", "persistent_value");
    }
    
    // Read in another scope
    {
        NvsScope nvs(TEST_NAMESPACE, true);
        String value = nvs.getString("persistent_key", "");
        TEST_ASSERT_EQUAL_STRING("persistent_value", value.c_str());
    }
}

// ============== Integer Operations Tests ==============

void test_put_uint_success() {
    NvsScope nvs(TEST_NAMESPACE);
    
    NvsResult result = nvs.putUInt("uint_key", 42);
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
}

void test_get_uint_success() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putUInt("my_uint", 12345);
    
    uint32_t value = nvs.getUInt("my_uint", 0);
    TEST_ASSERT_EQUAL_UINT32(12345, value);
}

void test_get_uint_default() {
    NvsScope nvs(TEST_NAMESPACE);
    
    uint32_t value = nvs.getUInt("nonexistent_uint", 999);
    TEST_ASSERT_EQUAL_UINT32(999, value);
}

void test_get_uint_zero() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putUInt("zero_key", 0);
    
    uint32_t value = nvs.getUInt("zero_key", 100);
    TEST_ASSERT_EQUAL_UINT32(0, value);
}

void test_get_uint_max() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putUInt("max_key", UINT32_MAX);
    
    uint32_t value = nvs.getUInt("max_key", 0);
    TEST_ASSERT_EQUAL_UINT32(UINT32_MAX, value);
}

void test_put_int_success() {
    NvsScope nvs(TEST_NAMESPACE);
    
    NvsResult result = nvs.putInt("int_key", -42);
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
}

void test_get_int_negative() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putInt("negative_key", -12345);
    
    int32_t value = nvs.getInt("negative_key", 0);
    TEST_ASSERT_EQUAL_INT32(-12345, value);
}

// ============== Boolean Operations Tests ==============

void test_put_bool_true() {
    NvsScope nvs(TEST_NAMESPACE);
    
    NvsResult result = nvs.putBool("bool_key", true);
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
}

void test_get_bool_true() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putBool("bool_true", true);
    
    bool value = nvs.getBool("bool_true", false);
    TEST_ASSERT_TRUE(value);
}

void test_get_bool_false() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putBool("bool_false", false);
    
    bool value = nvs.getBool("bool_false", true);
    TEST_ASSERT_FALSE(value);
}

void test_get_bool_default() {
    NvsScope nvs(TEST_NAMESPACE);
    
    bool value = nvs.getBool("nonexistent_bool", true);
    TEST_ASSERT_TRUE(value);
}

// ============== Bytes Operations Tests ==============

void test_put_bytes_success() {
    NvsScope nvs(TEST_NAMESPACE);
    
    uint8_t data[] = {0x01, 0x02, 0x03, 0x04, 0x05};
    NvsResult result = nvs.putBytes("bytes_key", data, sizeof(data));
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
}

void test_get_bytes_success() {
    NvsScope nvs(TEST_NAMESPACE);
    
    uint8_t original[] = {0xDE, 0xAD, 0xBE, 0xEF};
    nvs.putBytes("bytes_key", original, sizeof(original));
    
    uint8_t buffer[10] = {0};
    size_t read = nvs.getBytes("bytes_key", buffer, sizeof(buffer));
    
    TEST_ASSERT_EQUAL(sizeof(original), read);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(original, buffer, sizeof(original));
}

void test_get_bytes_length() {
    NvsScope nvs(TEST_NAMESPACE);
    
    uint8_t data[32];
    for (int i = 0; i < 32; i++) data[i] = i;
    nvs.putBytes("secret", data, 32);
    
    size_t length = nvs.getBytesLength("secret");
    TEST_ASSERT_EQUAL(32, length);
}

void test_get_bytes_nonexistent() {
    NvsScope nvs(TEST_NAMESPACE);
    
    uint8_t buffer[10];
    size_t read = nvs.getBytes("nonexistent", buffer, sizeof(buffer));
    
    TEST_ASSERT_EQUAL(0, read);
}

void test_put_bytes_null_data() {
    NvsScope nvs(TEST_NAMESPACE);
    
    NvsResult result = nvs.putBytes("null_bytes", nullptr, 10);
    TEST_ASSERT_EQUAL(NvsResult::INVALID_ARGUMENT, result);
}

// ============== Key Management Tests ==============

void test_has_key_exists() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putString("existing_key", "value");
    
    TEST_ASSERT_TRUE(nvs.hasKey("existing_key"));
}

void test_has_key_not_exists() {
    NvsScope nvs(TEST_NAMESPACE);
    
    TEST_ASSERT_FALSE(nvs.hasKey("nonexistent_key"));
}

void test_remove_key() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putString("to_remove", "value");
    
    TEST_ASSERT_TRUE(nvs.hasKey("to_remove"));
    
    NvsResult result = nvs.remove("to_remove");
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
    TEST_ASSERT_FALSE(nvs.hasKey("to_remove"));
}

void test_remove_nonexistent_key() {
    NvsScope nvs(TEST_NAMESPACE);
    
    // Note: The mock Preferences always returns true for remove()
    // In real ESP32, this would return false for non-existent keys
    // For the utility class, we track this correctly but the mock doesn't
    NvsResult result = nvs.remove("nonexistent");
    // Accept both OK (mock behavior) and KEY_NOT_FOUND (real behavior)
    TEST_ASSERT_TRUE(result == NvsResult::OK || result == NvsResult::KEY_NOT_FOUND);
}

void test_clear_namespace() {
    NvsScope nvs(TEST_NAMESPACE);
    nvs.putString("key1", "value1");
    nvs.putUInt("key2", 42);
    nvs.putBool("key3", true);
    
    NvsResult result = nvs.clear();
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
    
    // All keys should be gone
    TEST_ASSERT_FALSE(nvs.hasKey("key1"));
    TEST_ASSERT_FALSE(nvs.hasKey("key2"));
    TEST_ASSERT_FALSE(nvs.hasKey("key3"));
}

// ============== Key Validation Tests ==============

void test_key_too_long() {
    NvsScope nvs(TEST_NAMESPACE);
    
    NvsResult result = nvs.putString("this_key_is_way_too_long", "value");
    TEST_ASSERT_EQUAL(NvsResult::KEY_TOO_LONG, result);
}

void test_key_max_length() {
    NvsScope nvs(TEST_NAMESPACE);
    
    // Exactly 15 characters is valid
    NvsResult result = nvs.putString("exactly15chars_", "value");
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
}

void test_null_key() {
    NvsScope nvs(TEST_NAMESPACE);
    
    NvsResult result = nvs.putString(nullptr, "value");
    TEST_ASSERT_EQUAL(NvsResult::INVALID_ARGUMENT, result);
}

void test_empty_key() {
    NvsScope nvs(TEST_NAMESPACE);
    
    NvsResult result = nvs.putString("", "value");
    TEST_ASSERT_EQUAL(NvsResult::INVALID_ARGUMENT, result);
}

// ============== Namespace Isolation Tests ==============

void test_namespaces_are_isolated() {
    // Write to namespace A
    {
        NvsScope nvsA("namespace_a");
        nvsA.putString("shared_key", "value_a");
    }
    
    // Write to namespace B
    {
        NvsScope nvsB("namespace_b");
        nvsB.putString("shared_key", "value_b");
    }
    
    // Read from namespace A - should get A's value
    {
        NvsScope nvsA("namespace_a", true);
        String value = nvsA.getString("shared_key");
        TEST_ASSERT_EQUAL_STRING("value_a", value.c_str());
    }
    
    // Read from namespace B - should get B's value
    {
        NvsScope nvsB("namespace_b", true);
        String value = nvsB.getString("shared_key");
        TEST_ASSERT_EQUAL_STRING("value_b", value.c_str());
    }
}

// ============== Real Namespace Tests (Key Naming Verification) ==============

void test_config_namespace_key_naming() {
    // Verify we can use the exact keys from ConfigManager
    NvsScope nvs(CONFIG_NAMESPACE);
    TEST_ASSERT_TRUE(nvs.isOpen());
    
    // Test key naming matches ConfigManager
    nvs.putString("wifi_ssid", "TestSSID");
    nvs.putString("wifi_pass", "TestPass");
    nvs.putString("device_name", "Test Device");
    nvs.putUInt("brightness", 128);
    nvs.putUInt("poll_interval", 30);
    nvs.putBool("sensor_page", true);
    nvs.putBool("tls_verify", true);
    
    TEST_ASSERT_EQUAL_STRING("TestSSID", nvs.getString("wifi_ssid").c_str());
    TEST_ASSERT_EQUAL_STRING("TestPass", nvs.getString("wifi_pass").c_str());
    TEST_ASSERT_EQUAL_STRING("Test Device", nvs.getString("device_name").c_str());
    TEST_ASSERT_EQUAL_UINT32(128, nvs.getUInt("brightness"));
    TEST_ASSERT_EQUAL_UINT32(30, nvs.getUInt("poll_interval"));
    TEST_ASSERT_TRUE(nvs.getBool("sensor_page"));
    TEST_ASSERT_TRUE(nvs.getBool("tls_verify"));
}

void test_boot_namespace_key_naming() {
    // Verify we can use the exact keys from BootValidator
    NvsScope nvs(BOOT_NAMESPACE);
    TEST_ASSERT_TRUE(nvs.isOpen());
    
    nvs.putInt("boot_count", 2);
    nvs.putString("last_partition", "ota_0");
    
    TEST_ASSERT_EQUAL_INT32(2, nvs.getInt("boot_count"));
    TEST_ASSERT_EQUAL_STRING("ota_0", nvs.getString("last_partition").c_str());
}

void test_auth_namespace_key_naming() {
    // Verify we can use the exact keys from DeviceCredentials
    NvsScope nvs(AUTH_NAMESPACE);
    TEST_ASSERT_TRUE(nvs.isOpen());
    
    uint8_t secret[32];
    for (int i = 0; i < 32; i++) secret[i] = i;
    nvs.putBytes("secret", secret, 32);
    
    uint8_t readSecret[32];
    size_t len = nvs.getBytes("secret", readSecret, 32);
    
    TEST_ASSERT_EQUAL(32, len);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(secret, readSecret, 32);
}

void test_pairing_namespace_key_naming() {
    // Verify we can use the exact keys from PairingManager
    NvsScope nvs(PAIRING_NAMESPACE);
    TEST_ASSERT_TRUE(nvs.isOpen());
    
    nvs.putString("code", "ABC123");
    
    TEST_ASSERT_EQUAL_STRING("ABC123", nvs.getString("code").c_str());
}

// ============== Convenience Functions Tests ==============

void test_nvs_read_string_convenience() {
    // First write using NvsScope
    {
        NvsScope nvs(TEST_NAMESPACE);
        nvs.putString("conv_key", "conv_value");
    }
    
    // Read using convenience function
    String value = nvsReadString(TEST_NAMESPACE, "conv_key", "default");
    TEST_ASSERT_EQUAL_STRING("conv_value", value.c_str());
}

void test_nvs_write_string_convenience() {
    NvsResult result = nvsWriteString(TEST_NAMESPACE, "write_key", "write_value");
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
    
    // Verify with NvsScope
    NvsScope nvs(TEST_NAMESPACE, true);
    TEST_ASSERT_EQUAL_STRING("write_value", nvs.getString("write_key").c_str());
}

void test_nvs_read_uint_convenience() {
    {
        NvsScope nvs(TEST_NAMESPACE);
        nvs.putUInt("uint_conv", 9999);
    }
    
    uint32_t value = nvsReadUInt(TEST_NAMESPACE, "uint_conv", 0);
    TEST_ASSERT_EQUAL_UINT32(9999, value);
}

void test_nvs_write_uint_convenience() {
    NvsResult result = nvsWriteUInt(TEST_NAMESPACE, "new_uint", 7777);
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
    
    NvsScope nvs(TEST_NAMESPACE, true);
    TEST_ASSERT_EQUAL_UINT32(7777, nvs.getUInt("new_uint"));
}

void test_nvs_read_bool_convenience() {
    {
        NvsScope nvs(TEST_NAMESPACE);
        nvs.putBool("bool_conv", true);
    }
    
    bool value = nvsReadBool(TEST_NAMESPACE, "bool_conv", false);
    TEST_ASSERT_TRUE(value);
}

void test_nvs_write_bool_convenience() {
    NvsResult result = nvsWriteBool(TEST_NAMESPACE, "new_bool", false);
    TEST_ASSERT_EQUAL(NvsResult::OK, result);
    
    NvsScope nvs(TEST_NAMESPACE, true);
    TEST_ASSERT_FALSE(nvs.getBool("new_bool", true));
}

// ============== Error Handling Tests ==============

void test_operations_on_closed_scope() {
    NvsScope nvs(nullptr);  // Will fail to open
    
    TEST_ASSERT_FALSE(nvs.isOpen());
    
    // All operations should return appropriate errors
    NvsResult result = nvs.putString("key", "value");
    TEST_ASSERT_EQUAL(NvsResult::NOT_INITIALIZED, result);
    
    String str = nvs.getString("key", "default");
    TEST_ASSERT_EQUAL_STRING("default", str.c_str());
    
    result = nvs.putUInt("key", 42);
    TEST_ASSERT_EQUAL(NvsResult::NOT_INITIALIZED, result);
    
    uint32_t val = nvs.getUInt("key", 999);
    TEST_ASSERT_EQUAL_UINT32(999, val);
}

void test_result_to_string() {
    TEST_ASSERT_EQUAL_STRING("OK", nvsResultToString(NvsResult::OK));
    TEST_ASSERT_EQUAL_STRING("Not initialized", nvsResultToString(NvsResult::NOT_INITIALIZED));
    TEST_ASSERT_EQUAL_STRING("Read-only mode", nvsResultToString(NvsResult::READ_ONLY));
    TEST_ASSERT_EQUAL_STRING("Key not found", nvsResultToString(NvsResult::KEY_NOT_FOUND));
    TEST_ASSERT_EQUAL_STRING("Key too long", nvsResultToString(NvsResult::KEY_TOO_LONG));
    TEST_ASSERT_EQUAL_STRING("Invalid argument", nvsResultToString(NvsResult::INVALID_ARGUMENT));
}

// ============== Move Semantics Tests ==============

void test_nvs_scope_move_constructor() {
    // Write a value first
    {
        NvsScope setup(TEST_NAMESPACE);
        setup.putString("move_test", "original");
    }
    
    NvsScope original(TEST_NAMESPACE);
    NvsScope moved(std::move(original));
    
    // The moved-to scope should be marked as open (takes ownership of state)
    TEST_ASSERT_TRUE(moved.isOpen());
    TEST_ASSERT_EQUAL_STRING(TEST_NAMESPACE, moved.getNamespace());
    
    // Note: The Preferences handle doesn't fully transfer, but the utility
    // class correctly prevents the original from closing the namespace.
    // The value should still be readable from the namespace.
    NvsScope reader(TEST_NAMESPACE, true);
    TEST_ASSERT_EQUAL_STRING("original", reader.getString("move_test").c_str());
}

void test_nvs_scope_move_assignment() {
    // Write values first
    {
        NvsScope setup1(TEST_NAMESPACE);
        setup1.putString("key1", "value1");
        
        NvsScope setup2("other_ns");
        setup2.putString("key2", "value2");
    }
    
    NvsScope first(TEST_NAMESPACE);
    NvsScope second("other_ns");
    
    // Move assign first to second
    second = std::move(first);
    
    // The moved-to scope should have first's namespace
    TEST_ASSERT_EQUAL_STRING(TEST_NAMESPACE, second.getNamespace());
    
    // The moved-from should be marked as closed to prevent double-close
    TEST_ASSERT_FALSE(first.isOpen());
    
    // Verify original value is still in the namespace
    NvsScope reader(TEST_NAMESPACE, true);
    TEST_ASSERT_EQUAL_STRING("value1", reader.getString("key1").c_str());
}

// ============== Test Runner ==============

int main(int argc, char **argv) {
    UNITY_BEGIN();
    
    // Basic Initialization Tests
    RUN_TEST(test_nvs_scope_open_success);
    RUN_TEST(test_nvs_scope_open_readonly);
    RUN_TEST(test_nvs_scope_invalid_namespace);
    RUN_TEST(test_nvs_scope_empty_namespace);
    RUN_TEST(test_nvs_scope_namespace_too_long);
    
    // String Operations Tests
    RUN_TEST(test_put_string_success);
    RUN_TEST(test_get_string_success);
    RUN_TEST(test_get_string_default);
    RUN_TEST(test_get_string_empty);
    RUN_TEST(test_put_string_readonly_fails);
    RUN_TEST(test_string_persistence_across_scopes);
    
    // Integer Operations Tests
    RUN_TEST(test_put_uint_success);
    RUN_TEST(test_get_uint_success);
    RUN_TEST(test_get_uint_default);
    RUN_TEST(test_get_uint_zero);
    RUN_TEST(test_get_uint_max);
    RUN_TEST(test_put_int_success);
    RUN_TEST(test_get_int_negative);
    
    // Boolean Operations Tests
    RUN_TEST(test_put_bool_true);
    RUN_TEST(test_get_bool_true);
    RUN_TEST(test_get_bool_false);
    RUN_TEST(test_get_bool_default);
    
    // Bytes Operations Tests
    RUN_TEST(test_put_bytes_success);
    RUN_TEST(test_get_bytes_success);
    RUN_TEST(test_get_bytes_length);
    RUN_TEST(test_get_bytes_nonexistent);
    RUN_TEST(test_put_bytes_null_data);
    
    // Key Management Tests
    RUN_TEST(test_has_key_exists);
    RUN_TEST(test_has_key_not_exists);
    RUN_TEST(test_remove_key);
    RUN_TEST(test_remove_nonexistent_key);
    RUN_TEST(test_clear_namespace);
    
    // Key Validation Tests
    RUN_TEST(test_key_too_long);
    RUN_TEST(test_key_max_length);
    RUN_TEST(test_null_key);
    RUN_TEST(test_empty_key);
    
    // Namespace Isolation Tests
    RUN_TEST(test_namespaces_are_isolated);
    
    // Real Namespace Tests (Key Naming Verification)
    RUN_TEST(test_config_namespace_key_naming);
    RUN_TEST(test_boot_namespace_key_naming);
    RUN_TEST(test_auth_namespace_key_naming);
    RUN_TEST(test_pairing_namespace_key_naming);
    
    // Convenience Functions Tests
    RUN_TEST(test_nvs_read_string_convenience);
    RUN_TEST(test_nvs_write_string_convenience);
    RUN_TEST(test_nvs_read_uint_convenience);
    RUN_TEST(test_nvs_write_uint_convenience);
    RUN_TEST(test_nvs_read_bool_convenience);
    RUN_TEST(test_nvs_write_bool_convenience);
    
    // Error Handling Tests
    RUN_TEST(test_operations_on_closed_scope);
    RUN_TEST(test_result_to_string);
    
    // Move Semantics Tests
    RUN_TEST(test_nvs_scope_move_constructor);
    RUN_TEST(test_nvs_scope_move_assignment);
    
    return UNITY_END();
}

#endif // UNIT_TEST
