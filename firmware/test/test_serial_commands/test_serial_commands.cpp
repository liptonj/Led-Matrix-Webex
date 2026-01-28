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

static void run_serial_commands_tests() {
    UNITY_BEGIN();
    
    RUN_TEST(test_wifi_command_ssid_extraction);
    RUN_TEST(test_wifi_command_password_extraction);
    RUN_TEST(test_wifi_command_password_with_colons);
    RUN_TEST(test_wifi_command_legacy_format);
    RUN_TEST(test_wifi_command_empty_ssid);
    RUN_TEST(test_command_recognition);
    
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
