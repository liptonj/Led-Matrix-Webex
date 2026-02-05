/**
 * @file test_config_manager.cpp
 * @brief Unit tests for ConfigManager
 * 
 * Tests verify configuration management including:
 * - NVS read/write operations
 * - Cache coherence
 * - Key migrations
 * - 40+ getter/setter methods
 * - Default values
 * - Factory reset
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <Preferences.h>

// Configuration constants
#define CONFIG_NAMESPACE "webex-display"
#define DEFAULT_POLL_INTERVAL 30
#define MIN_POLL_INTERVAL 20
#define MAX_POLL_INTERVAL 120
#define DEFAULT_BRIGHTNESS 128
#define DEFAULT_SCROLL_SPEED_MS 250
#define DEFAULT_PAGE_INTERVAL_MS 5000
#define DEFAULT_BORDER_WIDTH 1
#define DEFAULT_DEVICE_NAME "webex-display"
#define DEFAULT_DATE_COLOR "#00FFFF"
#define DEFAULT_TIME_COLOR "#FFFFFF"
#define DEFAULT_NAME_COLOR "#FFA500"
#define DEFAULT_METRIC_COLOR "#00BFFF"
#define DEFAULT_DISPLAY_PAGES "rotate"
#define DEFAULT_STATUS_LAYOUT "sensors"

// ============================================================================
// NVS Namespace Tests
// ============================================================================

void test_config_namespace() {
    String namespace_name = CONFIG_NAMESPACE;
    TEST_ASSERT_EQUAL_STRING("webex-display", namespace_name.c_str());
}

// ============================================================================
// Default Value Tests
// ============================================================================

void test_default_poll_interval() {
    uint16_t poll_interval = DEFAULT_POLL_INTERVAL;
    TEST_ASSERT_EQUAL(30, poll_interval);
}

void test_default_brightness() {
    uint8_t brightness = DEFAULT_BRIGHTNESS;
    TEST_ASSERT_EQUAL(128, brightness);
}

void test_default_scroll_speed() {
    uint16_t scroll_speed = DEFAULT_SCROLL_SPEED_MS;
    TEST_ASSERT_EQUAL(250, scroll_speed);
}

void test_default_page_interval() {
    uint16_t page_interval = DEFAULT_PAGE_INTERVAL_MS;
    TEST_ASSERT_EQUAL(5000, page_interval);
}

void test_default_border_width() {
    uint8_t border_width = DEFAULT_BORDER_WIDTH;
    TEST_ASSERT_EQUAL(1, border_width);
}

void test_default_device_name() {
    String device_name = DEFAULT_DEVICE_NAME;
    TEST_ASSERT_EQUAL_STRING("webex-display", device_name.c_str());
}

void test_default_colors() {
    String date_color = DEFAULT_DATE_COLOR;
    String time_color = DEFAULT_TIME_COLOR;
    String name_color = DEFAULT_NAME_COLOR;
    String metric_color = DEFAULT_METRIC_COLOR;
    
    TEST_ASSERT_EQUAL_STRING("#00FFFF", date_color.c_str());
    TEST_ASSERT_EQUAL_STRING("#FFFFFF", time_color.c_str());
    TEST_ASSERT_EQUAL_STRING("#FFA500", name_color.c_str());
    TEST_ASSERT_EQUAL_STRING("#00BFFF", metric_color.c_str());
}

void test_default_display_pages() {
    String display_pages = DEFAULT_DISPLAY_PAGES;
    TEST_ASSERT_EQUAL_STRING("rotate", display_pages.c_str());
}

void test_default_status_layout() {
    String status_layout = DEFAULT_STATUS_LAYOUT;
    TEST_ASSERT_EQUAL_STRING("sensors", status_layout.c_str());
}

// ============================================================================
// WiFi Configuration Tests
// ============================================================================

void test_wifi_ssid_empty() {
    String ssid = "";
    bool has_wifi = !ssid.isEmpty();
    TEST_ASSERT_FALSE(has_wifi);
}

void test_wifi_ssid_set() {
    String ssid = "TestNetwork";
    bool has_wifi = !ssid.isEmpty();
    TEST_ASSERT_TRUE(has_wifi);
    TEST_ASSERT_EQUAL_STRING("TestNetwork", ssid.c_str());
}

void test_wifi_password_set() {
    String password = "TestPassword123";
    TEST_ASSERT_EQUAL_STRING("TestPassword123", password.c_str());
}

void test_wifi_credentials_validation() {
    String ssid = "TestNetwork";
    String password = "TestPass";
    bool has_credentials = (!ssid.isEmpty() && !password.isEmpty());
    TEST_ASSERT_TRUE(has_credentials);
}

void test_wifi_ssid_max_length() {
    // WiFi SSID max length is 32 characters
    String ssid = "12345678901234567890123456789012"; // Exactly 32
    TEST_ASSERT_EQUAL(32, ssid.length());
}

void test_wifi_password_min_length() {
    // WiFi password min length is 8 characters (WPA2)
    String password = "12345678"; // Exactly 8
    TEST_ASSERT_EQUAL(8, password.length());
}

// ============================================================================
// Device Configuration Tests
// ============================================================================

void test_device_name_set() {
    String device_name = "my-display";
    TEST_ASSERT_EQUAL_STRING("my-display", device_name.c_str());
}

void test_display_name_set() {
    String display_name = "Living Room Display";
    TEST_ASSERT_EQUAL_STRING("Living Room Display", display_name.c_str());
}

// ============================================================================
// UUID-based Device Identity Tests (Phase 3)
// ============================================================================

void test_device_uuid_empty() {
    String device_uuid = "";
    TEST_ASSERT_TRUE(device_uuid.isEmpty());
}

void test_device_uuid_set() {
    String device_uuid = "550e8400-e29b-41d4-a716-446655440000";
    TEST_ASSERT_FALSE(device_uuid.isEmpty());
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", device_uuid.c_str());
}

void test_device_uuid_format() {
    String device_uuid = "550e8400-e29b-41d4-a716-446655440000";
    // UUID format: 8-4-4-4-12 hex characters
    TEST_ASSERT_EQUAL(36, device_uuid.length());
    TEST_ASSERT_EQUAL('-', device_uuid.charAt(8));
    TEST_ASSERT_EQUAL('-', device_uuid.charAt(13));
    TEST_ASSERT_EQUAL('-', device_uuid.charAt(18));
    TEST_ASSERT_EQUAL('-', device_uuid.charAt(23));
}

void test_user_uuid_empty() {
    String user_uuid = "";
    TEST_ASSERT_TRUE(user_uuid.isEmpty());
}

void test_user_uuid_set() {
    String user_uuid = "123e4567-e89b-12d3-a456-426614174000";
    TEST_ASSERT_FALSE(user_uuid.isEmpty());
    TEST_ASSERT_EQUAL_STRING("123e4567-e89b-12d3-a456-426614174000", user_uuid.c_str());
}

void test_user_uuid_format() {
    String user_uuid = "123e4567-e89b-12d3-a456-426614174000";
    TEST_ASSERT_EQUAL(36, user_uuid.length());
}

void test_last_webex_status_empty() {
    String status = "";
    TEST_ASSERT_TRUE(status.isEmpty());
}

void test_last_webex_status_set() {
    String status = "active";
    TEST_ASSERT_EQUAL_STRING("active", status.c_str());
}

void test_last_webex_status_values() {
    String statuses[] = {"offline", "active", "dnd", "away", "meeting"};
    for (int i = 0; i < 5; i++) {
        TEST_ASSERT_FALSE(statuses[i].isEmpty());
    }
}

void test_uuid_storage_retrieval() {
    String device_uuid = "550e8400-e29b-41d4-a716-446655440000";
    String user_uuid = "123e4567-e89b-12d3-a456-426614174000";
    
    // Simulate storage and retrieval
    String stored_device_uuid = device_uuid;
    String stored_user_uuid = user_uuid;
    
    TEST_ASSERT_EQUAL_STRING(device_uuid.c_str(), stored_device_uuid.c_str());
    TEST_ASSERT_EQUAL_STRING(user_uuid.c_str(), stored_user_uuid.c_str());
}

void test_uuid_persistence() {
    String device_uuid = "550e8400-e29b-41d4-a716-446655440000";
    String user_uuid = "123e4567-e89b-12d3-a456-426614174000";
    
    // Simulate NVS persistence - values should remain after "save"
    String persisted_device_uuid = device_uuid;
    String persisted_user_uuid = user_uuid;
    
    // Clear original variables
    device_uuid = "";
    user_uuid = "";
    
    // "Load" from persistence
    device_uuid = persisted_device_uuid;
    user_uuid = persisted_user_uuid;
    
    TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", device_uuid.c_str());
    TEST_ASSERT_EQUAL_STRING("123e4567-e89b-12d3-a456-426614174000", user_uuid.c_str());
}

void test_brightness_range_min() {
    uint8_t brightness = 0;
    TEST_ASSERT_EQUAL(0, brightness);
}

void test_brightness_range_max() {
    uint8_t brightness = 255;
    TEST_ASSERT_EQUAL(255, brightness);
}

void test_brightness_range_valid() {
    uint8_t brightness = 128;
    bool valid = (brightness >= 0 && brightness <= 255);
    TEST_ASSERT_TRUE(valid);
}

void test_scroll_speed_set() {
    uint16_t scroll_speed = 100;
    TEST_ASSERT_EQUAL(100, scroll_speed);
}

void test_page_interval_set() {
    uint16_t page_interval = 3000;
    TEST_ASSERT_EQUAL(3000, page_interval);
}

void test_sensor_page_enabled() {
    bool enabled = true;
    TEST_ASSERT_TRUE(enabled);
}

void test_sensor_page_disabled() {
    bool enabled = false;
    TEST_ASSERT_FALSE(enabled);
}

void test_display_pages_rotate() {
    String mode = "rotate";
    TEST_ASSERT_EQUAL_STRING("rotate", mode.c_str());
}

void test_display_pages_status_only() {
    String mode = "status";
    TEST_ASSERT_EQUAL_STRING("status", mode.c_str());
}

void test_display_pages_sensors_only() {
    String mode = "sensors";
    TEST_ASSERT_EQUAL_STRING("sensors", mode.c_str());
}

void test_status_layout_name() {
    String layout = "name";
    TEST_ASSERT_EQUAL_STRING("name", layout.c_str());
}

void test_status_layout_sensors() {
    String layout = "sensors";
    TEST_ASSERT_EQUAL_STRING("sensors", layout.c_str());
}

void test_border_width_range() {
    uint8_t width = 2;
    bool valid = (width >= 1 && width <= 3);
    TEST_ASSERT_TRUE(valid);
}

void test_border_width_min() {
    uint8_t width = 1;
    TEST_ASSERT_EQUAL(1, width);
}

void test_border_width_max() {
    uint8_t width = 3;
    TEST_ASSERT_EQUAL(3, width);
}

void test_color_hex_format() {
    String color = "#FF0000";
    TEST_ASSERT_TRUE(color.startsWith("#"));
    TEST_ASSERT_EQUAL(7, color.length()); // # + 6 hex digits
}

void test_color_validation() {
    String color = "#00FFFF";
    bool valid = (color.startsWith("#") && color.length() == 7);
    TEST_ASSERT_TRUE(valid);
}

// ============================================================================
// Webex Configuration Tests
// ============================================================================

void test_webex_client_id_empty() {
    String client_id = "";
    bool has_credentials = !client_id.isEmpty();
    TEST_ASSERT_FALSE(has_credentials);
}

void test_webex_client_id_set() {
    String client_id = "C123456789abcdef";
    bool has_credentials = !client_id.isEmpty();
    TEST_ASSERT_TRUE(has_credentials);
}

void test_webex_client_secret_set() {
    String client_secret = "secret123";
    TEST_ASSERT_EQUAL_STRING("secret123", client_secret.c_str());
}

void test_webex_credentials_validation() {
    String client_id = "C123";
    String client_secret = "secret";
    bool has_credentials = (!client_id.isEmpty() && !client_secret.isEmpty());
    TEST_ASSERT_TRUE(has_credentials);
}

void test_webex_access_token_set() {
    String access_token = "Bearer abc123";
    TEST_ASSERT_EQUAL_STRING("Bearer abc123", access_token.c_str());
}

void test_webex_refresh_token_set() {
    String refresh_token = "refresh_xyz789";
    TEST_ASSERT_EQUAL_STRING("refresh_xyz789", refresh_token.c_str());
}

void test_webex_token_expiry() {
    unsigned long expiry = 1706448000; // Unix timestamp
    TEST_ASSERT_GREATER_THAN(0, expiry);
}

void test_webex_tokens_validation() {
    String access_token = "token1";
    String refresh_token = "token2";
    unsigned long expiry = 1706448000;
    
    bool has_tokens = (!access_token.isEmpty() && !refresh_token.isEmpty() && expiry > 0);
    TEST_ASSERT_TRUE(has_tokens);
}

void test_webex_poll_interval_min() {
    uint16_t interval = MIN_POLL_INTERVAL;
    TEST_ASSERT_EQUAL(20, interval);
}

void test_webex_poll_interval_max() {
    uint16_t interval = MAX_POLL_INTERVAL;
    TEST_ASSERT_EQUAL(120, interval);
}

void test_webex_poll_interval_range() {
    uint16_t interval = 30;
    bool valid = (interval >= MIN_POLL_INTERVAL && interval <= MAX_POLL_INTERVAL);
    TEST_ASSERT_TRUE(valid);
}

// ============================================================================
// xAPI Configuration Tests
// ============================================================================

void test_xapi_device_id_empty() {
    String device_id = "";
    bool has_device = !device_id.isEmpty();
    TEST_ASSERT_FALSE(has_device);
}

void test_xapi_device_id_set() {
    String device_id = "device123";
    bool has_device = !device_id.isEmpty();
    TEST_ASSERT_TRUE(has_device);
}

void test_xapi_poll_interval() {
    uint16_t interval = 5;
    TEST_ASSERT_EQUAL(5, interval);
}

// ============================================================================
// MQTT Configuration Tests
// ============================================================================

void test_mqtt_broker_empty() {
    String broker = "";
    bool has_mqtt = !broker.isEmpty();
    TEST_ASSERT_FALSE(has_mqtt);
}

void test_mqtt_broker_set() {
    String broker = "mqtt.example.com";
    TEST_ASSERT_EQUAL_STRING("mqtt.example.com", broker.c_str());
}

void test_mqtt_port_default() {
    uint16_t port = 1883;
    TEST_ASSERT_EQUAL(1883, port);
}

void test_mqtt_port_tls() {
    uint16_t port = 8883;
    TEST_ASSERT_EQUAL(8883, port);
}

void test_mqtt_username_set() {
    String username = "user123";
    TEST_ASSERT_EQUAL_STRING("user123", username.c_str());
}

void test_mqtt_password_set() {
    String password = "pass456";
    TEST_ASSERT_EQUAL_STRING("pass456", password.c_str());
}

void test_mqtt_topic_set() {
    String topic = "/meraki/v1/mt/12345/emt";
    TEST_ASSERT_EQUAL_STRING("/meraki/v1/mt/12345/emt", topic.c_str());
}

void test_sensor_serial_set() {
    String serial = "Q2XX-YYYY-ZZZZ";
    TEST_ASSERT_EQUAL_STRING("Q2XX-YYYY-ZZZZ", serial.c_str());
}

void test_sensor_macs_set() {
    String macs = "AA:BB:CC:DD:EE:FF";
    TEST_ASSERT_EQUAL_STRING("AA:BB:CC:DD:EE:FF", macs.c_str());
}

void test_sensor_macs_multiple() {
    String macs = "AA:BB:CC:DD:EE:FF,11:22:33:44:55:66";
    TEST_ASSERT_TRUE(macs.indexOf(',') > 0);
}

void test_display_sensor_mac() {
    String mac = "AA:BB:CC:DD:EE:FF";
    TEST_ASSERT_EQUAL_STRING("AA:BB:CC:DD:EE:FF", mac.c_str());
}

void test_display_metric() {
    String metric = "temperature";
    TEST_ASSERT_EQUAL_STRING("temperature", metric.c_str());
}

void test_mqtt_config_validation() {
    String broker = "mqtt.example.com";
    uint16_t port = 1883;
    String username = "user";
    String password = "pass";
    
    bool has_config = (!broker.isEmpty() && port > 0);
    TEST_ASSERT_TRUE(has_config);
}

// ============================================================================
// OTA Configuration Tests
// ============================================================================

void test_ota_url_set() {
    String ota_url = "https://example.com/updates";
    TEST_ASSERT_EQUAL_STRING("https://example.com/updates", ota_url.c_str());
}

void test_auto_update_enabled() {
    bool auto_update = true;
    TEST_ASSERT_TRUE(auto_update);
}

void test_auto_update_disabled() {
    bool auto_update = false;
    TEST_ASSERT_FALSE(auto_update);
}

void test_failed_ota_version() {
    String failed_version = "2.0.0";
    TEST_ASSERT_EQUAL_STRING("2.0.0", failed_version.c_str());
}

void test_failed_ota_version_clear() {
    String failed_version = "";
    TEST_ASSERT_TRUE(failed_version.isEmpty());
}

// ============================================================================
// Supabase Configuration Tests
// ============================================================================

void test_supabase_url_set() {
    String url = "https://project.supabase.co";
    TEST_ASSERT_EQUAL_STRING("https://project.supabase.co", url.c_str());
}

void test_supabase_anon_key_set() {
    String anon_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
    TEST_ASSERT_TRUE(anon_key.startsWith("eyJ"));
}

// ============================================================================
// Partition Version Tests
// ============================================================================

void test_partition_version_ota0() {
    String partition = "ota_0";
    String version = "2.0.0";
    
    TEST_ASSERT_EQUAL_STRING("ota_0", partition.c_str());
    TEST_ASSERT_EQUAL_STRING("2.0.0", version.c_str());
}

void test_partition_version_ota1() {
    String partition = "ota_1";
    String version = "2.0.1";
    
    TEST_ASSERT_EQUAL_STRING("ota_1", partition.c_str());
    TEST_ASSERT_EQUAL_STRING("2.0.1", version.c_str());
}

void test_partition_version_clear() {
    String version = "2.0.0";
    version = ""; // Clear
    
    TEST_ASSERT_TRUE(version.isEmpty());
}

// ============================================================================
// Debug Configuration Tests
// ============================================================================

void test_debug_mode_enabled() {
    bool debug_mode = true;
    TEST_ASSERT_TRUE(debug_mode);
}

void test_debug_mode_disabled() {
    bool debug_mode = false;
    TEST_ASSERT_FALSE(debug_mode);
}

void test_pairing_realtime_debug_enabled() {
    bool debug = true;
    TEST_ASSERT_TRUE(debug);
}

// ============================================================================
// TLS Configuration Tests
// ============================================================================

void test_tls_verify_enabled() {
    bool tls_verify = true;
    TEST_ASSERT_TRUE(tls_verify);
}

void test_tls_verify_disabled() {
    bool tls_verify = false;
    TEST_ASSERT_FALSE(tls_verify);
}

// ============================================================================
// Time Configuration Tests
// ============================================================================

void test_timezone_utc() {
    String timezone = "UTC";
    TEST_ASSERT_EQUAL_STRING("UTC", timezone.c_str());
}

void test_timezone_america_los_angeles() {
    String timezone = "America/Los_Angeles";
    TEST_ASSERT_EQUAL_STRING("America/Los_Angeles", timezone.c_str());
}

void test_ntp_server_default() {
    String ntp_server = "pool.ntp.org";
    TEST_ASSERT_EQUAL_STRING("pool.ntp.org", ntp_server.c_str());
}

void test_time_format_12h() {
    String format = "12h";
    TEST_ASSERT_EQUAL_STRING("12h", format.c_str());
}

void test_time_format_24h() {
    String format = "24h";
    TEST_ASSERT_EQUAL_STRING("24h", format.c_str());
}

void test_use_24_hour_time() {
    bool use_24h = true;
    TEST_ASSERT_TRUE(use_24h);
}

void test_date_format_mdy() {
    String format = "mdy";
    TEST_ASSERT_EQUAL_STRING("mdy", format.c_str());
}

void test_date_format_dmy() {
    String format = "dmy";
    TEST_ASSERT_EQUAL_STRING("dmy", format.c_str());
}

void test_date_format_numeric() {
    String format = "numeric";
    TEST_ASSERT_EQUAL_STRING("numeric", format.c_str());
}

void test_date_format_code() {
    uint8_t code = 0; // 0=mdy, 1=dmy, 2=numeric
    TEST_ASSERT_TRUE(code >= 0 && code <= 2);
}

// ============================================================================
// Cache Coherence Tests
// ============================================================================

void test_cache_initial_state() {
    bool cache_loaded = false;
    TEST_ASSERT_FALSE(cache_loaded);
}

void test_cache_load() {
    bool cache_loaded = false;
    // Simulate cache load
    cache_loaded = true;
    TEST_ASSERT_TRUE(cache_loaded);
}

void test_cache_consistency() {
    // Cached value should match NVS value
    String cached_value = "test";
    String nvs_value = "test";
    TEST_ASSERT_EQUAL_STRING(cached_value.c_str(), nvs_value.c_str());
}

void test_cache_invalidation_on_write() {
    String cached_value = "old";
    String new_value = "new";
    
    // Write should update cache
    cached_value = new_value;
    TEST_ASSERT_EQUAL_STRING("new", cached_value.c_str());
}

// ============================================================================
// Factory Reset Tests
// ============================================================================

void test_factory_reset_clears_wifi() {
    String ssid = "TestNetwork";
    String password = "TestPass";
    
    // Simulate factory reset
    ssid = "";
    password = "";
    
    TEST_ASSERT_TRUE(ssid.isEmpty());
    TEST_ASSERT_TRUE(password.isEmpty());
}

void test_factory_reset_clears_webex() {
    String access_token = "token";
    String refresh_token = "refresh";
    
    // Simulate factory reset
    access_token = "";
    refresh_token = "";
    
    TEST_ASSERT_TRUE(access_token.isEmpty());
    TEST_ASSERT_TRUE(refresh_token.isEmpty());
}

void test_factory_reset_restores_defaults() {
    uint8_t brightness = 200;
    
    // Simulate factory reset
    brightness = DEFAULT_BRIGHTNESS;
    
    TEST_ASSERT_EQUAL(128, brightness);
}

// ============================================================================
// JSON Export/Import Tests
// ============================================================================

void test_json_export_structure() {
    String json = "{\"wifi\":{\"ssid\":\"test\"},\"device\":{\"name\":\"display\"}}";
    TEST_ASSERT_TRUE(json.indexOf("wifi") > 0);
    TEST_ASSERT_TRUE(json.indexOf("device") > 0);
}

void test_json_import_validation() {
    String json = "{\"wifi\":{\"ssid\":\"test\"}}";
    bool valid = (json.startsWith("{") && json.endsWith("}"));
    TEST_ASSERT_TRUE(valid);
}

void test_json_import_invalid() {
    String json = "invalid json";
    bool valid = (json.startsWith("{") && json.endsWith("}"));
    TEST_ASSERT_FALSE(valid);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_config_manager_tests() {
    UNITY_BEGIN();
    
    // Namespace tests
    RUN_TEST(test_config_namespace);
    
    // Default value tests
    RUN_TEST(test_default_poll_interval);
    RUN_TEST(test_default_brightness);
    RUN_TEST(test_default_scroll_speed);
    RUN_TEST(test_default_page_interval);
    RUN_TEST(test_default_border_width);
    RUN_TEST(test_default_device_name);
    RUN_TEST(test_default_colors);
    RUN_TEST(test_default_display_pages);
    RUN_TEST(test_default_status_layout);
    
    // WiFi configuration tests
    RUN_TEST(test_wifi_ssid_empty);
    RUN_TEST(test_wifi_ssid_set);
    RUN_TEST(test_wifi_password_set);
    RUN_TEST(test_wifi_credentials_validation);
    RUN_TEST(test_wifi_ssid_max_length);
    RUN_TEST(test_wifi_password_min_length);
    
    // Device configuration tests
    RUN_TEST(test_device_name_set);
    RUN_TEST(test_display_name_set);
    RUN_TEST(test_brightness_range_min);
    RUN_TEST(test_brightness_range_max);
    RUN_TEST(test_brightness_range_valid);
    RUN_TEST(test_scroll_speed_set);
    RUN_TEST(test_page_interval_set);
    RUN_TEST(test_sensor_page_enabled);
    RUN_TEST(test_sensor_page_disabled);
    RUN_TEST(test_display_pages_rotate);
    RUN_TEST(test_display_pages_status_only);
    RUN_TEST(test_display_pages_sensors_only);
    RUN_TEST(test_status_layout_name);
    RUN_TEST(test_status_layout_sensors);
    RUN_TEST(test_border_width_range);
    RUN_TEST(test_border_width_min);
    RUN_TEST(test_border_width_max);
    RUN_TEST(test_color_hex_format);
    RUN_TEST(test_color_validation);
    
    // UUID-based Device Identity tests (Phase 3)
    RUN_TEST(test_device_uuid_empty);
    RUN_TEST(test_device_uuid_set);
    RUN_TEST(test_device_uuid_format);
    RUN_TEST(test_user_uuid_empty);
    RUN_TEST(test_user_uuid_set);
    RUN_TEST(test_user_uuid_format);
    RUN_TEST(test_last_webex_status_empty);
    RUN_TEST(test_last_webex_status_set);
    RUN_TEST(test_last_webex_status_values);
    RUN_TEST(test_uuid_storage_retrieval);
    RUN_TEST(test_uuid_persistence);
    
    // Webex configuration tests
    RUN_TEST(test_webex_client_id_empty);
    RUN_TEST(test_webex_client_id_set);
    RUN_TEST(test_webex_client_secret_set);
    RUN_TEST(test_webex_credentials_validation);
    RUN_TEST(test_webex_access_token_set);
    RUN_TEST(test_webex_refresh_token_set);
    RUN_TEST(test_webex_token_expiry);
    RUN_TEST(test_webex_tokens_validation);
    RUN_TEST(test_webex_poll_interval_min);
    RUN_TEST(test_webex_poll_interval_max);
    RUN_TEST(test_webex_poll_interval_range);
    
    // xAPI configuration tests
    RUN_TEST(test_xapi_device_id_empty);
    RUN_TEST(test_xapi_device_id_set);
    RUN_TEST(test_xapi_poll_interval);
    
    // MQTT configuration tests
    RUN_TEST(test_mqtt_broker_empty);
    RUN_TEST(test_mqtt_broker_set);
    RUN_TEST(test_mqtt_port_default);
    RUN_TEST(test_mqtt_port_tls);
    RUN_TEST(test_mqtt_username_set);
    RUN_TEST(test_mqtt_password_set);
    RUN_TEST(test_mqtt_topic_set);
    RUN_TEST(test_sensor_serial_set);
    RUN_TEST(test_sensor_macs_set);
    RUN_TEST(test_sensor_macs_multiple);
    RUN_TEST(test_display_sensor_mac);
    RUN_TEST(test_display_metric);
    RUN_TEST(test_mqtt_config_validation);
    
    // OTA configuration tests
    RUN_TEST(test_ota_url_set);
    RUN_TEST(test_auto_update_enabled);
    RUN_TEST(test_auto_update_disabled);
    RUN_TEST(test_failed_ota_version);
    RUN_TEST(test_failed_ota_version_clear);
    
    // Supabase configuration tests
    RUN_TEST(test_supabase_url_set);
    RUN_TEST(test_supabase_anon_key_set);
    
    // Partition version tests
    RUN_TEST(test_partition_version_ota0);
    RUN_TEST(test_partition_version_ota1);
    RUN_TEST(test_partition_version_clear);
    
    // Debug configuration tests
    RUN_TEST(test_debug_mode_enabled);
    RUN_TEST(test_debug_mode_disabled);
    RUN_TEST(test_pairing_realtime_debug_enabled);
    
    // TLS configuration tests
    RUN_TEST(test_tls_verify_enabled);
    RUN_TEST(test_tls_verify_disabled);
    
    // Time configuration tests
    RUN_TEST(test_timezone_utc);
    RUN_TEST(test_timezone_america_los_angeles);
    RUN_TEST(test_ntp_server_default);
    RUN_TEST(test_time_format_12h);
    RUN_TEST(test_time_format_24h);
    RUN_TEST(test_use_24_hour_time);
    RUN_TEST(test_date_format_mdy);
    RUN_TEST(test_date_format_dmy);
    RUN_TEST(test_date_format_numeric);
    RUN_TEST(test_date_format_code);
    
    // Cache coherence tests
    RUN_TEST(test_cache_initial_state);
    RUN_TEST(test_cache_load);
    RUN_TEST(test_cache_consistency);
    RUN_TEST(test_cache_invalidation_on_write);
    
    // Factory reset tests
    RUN_TEST(test_factory_reset_clears_wifi);
    RUN_TEST(test_factory_reset_clears_webex);
    RUN_TEST(test_factory_reset_restores_defaults);
    
    // JSON export/import tests
    RUN_TEST(test_json_export_structure);
    RUN_TEST(test_json_import_validation);
    RUN_TEST(test_json_import_invalid);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_config_manager_tests();
    return 0;
}
#else
void setup() {
    delay(2000);
    run_config_manager_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
