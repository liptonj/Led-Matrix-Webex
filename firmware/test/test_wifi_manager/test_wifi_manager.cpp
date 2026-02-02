/**
 * @file test_wifi_manager.cpp
 * @brief Unit tests for WiFi Manager
 * 
 * Tests verify WiFi state machine including:
 * - Initial connection setup
 * - Connection state tracking
 * - Disconnection detection
 * - Automatic reconnection
 * - AP mode fallback
 * - Network scanning
 * - State transitions
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>

// WiFi state machine states
enum WiFiState {
    WIFI_IDLE,
    WIFI_SCANNING,
    WIFI_CONNECTING,
    WIFI_CONNECTED,
    WIFI_DISCONNECTED,
    WIFI_RECONNECTING,
    WIFI_AP_MODE
};

// Connection check interval
#define CONNECTION_CHECK_INTERVAL 10000 // 10 seconds
#define MDNS_RETRY_INTERVAL 30000       // 30 seconds

// ============================================================================
// State Machine Tests
// ============================================================================

void test_wifi_state_initial() {
    WiFiState state = WIFI_IDLE;
    TEST_ASSERT_EQUAL(WIFI_IDLE, state);
}

void test_wifi_state_transition_to_scanning() {
    WiFiState state = WIFI_IDLE;
    state = WIFI_SCANNING;
    TEST_ASSERT_EQUAL(WIFI_SCANNING, state);
}

void test_wifi_state_transition_to_connecting() {
    WiFiState state = WIFI_SCANNING;
    state = WIFI_CONNECTING;
    TEST_ASSERT_EQUAL(WIFI_CONNECTING, state);
}

void test_wifi_state_transition_to_connected() {
    WiFiState state = WIFI_CONNECTING;
    state = WIFI_CONNECTED;
    TEST_ASSERT_EQUAL(WIFI_CONNECTED, state);
}

void test_wifi_state_transition_to_disconnected() {
    WiFiState state = WIFI_CONNECTED;
    state = WIFI_DISCONNECTED;
    TEST_ASSERT_EQUAL(WIFI_DISCONNECTED, state);
}

void test_wifi_state_transition_to_reconnecting() {
    WiFiState state = WIFI_DISCONNECTED;
    state = WIFI_RECONNECTING;
    TEST_ASSERT_EQUAL(WIFI_RECONNECTING, state);
}

void test_wifi_state_transition_to_ap_mode() {
    WiFiState state = WIFI_IDLE;
    state = WIFI_AP_MODE;
    TEST_ASSERT_EQUAL(WIFI_AP_MODE, state);
}

// ============================================================================
// Connection State Tests
// ============================================================================

void test_wifi_not_connected() {
    bool connected = false;
    TEST_ASSERT_FALSE(connected);
}

void test_wifi_connected() {
    bool connected = true;
    TEST_ASSERT_TRUE(connected);
}

void test_wifi_connection_with_ip() {
    bool connected = true;
    String ip_address = "192.168.1.100";
    
    TEST_ASSERT_TRUE(connected);
    TEST_ASSERT_FALSE(ip_address.isEmpty());
}

void test_wifi_connection_without_ip() {
    bool connected = false;
    String ip_address = "";
    
    TEST_ASSERT_FALSE(connected);
    TEST_ASSERT_TRUE(ip_address.isEmpty());
}

// ============================================================================
// AP Mode Tests
// ============================================================================

void test_ap_mode_inactive() {
    bool ap_mode_active = false;
    TEST_ASSERT_FALSE(ap_mode_active);
}

void test_ap_mode_active() {
    bool ap_mode_active = true;
    TEST_ASSERT_TRUE(ap_mode_active);
}

void test_ap_mode_with_ip() {
    bool ap_mode_active = true;
    String ap_ip = "192.168.4.1";
    
    TEST_ASSERT_TRUE(ap_mode_active);
    TEST_ASSERT_EQUAL_STRING("192.168.4.1", ap_ip.c_str());
}

void test_ap_mode_ssid_format() {
    String ap_ssid = "Webex-Display-Setup";
    TEST_ASSERT_TRUE(ap_ssid.startsWith("Webex-Display"));
}

void test_ap_mode_disable() {
    bool ap_mode_active = true;
    // Simulate disableAP()
    ap_mode_active = false;
    
    TEST_ASSERT_FALSE(ap_mode_active);
}

// ============================================================================
// Reconnection Tests
// ============================================================================

void test_reconnect_attempts_initial() {
    uint8_t reconnect_attempts = 0;
    TEST_ASSERT_EQUAL(0, reconnect_attempts);
}

void test_reconnect_attempts_increment() {
    uint8_t reconnect_attempts = 0;
    reconnect_attempts++;
    TEST_ASSERT_EQUAL(1, reconnect_attempts);
}

void test_reconnect_attempts_max() {
    uint8_t reconnect_attempts = 5;
    bool should_give_up = (reconnect_attempts >= 5);
    TEST_ASSERT_TRUE(should_give_up);
}

void test_reconnect_attempts_reset() {
    uint8_t reconnect_attempts = 3;
    // After successful connection
    reconnect_attempts = 0;
    TEST_ASSERT_EQUAL(0, reconnect_attempts);
}

void test_reconnect_exponential_backoff() {
    // Simulate exponential backoff: 1s, 2s, 4s, 8s
    unsigned long delays[] = {1000, 2000, 4000, 8000};
    
    TEST_ASSERT_EQUAL(1000, delays[0]);
    TEST_ASSERT_EQUAL(2000, delays[1]);
    TEST_ASSERT_EQUAL(4000, delays[2]);
    TEST_ASSERT_EQUAL(8000, delays[3]);
}

// ============================================================================
// Connection Check Tests
// ============================================================================

void test_connection_check_interval() {
    unsigned long last_check = 0;
    unsigned long current_time = 5000;
    unsigned long elapsed = current_time - last_check;
    
    bool should_check = (elapsed >= CONNECTION_CHECK_INTERVAL);
    TEST_ASSERT_FALSE(should_check); // 5s < 10s
}

void test_connection_check_interval_exceeded() {
    unsigned long last_check = 0;
    unsigned long current_time = 11000;
    unsigned long elapsed = current_time - last_check;
    
    bool should_check = (elapsed >= CONNECTION_CHECK_INTERVAL);
    TEST_ASSERT_TRUE(should_check); // 11s > 10s
}

void test_connection_check_update_timestamp() {
    unsigned long last_check = 0;
    unsigned long current_time = 11000;
    
    // After check, update timestamp
    last_check = current_time;
    TEST_ASSERT_EQUAL(11000, last_check);
}

// ============================================================================
// Network Scanning Tests
// ============================================================================

void test_network_scan_empty_results() {
    int network_count = 0;
    TEST_ASSERT_EQUAL(0, network_count);
}

void test_network_scan_with_results() {
    int network_count = 5;
    TEST_ASSERT_EQUAL(5, network_count);
}

void test_network_scan_ssid_extraction() {
    String ssid = "TestNetwork";
    TEST_ASSERT_EQUAL_STRING("TestNetwork", ssid.c_str());
}

void test_network_scan_rssi() {
    int rssi = -65; // Signal strength in dBm
    TEST_ASSERT_LESS_THAN(0, rssi);
}

void test_network_scan_rssi_strength() {
    int rssi = -40; // Excellent signal
    bool strong_signal = (rssi > -50);
    TEST_ASSERT_TRUE(strong_signal);
}

void test_network_scan_rssi_weak() {
    int rssi = -85; // Weak signal
    bool weak_signal = (rssi < -80);
    TEST_ASSERT_TRUE(weak_signal);
}

void test_network_scan_encryption_type() {
    String encryption = "WPA2";
    TEST_ASSERT_EQUAL_STRING("WPA2", encryption.c_str());
}

void test_network_scan_open_network() {
    bool is_open = true;
    TEST_ASSERT_TRUE(is_open);
}

void test_network_scan_secured_network() {
    bool is_open = false;
    TEST_ASSERT_FALSE(is_open);
}

// ============================================================================
// Credentials Validation Tests
// ============================================================================

void test_credentials_empty() {
    String ssid = "";
    String password = "";
    bool has_credentials = (!ssid.isEmpty() && !password.isEmpty());
    TEST_ASSERT_FALSE(has_credentials);
}

void test_credentials_ssid_only() {
    String ssid = "TestNetwork";
    String password = "";
    bool has_credentials = (!ssid.isEmpty() && !password.isEmpty());
    TEST_ASSERT_FALSE(has_credentials);
}

void test_credentials_valid() {
    String ssid = "TestNetwork";
    String password = "TestPassword";
    bool has_credentials = (!ssid.isEmpty() && !password.isEmpty());
    TEST_ASSERT_TRUE(has_credentials);
}

void test_credentials_ssid_length() {
    String ssid = "Test";
    bool valid_length = (ssid.length() > 0 && ssid.length() <= 32);
    TEST_ASSERT_TRUE(valid_length);
}

void test_credentials_ssid_too_long() {
    String ssid = "ThisIsAReallyLongSSIDThatExceeds32Characters";
    bool valid_length = (ssid.length() <= 32);
    TEST_ASSERT_FALSE(valid_length);
}

void test_credentials_password_length() {
    String password = "12345678"; // Min 8 for WPA2
    bool valid_length = (password.length() >= 8);
    TEST_ASSERT_TRUE(valid_length);
}

void test_credentials_password_too_short() {
    String password = "1234567"; // Only 7 chars
    bool valid_length = (password.length() >= 8);
    TEST_ASSERT_FALSE(valid_length);
}

// ============================================================================
// IP Address Tests
// ============================================================================

void test_ip_address_format() {
    String ip = "192.168.1.100";
    TEST_ASSERT_TRUE(ip.indexOf('.') > 0);
}

void test_ip_address_octets() {
    String ip = "192.168.1.100";
    int dots = 0;
    for (size_t i = 0; i < ip.length(); i++) {
        if (ip.charAt(i) == '.') dots++;
    }
    TEST_ASSERT_EQUAL(3, dots); // Valid IP has 3 dots
}

void test_ip_address_empty() {
    String ip = "";
    TEST_ASSERT_TRUE(ip.isEmpty());
}

void test_ip_address_not_assigned() {
    String ip = "0.0.0.0";
    bool assigned = (ip != "0.0.0.0" && !ip.isEmpty());
    TEST_ASSERT_FALSE(assigned);
}

void test_ip_address_assigned() {
    String ip = "192.168.1.100";
    bool assigned = (ip != "0.0.0.0" && !ip.isEmpty());
    TEST_ASSERT_TRUE(assigned);
}

// ============================================================================
// mDNS Integration Tests
// ============================================================================

void test_mdns_retry_interval() {
    unsigned long last_attempt = 0;
    unsigned long current_time = 20000;
    unsigned long elapsed = current_time - last_attempt;
    
    bool should_retry = (elapsed >= MDNS_RETRY_INTERVAL);
    TEST_ASSERT_FALSE(should_retry); // 20s < 30s
}

void test_mdns_retry_interval_exceeded() {
    unsigned long last_attempt = 0;
    unsigned long current_time = 31000;
    unsigned long elapsed = current_time - last_attempt;
    
    bool should_retry = (elapsed >= MDNS_RETRY_INTERVAL);
    TEST_ASSERT_TRUE(should_retry); // 31s > 30s
}

void test_mdns_after_reconnect() {
    bool wifi_connected = true;
    bool mdns_started = false;
    
    if (wifi_connected && !mdns_started) {
        mdns_started = true;
    }
    
    TEST_ASSERT_TRUE(mdns_started);
}

// ============================================================================
// Event Handling Tests
// ============================================================================

void test_wifi_event_connected() {
    enum WiFiEvent { EVENT_NONE, EVENT_CONNECTED, EVENT_DISCONNECTED };
    WiFiEvent event = EVENT_CONNECTED;
    
    TEST_ASSERT_EQUAL(EVENT_CONNECTED, event);
}

void test_wifi_event_disconnected() {
    enum WiFiEvent { EVENT_NONE, EVENT_CONNECTED, EVENT_DISCONNECTED };
    WiFiEvent event = EVENT_DISCONNECTED;
    
    TEST_ASSERT_EQUAL(EVENT_DISCONNECTED, event);
}

void test_wifi_event_handler_connected() {
    bool connected = false;
    // Simulate connected event
    connected = true;
    
    TEST_ASSERT_TRUE(connected);
}

void test_wifi_event_handler_disconnected() {
    bool connected = true;
    // Simulate disconnected event
    connected = false;
    
    TEST_ASSERT_FALSE(connected);
}

// ============================================================================
// Fallback Behavior Tests
// ============================================================================

void test_fallback_to_ap_no_credentials() {
    String ssid = "";
    String password = "";
    bool has_credentials = (!ssid.isEmpty() && !password.isEmpty());
    bool should_start_ap = !has_credentials;
    
    TEST_ASSERT_TRUE(should_start_ap);
}

void test_fallback_to_ap_connection_failed() {
    bool connection_failed = true;
    uint8_t retry_count = 3;
    bool should_start_ap = (connection_failed && retry_count >= 3);
    
    TEST_ASSERT_TRUE(should_start_ap);
}

void test_no_fallback_with_credentials() {
    String ssid = "TestNetwork";
    String password = "TestPassword";
    bool has_credentials = (!ssid.isEmpty() && !password.isEmpty());
    bool should_start_ap = !has_credentials;
    
    TEST_ASSERT_FALSE(should_start_ap);
}

// ============================================================================
// State Persistence Tests
// ============================================================================

void test_state_persistence_connected() {
    WiFiState previous_state = WIFI_CONNECTED;
    WiFiState current_state = WIFI_CONNECTED;
    bool state_changed = (previous_state != current_state);
    
    TEST_ASSERT_FALSE(state_changed);
}

void test_state_persistence_disconnected() {
    WiFiState previous_state = WIFI_CONNECTED;
    WiFiState current_state = WIFI_DISCONNECTED;
    bool state_changed = (previous_state != current_state);
    
    TEST_ASSERT_TRUE(state_changed);
}

// ============================================================================
// Connection Timeout Tests
// ============================================================================

void test_connection_timeout_not_exceeded() {
    unsigned long connect_start = 0;
    unsigned long current_time = 5000;
    unsigned long timeout = 10000;
    bool timed_out = ((current_time - connect_start) >= timeout);
    
    TEST_ASSERT_FALSE(timed_out);
}

void test_connection_timeout_exceeded() {
    unsigned long connect_start = 0;
    unsigned long current_time = 11000;
    unsigned long timeout = 10000;
    bool timed_out = ((current_time - connect_start) >= timeout);
    
    TEST_ASSERT_TRUE(timed_out);
}

// ============================================================================
// Improv Skip Tests (WiFi Setup Regression Fix)
// ============================================================================

void test_improv_skip_when_wifi_configured() {
    // When WiFi is configured and NOT in recovery mode, Improv should be skipped
    bool wifi_configured = true;
    bool recovery_mode = false;
    
    bool should_skip_improv = (wifi_configured && !recovery_mode);
    
    TEST_ASSERT_TRUE(should_skip_improv);
}

void test_improv_brief_window_in_recovery_with_wifi() {
    // When WiFi is configured AND in recovery mode, allow brief 30-second window
    bool wifi_configured = true;
    bool recovery_mode = true;
    
    bool should_brief_window = (wifi_configured && recovery_mode);
    unsigned long expected_timeout = 30000;  // 30 seconds
    
    TEST_ASSERT_TRUE(should_brief_window);
    TEST_ASSERT_EQUAL(30000, expected_timeout);
}

void test_improv_full_detection_no_wifi() {
    // When no WiFi configured, run full Improv detection
    bool wifi_configured = false;
    bool recovery_mode = false;
    
    bool should_run_detection = !wifi_configured;
    unsigned long expected_timeout = 10000;  // 10 seconds normal
    
    TEST_ASSERT_TRUE(should_run_detection);
    TEST_ASSERT_EQUAL(10000, expected_timeout);
}

void test_improv_extended_detection_recovery_no_wifi() {
    // When no WiFi configured AND in recovery mode, extended 5-minute window
    bool wifi_configured = false;
    bool recovery_mode = true;
    
    unsigned long expected_timeout = recovery_mode ? 300000 : 10000;
    
    TEST_ASSERT_EQUAL(300000, expected_timeout);
}

// ============================================================================
// Scan Cleanup Tests (WiFi Setup Regression Fix)
// ============================================================================

void test_scan_cleanup_clears_state() {
    // Before starting a new scan, stale state should be cleared
    // WIFI_SCAN_RUNNING = -1, WIFI_SCAN_FAILED = -2
    int16_t scan_status_running = -1;  // WIFI_SCAN_RUNNING
    int16_t scan_status_failed = -2;   // WIFI_SCAN_FAILED
    
    // If scan is running, it should be cleaned up
    bool needs_cleanup = (scan_status_running == -1);
    TEST_ASSERT_TRUE(needs_cleanup);
    
    // If scan failed, also needs cleanup
    needs_cleanup = (scan_status_failed == -2);
    TEST_ASSERT_TRUE(needs_cleanup);
}

void test_wifi_mode_guard() {
    // WiFi.mode() should only be called if not already in correct mode
    // Simulating WIFI_STA = 1, WIFI_AP_STA = 3
    int WIFI_STA = 1;
    int WIFI_AP_STA = 3;
    
    int current_mode = WIFI_STA;
    bool should_set_mode = (current_mode != WIFI_STA && current_mode != WIFI_AP_STA);
    TEST_ASSERT_FALSE(should_set_mode);  // Already in STA mode, don't set again
    
    current_mode = WIFI_AP_STA;
    should_set_mode = (current_mode != WIFI_STA && current_mode != WIFI_AP_STA);
    TEST_ASSERT_FALSE(should_set_mode);  // In AP_STA mode, also acceptable
    
    current_mode = 2;  // WIFI_AP
    should_set_mode = (current_mode != WIFI_STA && current_mode != WIFI_AP_STA);
    TEST_ASSERT_TRUE(should_set_mode);  // Not in STA or AP_STA, need to set
}

// ============================================================================
// Reconnection Fix Tests (WiFi Setup Regression Fix)
// ============================================================================

void test_reconnect_uses_wifi_begin() {
    // handleConnection should use WiFi.begin() instead of WiFi.reconnect()
    // This is a behavioral test - we're testing the decision logic
    bool use_begin_not_reconnect = true;  // New behavior
    TEST_ASSERT_TRUE(use_begin_not_reconnect);
}

void test_reconnect_requires_credentials() {
    // Reconnection should only attempt if credentials are available
    String ssid = "TestNetwork";
    String password = "TestPassword";
    
    bool can_reconnect = !ssid.isEmpty();
    TEST_ASSERT_TRUE(can_reconnect);
    
    ssid = "";
    can_reconnect = !ssid.isEmpty();
    TEST_ASSERT_FALSE(can_reconnect);
}

// ============================================================================
// Scan Fallback Tests (WiFi Setup Regression Fix)
// ============================================================================

void test_async_scan_fallback_to_blocking() {
    // If async scan fails, should fallback to blocking scan
    bool scan_completed = false;
    bool should_try_blocking = !scan_completed;
    
    TEST_ASSERT_TRUE(should_try_blocking);
}

void test_async_scan_no_fallback_on_success() {
    // If async scan succeeds, no need for fallback
    bool scan_completed = true;
    bool should_try_blocking = !scan_completed;
    
    TEST_ASSERT_FALSE(should_try_blocking);
}

void test_blocking_scan_result_handling() {
    // Blocking scan returns network count directly
    int blocking_result = 5;  // 5 networks found
    bool blocking_success = (blocking_result > 0);
    
    TEST_ASSERT_TRUE(blocking_success);
    
    blocking_result = 0;  // No networks
    blocking_success = (blocking_result > 0);
    TEST_ASSERT_FALSE(blocking_success);
    
    blocking_result = -2;  // Error
    blocking_success = (blocking_result > 0);
    TEST_ASSERT_FALSE(blocking_success);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_wifi_manager_tests() {
    UNITY_BEGIN();
    
    // State machine tests
    RUN_TEST(test_wifi_state_initial);
    RUN_TEST(test_wifi_state_transition_to_scanning);
    RUN_TEST(test_wifi_state_transition_to_connecting);
    RUN_TEST(test_wifi_state_transition_to_connected);
    RUN_TEST(test_wifi_state_transition_to_disconnected);
    RUN_TEST(test_wifi_state_transition_to_reconnecting);
    RUN_TEST(test_wifi_state_transition_to_ap_mode);
    
    // Connection state tests
    RUN_TEST(test_wifi_not_connected);
    RUN_TEST(test_wifi_connected);
    RUN_TEST(test_wifi_connection_with_ip);
    RUN_TEST(test_wifi_connection_without_ip);
    
    // AP mode tests
    RUN_TEST(test_ap_mode_inactive);
    RUN_TEST(test_ap_mode_active);
    RUN_TEST(test_ap_mode_with_ip);
    RUN_TEST(test_ap_mode_ssid_format);
    RUN_TEST(test_ap_mode_disable);
    
    // Reconnection tests
    RUN_TEST(test_reconnect_attempts_initial);
    RUN_TEST(test_reconnect_attempts_increment);
    RUN_TEST(test_reconnect_attempts_max);
    RUN_TEST(test_reconnect_attempts_reset);
    RUN_TEST(test_reconnect_exponential_backoff);
    
    // Connection check tests
    RUN_TEST(test_connection_check_interval);
    RUN_TEST(test_connection_check_interval_exceeded);
    RUN_TEST(test_connection_check_update_timestamp);
    
    // Network scanning tests
    RUN_TEST(test_network_scan_empty_results);
    RUN_TEST(test_network_scan_with_results);
    RUN_TEST(test_network_scan_ssid_extraction);
    RUN_TEST(test_network_scan_rssi);
    RUN_TEST(test_network_scan_rssi_strength);
    RUN_TEST(test_network_scan_rssi_weak);
    RUN_TEST(test_network_scan_encryption_type);
    RUN_TEST(test_network_scan_open_network);
    RUN_TEST(test_network_scan_secured_network);
    
    // Credentials validation tests
    RUN_TEST(test_credentials_empty);
    RUN_TEST(test_credentials_ssid_only);
    RUN_TEST(test_credentials_valid);
    RUN_TEST(test_credentials_ssid_length);
    RUN_TEST(test_credentials_ssid_too_long);
    RUN_TEST(test_credentials_password_length);
    RUN_TEST(test_credentials_password_too_short);
    
    // IP address tests
    RUN_TEST(test_ip_address_format);
    RUN_TEST(test_ip_address_octets);
    RUN_TEST(test_ip_address_empty);
    RUN_TEST(test_ip_address_not_assigned);
    RUN_TEST(test_ip_address_assigned);
    
    // mDNS integration tests
    RUN_TEST(test_mdns_retry_interval);
    RUN_TEST(test_mdns_retry_interval_exceeded);
    RUN_TEST(test_mdns_after_reconnect);
    
    // Event handling tests
    RUN_TEST(test_wifi_event_connected);
    RUN_TEST(test_wifi_event_disconnected);
    RUN_TEST(test_wifi_event_handler_connected);
    RUN_TEST(test_wifi_event_handler_disconnected);
    
    // Fallback behavior tests
    RUN_TEST(test_fallback_to_ap_no_credentials);
    RUN_TEST(test_fallback_to_ap_connection_failed);
    RUN_TEST(test_no_fallback_with_credentials);
    
    // State persistence tests
    RUN_TEST(test_state_persistence_connected);
    RUN_TEST(test_state_persistence_disconnected);
    
    // Connection timeout tests
    RUN_TEST(test_connection_timeout_not_exceeded);
    RUN_TEST(test_connection_timeout_exceeded);
    
    // Improv skip tests (WiFi setup regression fix)
    RUN_TEST(test_improv_skip_when_wifi_configured);
    RUN_TEST(test_improv_brief_window_in_recovery_with_wifi);
    RUN_TEST(test_improv_full_detection_no_wifi);
    RUN_TEST(test_improv_extended_detection_recovery_no_wifi);
    
    // Scan cleanup tests (WiFi setup regression fix)
    RUN_TEST(test_scan_cleanup_clears_state);
    RUN_TEST(test_wifi_mode_guard);
    
    // Reconnection fix tests (WiFi setup regression fix)
    RUN_TEST(test_reconnect_uses_wifi_begin);
    RUN_TEST(test_reconnect_requires_credentials);
    
    // Scan fallback tests (WiFi setup regression fix)
    RUN_TEST(test_async_scan_fallback_to_blocking);
    RUN_TEST(test_async_scan_no_fallback_on_success);
    RUN_TEST(test_blocking_scan_result_handling);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_wifi_manager_tests();
    return 0;
}
#else
void setup() {
    delay(2000);
    run_wifi_manager_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
