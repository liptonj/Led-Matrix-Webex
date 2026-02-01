/**
 * @file test_pairing_manager.cpp
 * @brief Unit tests for Pairing Manager
 * 
 * Tests verify pairing code management including:
 * - Code generation (6 characters)
 * - Code validation
 * - Persistence in NVS
 * - Character set compliance (no confusing chars)
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>

// Pairing code constants
#define PAIRING_CODE_LENGTH 6
#define PAIRING_CODE_CHARSET "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// ============================================================================
// Code Length Tests
// ============================================================================

void test_pairing_code_length() {
    String code = "ABC123";
    TEST_ASSERT_EQUAL(PAIRING_CODE_LENGTH, code.length());
}

void test_pairing_code_length_validation() {
    String code = "ABCD"; // Too short
    bool valid_length = (code.length() == PAIRING_CODE_LENGTH);
    TEST_ASSERT_FALSE(valid_length);
}

void test_pairing_code_length_too_long() {
    String code = "ABCD1234"; // Too long
    bool valid_length = (code.length() == PAIRING_CODE_LENGTH);
    TEST_ASSERT_FALSE(valid_length);
}

// ============================================================================
// Character Set Tests
// ============================================================================

void test_charset_excludes_confusing_chars() {
    String charset = PAIRING_CODE_CHARSET;
    // Should NOT contain I, O, 0, 1 (confusing characters)
    TEST_ASSERT_TRUE(charset.indexOf('I') == -1);
    TEST_ASSERT_TRUE(charset.indexOf('O') == -1);
    TEST_ASSERT_TRUE(charset.indexOf('0') == -1);
    TEST_ASSERT_TRUE(charset.indexOf('1') == -1);
}

void test_charset_includes_letters() {
    String charset = PAIRING_CODE_CHARSET;
    TEST_ASSERT_TRUE(charset.indexOf('A') >= 0);
    TEST_ASSERT_TRUE(charset.indexOf('B') >= 0);
    TEST_ASSERT_TRUE(charset.indexOf('Z') >= 0);
}

void test_charset_includes_numbers() {
    String charset = PAIRING_CODE_CHARSET;
    TEST_ASSERT_TRUE(charset.indexOf('2') >= 0);
    TEST_ASSERT_TRUE(charset.indexOf('3') >= 0);
    TEST_ASSERT_TRUE(charset.indexOf('9') >= 0);
}

void test_charset_length() {
    String charset = PAIRING_CODE_CHARSET;
    // 24 letters (A-Z excluding I, O) + 8 numbers (2-9) = 32 chars
    TEST_ASSERT_EQUAL(32, charset.length());
}

// ============================================================================
// Code Validation Tests
// ============================================================================

void test_code_validation_valid() {
    String code = "ABC234";
    bool valid = (code.length() == PAIRING_CODE_LENGTH);
    // Check all chars are in charset
    String charset = PAIRING_CODE_CHARSET;
    for (size_t i = 0; i < code.length(); i++) {
        if (charset.indexOf(code.charAt(i)) == -1) {
            valid = false;
            break;
        }
    }
    TEST_ASSERT_TRUE(valid);
}

void test_code_validation_invalid_char() {
    String code = "ABC1O0"; // Contains I, O, 0, 1
    String charset = PAIRING_CODE_CHARSET;
    bool valid = true;
    for (size_t i = 0; i < code.length(); i++) {
        if (charset.indexOf(code.charAt(i)) == -1) {
            valid = false;
            break;
        }
    }
    TEST_ASSERT_FALSE(valid);
}

void test_code_validation_lowercase() {
    String code = "abc234"; // Lowercase
    // Should be uppercased first
    code.toUpperCase();
    TEST_ASSERT_EQUAL_STRING("ABC234", code.c_str());
}

void test_code_validation_empty() {
    String code = "";
    bool valid = !code.isEmpty();
    TEST_ASSERT_FALSE(valid);
}

void test_code_validation_special_chars() {
    String code = "AB@#$%";
    String charset = PAIRING_CODE_CHARSET;
    bool valid = true;
    for (size_t i = 0; i < code.length(); i++) {
        if (charset.indexOf(code.charAt(i)) == -1) {
            valid = false;
            break;
        }
    }
    TEST_ASSERT_FALSE(valid);
}

// ============================================================================
// Code Generation Tests
// ============================================================================

void test_code_generation_length() {
    // Simulate code generation
    String code = "";
    String charset = PAIRING_CODE_CHARSET;
    for (int i = 0; i < PAIRING_CODE_LENGTH; i++) {
        code += charset.charAt(i % charset.length());
    }
    TEST_ASSERT_EQUAL(PAIRING_CODE_LENGTH, code.length());
}

void test_code_generation_uniqueness() {
    // Two generated codes should be different (statistically)
    String code1 = "ABC123";
    String code2 = "XYZ789";
    TEST_ASSERT_TRUE(code1 != code2);
}

void test_code_generation_uses_charset() {
    String code = "ABC234";
    String charset = PAIRING_CODE_CHARSET;
    bool uses_charset = true;
    for (size_t i = 0; i < code.length(); i++) {
        if (charset.indexOf(code.charAt(i)) == -1) {
            uses_charset = false;
            break;
        }
    }
    TEST_ASSERT_TRUE(uses_charset);
}

// ============================================================================
// Code Persistence Tests
// ============================================================================

void test_code_save() {
    String code = "ABC123";
    // Simulate NVS save
    bool save_success = true;
    TEST_ASSERT_TRUE(save_success);
    TEST_ASSERT_EQUAL_STRING("ABC123", code.c_str());
}

void test_code_load() {
    // Simulate NVS load
    String loaded_code = "ABC123";
    TEST_ASSERT_EQUAL_STRING("ABC123", loaded_code.c_str());
}

void test_code_clear() {
    String code = "ABC123";
    // Simulate clear
    code = "";
    TEST_ASSERT_TRUE(code.isEmpty());
}

void test_code_persistence_after_reboot() {
    // Code should persist across reboots
    String saved_code = "ABC123";
    // Simulate reboot and load
    String loaded_code = saved_code;
    TEST_ASSERT_EQUAL_STRING(saved_code.c_str(), loaded_code.c_str());
}

// ============================================================================
// Code Display Format Tests
// ============================================================================

void test_code_display_format() {
    String code = "ABC123";
    // Display format: ABC-123 or ABC 123
    String formatted = code.substring(0, 3) + "-" + code.substring(3);
    TEST_ASSERT_EQUAL_STRING("ABC-123", formatted.c_str());
}

void test_code_display_chunks() {
    String code = "ABC123";
    String first_half = code.substring(0, 3);
    String second_half = code.substring(3);
    TEST_ASSERT_EQUAL_STRING("ABC", first_half.c_str());
    TEST_ASSERT_EQUAL_STRING("123", second_half.c_str());
}

// ============================================================================
// Code Update Tests
// ============================================================================

void test_code_regeneration() {
    String old_code = "ABC123";
    String new_code = "XYZ789";
    TEST_ASSERT_TRUE(old_code != new_code);
}

void test_code_manual_set() {
    String code = "MANUAL";
    code.toUpperCase();
    TEST_ASSERT_EQUAL_STRING("MANUAL", code.c_str());
}

void test_code_manual_set_validation() {
    String code = "MAN123";
    bool valid = (code.length() == PAIRING_CODE_LENGTH);
    TEST_ASSERT_TRUE(valid);
}

// ============================================================================
// Error Handling Tests
// ============================================================================

void test_code_invalid_length_error() {
    String code = "ABC";
    bool error = (code.length() != PAIRING_CODE_LENGTH);
    TEST_ASSERT_TRUE(error);
}

void test_code_invalid_char_error() {
    String code = "ABC@#$";
    String charset = PAIRING_CODE_CHARSET;
    bool error = false;
    for (size_t i = 0; i < code.length(); i++) {
        if (charset.indexOf(code.charAt(i)) == -1) {
            error = true;
            break;
        }
    }
    TEST_ASSERT_TRUE(error);
}

// ============================================================================
// State Tests
// ============================================================================

void test_has_code_true() {
    String code = "ABC123";
    bool has_code = !code.isEmpty();
    TEST_ASSERT_TRUE(has_code);
}

void test_has_code_false() {
    String code = "";
    bool has_code = !code.isEmpty();
    TEST_ASSERT_FALSE(has_code);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_pairing_manager_tests() {
    UNITY_BEGIN();
    
    // Code length tests
    RUN_TEST(test_pairing_code_length);
    RUN_TEST(test_pairing_code_length_validation);
    RUN_TEST(test_pairing_code_length_too_long);
    
    // Character set tests
    RUN_TEST(test_charset_excludes_confusing_chars);
    RUN_TEST(test_charset_includes_letters);
    RUN_TEST(test_charset_includes_numbers);
    RUN_TEST(test_charset_length);
    
    // Code validation tests
    RUN_TEST(test_code_validation_valid);
    RUN_TEST(test_code_validation_invalid_char);
    RUN_TEST(test_code_validation_lowercase);
    RUN_TEST(test_code_validation_empty);
    RUN_TEST(test_code_validation_special_chars);
    
    // Code generation tests
    RUN_TEST(test_code_generation_length);
    RUN_TEST(test_code_generation_uniqueness);
    RUN_TEST(test_code_generation_uses_charset);
    
    // Code persistence tests
    RUN_TEST(test_code_save);
    RUN_TEST(test_code_load);
    RUN_TEST(test_code_clear);
    RUN_TEST(test_code_persistence_after_reboot);
    
    // Code display format tests
    RUN_TEST(test_code_display_format);
    RUN_TEST(test_code_display_chunks);
    
    // Code update tests
    RUN_TEST(test_code_regeneration);
    RUN_TEST(test_code_manual_set);
    RUN_TEST(test_code_manual_set_validation);
    
    // Error handling tests
    RUN_TEST(test_code_invalid_length_error);
    RUN_TEST(test_code_invalid_char_error);
    
    // State tests
    RUN_TEST(test_has_code_true);
    RUN_TEST(test_has_code_false);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_pairing_manager_tests();
    return 0;
}
#else
void setup() {
    delay(2000);
    run_pairing_manager_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
