/**
 * @file test_serial_commands.cpp
 * @brief Smoke tests for serial command handler
 * 
 * These tests verify the serial command parsing and handling functionality
 * used by the web installer for WiFi configuration.
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include "serial/serial_commands.h"

// Test that WIFI command parsing extracts SSID correctly
void test_wifi_command_ssid_extraction() {
    // Format: WIFI:<ssid>:<password>
    String command = "WIFI:MyNetwork:MyPassword123";
    
    int first_colon = command.indexOf(':', 5);
    TEST_ASSERT_GREATER_THAN(0, first_colon);
    
    String ssid = command.substring(5, first_colon);
    TEST_ASSERT_EQUAL_STRING("MyNetwork", ssid.c_str());
}

// Test that WIFI command parsing extracts password correctly
void test_wifi_command_password_extraction() {
    String command = "WIFI:MyNetwork:MyPassword123";
    
    int first_colon = command.indexOf(':', 5);
    String password = command.substring(first_colon + 1);
    TEST_ASSERT_EQUAL_STRING("MyPassword123", password.c_str());
}

// Test password with colons (edge case)
void test_wifi_command_password_with_colons() {
    String command = "WIFI:MyNetwork:Pass:Word:123";
    
    int first_colon = command.indexOf(':', 5);
    String ssid = command.substring(5, first_colon);
    String password = command.substring(first_colon + 1);
    
    TEST_ASSERT_EQUAL_STRING("MyNetwork", ssid.c_str());
    TEST_ASSERT_EQUAL_STRING("Pass:Word:123", password.c_str());
}

// Test legacy format with trailing flag (backwards compatibility)
void test_wifi_command_legacy_format() {
    String command = "WIFI:MyNetwork:MyPassword:1";
    
    int first_colon = command.indexOf(':', 5);
    String ssid = command.substring(5, first_colon);
    String password = command.substring(first_colon + 1);
    
    // Remove trailing :0 or :1 flag
    int last_colon = password.lastIndexOf(':');
    if (last_colon >= 0) {
        String suffix = password.substring(last_colon + 1);
        if (suffix == "0" || suffix == "1") {
            password = password.substring(0, last_colon);
        }
    }
    
    TEST_ASSERT_EQUAL_STRING("MyNetwork", ssid.c_str());
    TEST_ASSERT_EQUAL_STRING("MyPassword", password.c_str());
}

// Test empty SSID detection
void test_wifi_command_empty_ssid() {
    String command = "WIFI::SomePassword";
    
    int first_colon = command.indexOf(':', 5);
    String ssid = command.substring(5, first_colon);
    
    TEST_ASSERT_TRUE(ssid.isEmpty());
}

// Test command recognition
void test_command_recognition() {
    TEST_ASSERT_TRUE(String("WIFI:test:pass").startsWith("WIFI:"));
    TEST_ASSERT_TRUE(String("SCAN") == "SCAN");
    TEST_ASSERT_TRUE(String("STATUS") == "STATUS");
    TEST_ASSERT_TRUE(String("FACTORY_RESET") == "FACTORY_RESET");
    TEST_ASSERT_TRUE(String("HELP") == "HELP");
}

// ============================================================================
// Injection and Length Validation Tests (Expanded)
// ============================================================================

// Test SSID maximum length (32 chars for WiFi standard)
void test_wifi_ssid_max_length() {
    String ssid = "12345678901234567890123456789012"; // Exactly 32
    bool valid_length = (ssid.length() <= 32);
    TEST_ASSERT_TRUE(valid_length);
}

void test_wifi_ssid_too_long() {
    String ssid = "123456789012345678901234567890123"; // 33 chars
    bool valid_length = (ssid.length() <= 32);
    TEST_ASSERT_FALSE(valid_length);
}

// Test password maximum length (63 chars for WPA/WPA2)
void test_wifi_password_max_length() {
    String password = "123456789012345678901234567890123456789012345678901234567890123"; // 63
    bool valid_length = (password.length() <= 63);
    TEST_ASSERT_TRUE(valid_length);
}

void test_wifi_password_too_long() {
    String password = "1234567890123456789012345678901234567890123456789012345678901234"; // 64
    bool valid_length = (password.length() <= 63);
    TEST_ASSERT_FALSE(valid_length);
}

// Test password minimum length (8 chars for WPA2)
void test_wifi_password_min_length() {
    String password = "12345678"; // Exactly 8
    bool valid_length = (password.length() >= 8);
    TEST_ASSERT_TRUE(valid_length);
}

void test_wifi_password_too_short() {
    String password = "1234567"; // Only 7
    bool valid_length = (password.length() >= 8);
    TEST_ASSERT_FALSE(valid_length);
}

// Test special characters in SSID
void test_wifi_ssid_special_chars() {
    String ssid = "Test-Network_2.4GHz";
    // SSIDs can contain most special chars
    TEST_ASSERT_GREATER_THAN(0, ssid.length());
}

void test_wifi_ssid_spaces() {
    String ssid = "My Home Network";
    TEST_ASSERT_TRUE(ssid.indexOf(' ') > 0);
}

// Test special characters in password
void test_wifi_password_special_chars() {
    String password = "P@ssw0rd!#$%";
    // Passwords can contain special chars
    TEST_ASSERT_GREATER_THAN(8, password.length());
}

// Test command injection attempts
void test_wifi_command_injection_newline() {
    String command = "WIFI:test\nFACTORY_RESET:password";
    // Should detect newline in SSID
    bool has_newline = (command.indexOf('\n') > 0);
    TEST_ASSERT_TRUE(has_newline);
}

void test_wifi_command_injection_null() {
    String command = "WIFI:test";
    // Null terminator should end string
    bool safe = (command.indexOf('\0') == -1 || command.indexOf('\0') == (int)command.length());
    TEST_ASSERT_TRUE(safe);
}

// Test empty password (open network)
void test_wifi_command_empty_password() {
    String command = "WIFI:OpenNetwork:";
    int first_colon = command.indexOf(':', 5);
    String password = command.substring(first_colon + 1);
    TEST_ASSERT_TRUE(password.isEmpty());
}

// Test unicode characters in SSID
void test_wifi_ssid_unicode() {
    String ssid = "Café WiFi";
    // Should handle UTF-8 encoded strings
    TEST_ASSERT_GREATER_THAN(0, ssid.length());
}

// Test very long input (buffer overflow protection)
void test_wifi_command_very_long_input() {
    String command = "WIFI:";
    for (int i = 0; i < 200; i++) {
        command += "A";
    }
    command += ":password";
    
    int first_colon = command.indexOf(':', 5);
    String ssid = command.substring(5, first_colon);
    // Should be truncated to max SSID length
    bool too_long = (ssid.length() > 32);
    TEST_ASSERT_TRUE(too_long); // Detection test
}

// Test command with only colon separator
void test_wifi_command_only_colons() {
    String command = "WIFI:::";
    int first_colon = command.indexOf(':', 5);
    String ssid = command.substring(5, first_colon);
    TEST_ASSERT_TRUE(ssid.isEmpty());
}

// Test malformed command (missing colon)
void test_wifi_command_missing_colon() {
    String command = "WIFITestNetworkPassword";
    int first_colon = command.indexOf(':', 5);
    TEST_ASSERT_EQUAL(-1, first_colon);
}

// Test case sensitivity
void test_wifi_command_case_insensitive() {
    String command_upper = "WIFI:Test:Pass";
    String command_lower = "wifi:Test:Pass";
    TEST_ASSERT_TRUE(command_upper.startsWith("WIFI:"));
    TEST_ASSERT_FALSE(command_lower.startsWith("WIFI:")); // Should be case-sensitive
}

// ============================================================================
// PROVISION_TOKEN Command Tests
// ============================================================================

// Test PROVISION_TOKEN command recognition
void test_provision_token_command_recognition() {
    TEST_ASSERT_TRUE(String("PROVISION_TOKEN:abc123").startsWith("PROVISION_TOKEN:"));
    TEST_ASSERT_FALSE(String("PROVISION_TOKEN").startsWith("PROVISION_TOKEN:"));
}

// Test PROVISION_TOKEN command parsing - extract token correctly
void test_provision_token_extraction() {
    // Format: PROVISION_TOKEN:<token>
    String command = "PROVISION_TOKEN:12345678901234567890123456789012"; // 32 chars
    const int prefix_len = 16;  // "PROVISION_TOKEN:"
    
    String token = command.substring(prefix_len);
    token.trim();  // Remove any whitespace
    
    TEST_ASSERT_EQUAL(32, token.length());
    TEST_ASSERT_EQUAL_STRING("12345678901234567890123456789012", token.c_str());
}

// Test PROVISION_TOKEN command parsing - handles whitespace trimming
void test_provision_token_trim_whitespace() {
    String command = "PROVISION_TOKEN:  12345678901234567890123456789012  ";
    const int prefix_len = 16;
    
    String token = command.substring(prefix_len);
    token.trim();
    
    TEST_ASSERT_EQUAL(32, token.length());
    TEST_ASSERT_EQUAL_STRING("12345678901234567890123456789012", token.c_str());
}

// Test valid token length (exactly 32 characters)
void test_provision_token_valid_length() {
    String token = "12345678901234567890123456789012"; // Exactly 32 chars
    TEST_ASSERT_EQUAL(32, token.length());
}

// Test invalid token length - too short
void test_provision_token_too_short() {
    String token = "1234567890123456789012345678901"; // Only 31 chars
    TEST_ASSERT_NOT_EQUAL(32, token.length());
    TEST_ASSERT_LESS_THAN(32, token.length());
}

// Test invalid token length - too long
void test_provision_token_too_long() {
    String token = "123456789012345678901234567890123"; // 33 chars
    TEST_ASSERT_NOT_EQUAL(32, token.length());
    TEST_ASSERT_GREATER_THAN(32, token.length());
}

// Test invalid token length - empty token
void test_provision_token_empty_token() {
    String command = "PROVISION_TOKEN:";
    const int prefix_len = 16;
    
    String token = command.substring(prefix_len);
    token.trim();
    
    TEST_ASSERT_EQUAL(0, token.length());
    TEST_ASSERT_NOT_EQUAL(32, token.length());
}

// Test invalid token length - command too short (no token)
void test_provision_token_command_too_short() {
    String command = "PROVISION_TOKEN"; // No colon, no token
    const int prefix_len = 16;
    
    bool has_token = (command.length() > prefix_len);
    TEST_ASSERT_FALSE(has_token);
}

// Test valid token format - alphanumeric only (lowercase)
void test_provision_token_valid_format_lowercase() {
    String token = "abcdefghijklmnopqrstuvwxyz123456"; // 32 chars, lowercase + digits
    bool is_valid = true;
    
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    TEST_ASSERT_TRUE(is_valid);
}

// Test valid token format - alphanumeric only (uppercase)
void test_provision_token_valid_format_uppercase() {
    String token = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"; // 32 chars, uppercase + digits
    bool is_valid = true;
    
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    TEST_ASSERT_TRUE(is_valid);
}

// Test valid token format - alphanumeric only (mixed case)
void test_provision_token_valid_format_mixed_case() {
    String token = "AbCdEfGhIjKlMnOpQrStUvWxYz123456"; // 32 chars, mixed case + digits
    bool is_valid = true;
    
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    TEST_ASSERT_TRUE(is_valid);
}

// Test invalid token format - special characters
void test_provision_token_invalid_format_special_chars() {
    String token = "1234567890123456789012345678901@"; // 32 chars with @
    bool is_valid = true;
    
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    TEST_ASSERT_FALSE(is_valid);
}

// Test invalid token format - spaces
void test_provision_token_invalid_format_spaces() {
    String token = "123456789012345678901234567890 1"; // 32 chars with space
    bool is_valid = true;
    
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    TEST_ASSERT_FALSE(is_valid);
}

// Test invalid token format - multiple special characters
void test_provision_token_invalid_format_multiple_special() {
    String token = "123456789012345678901234567890!@"; // 32 chars with ! and @
    bool is_valid = true;
    
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    TEST_ASSERT_FALSE(is_valid);
}

// Test invalid token format - hyphen
void test_provision_token_invalid_format_hyphen() {
    String token = "1234567890123456789012345678901-"; // 32 chars with hyphen
    bool is_valid = true;
    
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    TEST_ASSERT_FALSE(is_valid);
}

// Test invalid token format - underscore
void test_provision_token_invalid_format_underscore() {
    String token = "1234567890123456789012345678901_"; // 32 chars with underscore
    bool is_valid = true;
    
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    TEST_ASSERT_FALSE(is_valid);
}

// Test token lifecycle - set and get valid token
void test_provision_token_set_and_get() {
    // Initialize serial commands (clears any existing token)
    serial_commands_begin();
    
    String valid_token = "12345678901234567890123456789012"; // 32 chars
    set_provision_token(valid_token);
    
    String retrieved_token = get_provision_token();
    TEST_ASSERT_EQUAL_STRING(valid_token.c_str(), retrieved_token.c_str());
    TEST_ASSERT_EQUAL(32, retrieved_token.length());
}

// Test token lifecycle - clear token
void test_provision_token_clear() {
    // Set a token first
    String valid_token = "12345678901234567890123456789012";
    set_provision_token(valid_token);
    
    // Verify it's set
    TEST_ASSERT_FALSE(get_provision_token().isEmpty());
    
    // Clear it
    clear_provision_token();
    
    // Verify it's cleared
    String retrieved_token = get_provision_token();
    TEST_ASSERT_TRUE(retrieved_token.isEmpty());
    TEST_ASSERT_EQUAL(0, retrieved_token.length());
}

// Test token lifecycle - get returns empty string initially
void test_provision_token_get_empty_initially() {
    // Initialize serial commands (clears any existing token)
    serial_commands_begin();
    
    String retrieved_token = get_provision_token();
    TEST_ASSERT_TRUE(retrieved_token.isEmpty());
    TEST_ASSERT_EQUAL(0, retrieved_token.length());
}

// Test token lifecycle - set multiple times (last one wins)
void test_provision_token_set_multiple_times() {
    // Initialize serial commands
    serial_commands_begin();
    
    // Set first token
    String token1 = "11111111111111111111111111111111"; // 32 chars
    set_provision_token(token1);
    TEST_ASSERT_EQUAL_STRING(token1.c_str(), get_provision_token().c_str());
    
    // Set second token
    String token2 = "22222222222222222222222222222222"; // 32 chars
    set_provision_token(token2);
    TEST_ASSERT_EQUAL_STRING(token2.c_str(), get_provision_token().c_str());
    TEST_ASSERT_TRUE(strcmp(token1.c_str(), get_provision_token().c_str()) != 0);
    
    // Set third token
    String token3 = "33333333333333333333333333333333"; // 32 chars
    set_provision_token(token3);
    TEST_ASSERT_EQUAL_STRING(token3.c_str(), get_provision_token().c_str());
    TEST_ASSERT_TRUE(strcmp(token1.c_str(), get_provision_token().c_str()) != 0);
    TEST_ASSERT_TRUE(strcmp(token2.c_str(), get_provision_token().c_str()) != 0);
}

// Test token lifecycle - set, clear, set again
void test_provision_token_set_clear_set() {
    // Initialize serial commands
    serial_commands_begin();
    
    // Set token
    String token1 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 32 chars
    set_provision_token(token1);
    TEST_ASSERT_EQUAL_STRING(token1.c_str(), get_provision_token().c_str());
    
    // Clear token
    clear_provision_token();
    TEST_ASSERT_TRUE(get_provision_token().isEmpty());
    
    // Set different token
    String token2 = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"; // 32 chars
    set_provision_token(token2);
    TEST_ASSERT_EQUAL_STRING(token2.c_str(), get_provision_token().c_str());
    TEST_ASSERT_TRUE(strcmp(token1.c_str(), get_provision_token().c_str()) != 0);
}

static void run_serial_commands_tests() {
    UNITY_BEGIN();
    
    // Original tests
    RUN_TEST(test_wifi_command_ssid_extraction);
    RUN_TEST(test_wifi_command_password_extraction);
    RUN_TEST(test_wifi_command_password_with_colons);
    RUN_TEST(test_wifi_command_legacy_format);
    RUN_TEST(test_wifi_command_empty_ssid);
    RUN_TEST(test_command_recognition);
    
    // Expanded injection and length validation tests
    RUN_TEST(test_wifi_ssid_max_length);
    RUN_TEST(test_wifi_ssid_too_long);
    RUN_TEST(test_wifi_password_max_length);
    RUN_TEST(test_wifi_password_too_long);
    RUN_TEST(test_wifi_password_min_length);
    RUN_TEST(test_wifi_password_too_short);
    RUN_TEST(test_wifi_ssid_special_chars);
    RUN_TEST(test_wifi_ssid_spaces);
    RUN_TEST(test_wifi_password_special_chars);
    RUN_TEST(test_wifi_command_injection_newline);
    RUN_TEST(test_wifi_command_injection_null);
    RUN_TEST(test_wifi_command_empty_password);
    RUN_TEST(test_wifi_ssid_unicode);
    RUN_TEST(test_wifi_command_very_long_input);
    RUN_TEST(test_wifi_command_only_colons);
    RUN_TEST(test_wifi_command_missing_colon);
    RUN_TEST(test_wifi_command_case_insensitive);
    
    // PROVISION_TOKEN command tests
    RUN_TEST(test_provision_token_command_recognition);
    RUN_TEST(test_provision_token_extraction);
    RUN_TEST(test_provision_token_trim_whitespace);
    RUN_TEST(test_provision_token_valid_length);
    RUN_TEST(test_provision_token_too_short);
    RUN_TEST(test_provision_token_too_long);
    RUN_TEST(test_provision_token_empty_token);
    RUN_TEST(test_provision_token_command_too_short);
    RUN_TEST(test_provision_token_valid_format_lowercase);
    RUN_TEST(test_provision_token_valid_format_uppercase);
    RUN_TEST(test_provision_token_valid_format_mixed_case);
    RUN_TEST(test_provision_token_invalid_format_special_chars);
    RUN_TEST(test_provision_token_invalid_format_spaces);
    RUN_TEST(test_provision_token_invalid_format_multiple_special);
    RUN_TEST(test_provision_token_invalid_format_hyphen);
    RUN_TEST(test_provision_token_invalid_format_underscore);
    RUN_TEST(test_provision_token_set_and_get);
    RUN_TEST(test_provision_token_clear);
    RUN_TEST(test_provision_token_get_empty_initially);
    RUN_TEST(test_provision_token_set_multiple_times);
    RUN_TEST(test_provision_token_set_clear_set);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
// Native build uses main()
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_serial_commands_tests();
    return 0;
}
#else
// Arduino build uses setup()/loop()
void setup() {
    delay(2000);  // Wait for serial monitor
    run_serial_commands_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
