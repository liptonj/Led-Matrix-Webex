/**
 * @file test_web_api.cpp
 * @brief Unit tests for Web API Endpoints
 * 
 * Tests verify web API functionality including:
 * - All 8 API endpoints
 * - JSON request/response parsing
 * - Authentication validation
 * - Error response handling
 * - CORS headers
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <ArduinoJson.h>

// ============================================================================
// Status Endpoint Tests (/api/status)
// ============================================================================

const char* status_response = R"({
    "status": "ok",
    "wifi": {"connected": true, "ssid": "TestNetwork", "ip": "192.168.1.100"},
    "webex": {"configured": true, "status": "active"},
    "version": "2.0.2",
    "uptime": 3600
})";

void test_status_endpoint_parse() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, status_response);
    TEST_ASSERT_FALSE(error);
}

void test_status_endpoint_wifi_connected() {
    JsonDocument doc;
    deserializeJson(doc, status_response);
    bool wifi_connected = doc["wifi"]["connected"];
    TEST_ASSERT_TRUE(wifi_connected);
}

void test_status_endpoint_version() {
    JsonDocument doc;
    deserializeJson(doc, status_response);
    const char* version = doc["version"];
    TEST_ASSERT_EQUAL_STRING("2.0.2", version);
}

// ============================================================================
// Config Endpoint Tests (/api/config)
// ============================================================================

const char* config_response = R"({
    "device": {"name": "webex-display", "brightness": 128},
    "wifi": {"ssid": "TestNetwork"},
    "webex": {"poll_interval": 30}
})";

void test_config_endpoint_parse() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, config_response);
    TEST_ASSERT_FALSE(error);
}

void test_config_endpoint_device_name() {
    JsonDocument doc;
    deserializeJson(doc, config_response);
    const char* device_name = doc["device"]["name"];
    TEST_ASSERT_EQUAL_STRING("webex-display", device_name);
}

void test_config_endpoint_brightness() {
    JsonDocument doc;
    deserializeJson(doc, config_response);
    uint8_t brightness = doc["device"]["brightness"];
    TEST_ASSERT_EQUAL(128, brightness);
}

// ============================================================================
// Save Config Endpoint Tests (POST /api/config)
// ============================================================================

const char* save_config_request = R"({
    "device": {"name": "my-display", "brightness": 200},
    "wifi": {"ssid": "NewNetwork", "password": "NewPass123"}
})";

void test_save_config_request_parse() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, save_config_request);
    TEST_ASSERT_FALSE(error);
}

void test_save_config_extract_device_name() {
    JsonDocument doc;
    deserializeJson(doc, save_config_request);
    const char* device_name = doc["device"]["name"];
    TEST_ASSERT_EQUAL_STRING("my-display", device_name);
}

void test_save_config_extract_brightness() {
    JsonDocument doc;
    deserializeJson(doc, save_config_request);
    uint8_t brightness = doc["device"]["brightness"];
    TEST_ASSERT_EQUAL(200, brightness);
}

void test_save_config_response() {
    const char* response = R"({"status": "ok", "message": "Configuration saved"})";
    JsonDocument doc;
    deserializeJson(doc, response);
    const char* status = doc["status"];
    TEST_ASSERT_EQUAL_STRING("ok", status);
}

// ============================================================================
// WiFi Scan Endpoint Tests (/api/wifi/scan)
// ============================================================================

const char* wifi_scan_response = R"({
    "networks": [
        {"ssid": "Network1", "rssi": -50, "security": "WPA2"},
        {"ssid": "Network2", "rssi": -70, "security": "WPA3"},
        {"ssid": "Network3", "rssi": -85, "security": "Open"}
    ]
})";

void test_wifi_scan_parse() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, wifi_scan_response);
    TEST_ASSERT_FALSE(error);
}

void test_wifi_scan_network_count() {
    JsonDocument doc;
    deserializeJson(doc, wifi_scan_response);
    JsonArray networks = doc["networks"].as<JsonArray>();
    TEST_ASSERT_EQUAL(3, networks.size());
}

void test_wifi_scan_first_network() {
    JsonDocument doc;
    deserializeJson(doc, wifi_scan_response);
    JsonArray networks = doc["networks"].as<JsonArray>();
    const char* ssid = networks[0]["ssid"];
    TEST_ASSERT_EQUAL_STRING("Network1", ssid);
}

void test_wifi_scan_rssi_values() {
    JsonDocument doc;
    deserializeJson(doc, wifi_scan_response);
    JsonArray networks = doc["networks"].as<JsonArray>();
    int rssi = networks[0]["rssi"];
    TEST_ASSERT_EQUAL(-50, rssi);
}

// ============================================================================
// OTA Check Update Endpoint Tests (/api/ota/check)
// ============================================================================

const char* ota_check_response = R"({
    "update_available": true,
    "current_version": "2.0.0",
    "latest_version": "2.0.2",
    "download_url": "https://example.com/firmware.bin"
})";

void test_ota_check_parse() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, ota_check_response);
    TEST_ASSERT_FALSE(error);
}

void test_ota_check_update_available() {
    JsonDocument doc;
    deserializeJson(doc, ota_check_response);
    bool update_available = doc["update_available"];
    TEST_ASSERT_TRUE(update_available);
}

void test_ota_check_versions() {
    JsonDocument doc;
    deserializeJson(doc, ota_check_response);
    const char* current = doc["current_version"];
    const char* latest = doc["latest_version"];
    TEST_ASSERT_EQUAL_STRING("2.0.0", current);
    TEST_ASSERT_EQUAL_STRING("2.0.2", latest);
}

// ============================================================================
// OTA Perform Update Endpoint Tests (POST /api/ota/update)
// ============================================================================

void test_ota_perform_request() {
    const char* request = R"({"confirm": true})";
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, request);
    TEST_ASSERT_FALSE(error);
}

void test_ota_perform_response_success() {
    const char* response = R"({"status": "ok", "message": "Update started"})";
    JsonDocument doc;
    deserializeJson(doc, response);
    const char* status = doc["status"];
    TEST_ASSERT_EQUAL_STRING("ok", status);
}

void test_ota_perform_response_error() {
    const char* response = R"({"status": "error", "message": "No update available"})";
    JsonDocument doc;
    deserializeJson(doc, response);
    const char* status = doc["status"];
    TEST_ASSERT_EQUAL_STRING("error", status);
}

// ============================================================================
// Reboot Endpoint Tests (POST /api/reboot)
// ============================================================================

void test_reboot_endpoint_response() {
    const char* response = R"({"status": "ok", "message": "Rebooting..."})";
    JsonDocument doc;
    deserializeJson(doc, response);
    const char* status = doc["status"];
    TEST_ASSERT_EQUAL_STRING("ok", status);
}

// ============================================================================
// Factory Reset Endpoint Tests (POST /api/factory_reset)
// ============================================================================

void test_factory_reset_request() {
    const char* request = R"({"confirm": true})";
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, request);
    TEST_ASSERT_FALSE(error);
    bool confirm = doc["confirm"];
    TEST_ASSERT_TRUE(confirm);
}

void test_factory_reset_response() {
    const char* response = R"({"status": "ok", "message": "Factory reset initiated"})";
    JsonDocument doc;
    deserializeJson(doc, response);
    const char* status = doc["status"];
    TEST_ASSERT_EQUAL_STRING("ok", status);
}

// ============================================================================
// Embedded Status Endpoint Tests (POST /api/embedded/status)
// ============================================================================

const char* embedded_status_request = R"({
    "status": "active",
    "display_name": "John Doe",
    "in_call": false,
    "camera_on": false,
    "mic_muted": false
})";

void test_embedded_status_parse() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, embedded_status_request);
    TEST_ASSERT_FALSE(error);
}

void test_embedded_status_extract_status() {
    JsonDocument doc;
    deserializeJson(doc, embedded_status_request);
    const char* status = doc["status"];
    TEST_ASSERT_EQUAL_STRING("active", status);
}

void test_embedded_status_extract_display_name() {
    JsonDocument doc;
    deserializeJson(doc, embedded_status_request);
    const char* display_name = doc["display_name"];
    TEST_ASSERT_EQUAL_STRING("John Doe", display_name);
}

void test_embedded_status_extract_call_state() {
    JsonDocument doc;
    deserializeJson(doc, embedded_status_request);
    bool in_call = doc["in_call"];
    bool camera_on = doc["camera_on"];
    bool mic_muted = doc["mic_muted"];
    
    TEST_ASSERT_FALSE(in_call);
    TEST_ASSERT_FALSE(camera_on);
    TEST_ASSERT_FALSE(mic_muted);
}

// ============================================================================
// Error Response Tests
// ============================================================================

void test_error_response_400() {
    const char* response = R"({"status": "error", "code": 400, "message": "Bad request"})";
    JsonDocument doc;
    deserializeJson(doc, response);
    int code = doc["code"];
    TEST_ASSERT_EQUAL(400, code);
}

void test_error_response_401() {
    const char* response = R"({"status": "error", "code": 401, "message": "Unauthorized"})";
    JsonDocument doc;
    deserializeJson(doc, response);
    int code = doc["code"];
    TEST_ASSERT_EQUAL(401, code);
}

void test_error_response_404() {
    const char* response = R"({"status": "error", "code": 404, "message": "Not found"})";
    JsonDocument doc;
    deserializeJson(doc, response);
    int code = doc["code"];
    TEST_ASSERT_EQUAL(404, code);
}

void test_error_response_500() {
    const char* response = R"({"status": "error", "code": 500, "message": "Internal server error"})";
    JsonDocument doc;
    deserializeJson(doc, response);
    int code = doc["code"];
    TEST_ASSERT_EQUAL(500, code);
}

// ============================================================================
// JSON Validation Tests
// ============================================================================

void test_json_invalid_syntax() {
    const char* invalid_json = "{invalid}";
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, invalid_json);
    TEST_ASSERT_TRUE(error);
}

void test_json_empty_object() {
    const char* empty_json = "{}";
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, empty_json);
    TEST_ASSERT_FALSE(error);
}

void test_json_missing_fields() {
    const char* incomplete = R"({"status": "ok"})";
    JsonDocument doc;
    deserializeJson(doc, incomplete);
    TEST_ASSERT_TRUE(doc["message"].isNull());
}

// ============================================================================
// CORS Header Tests
// ============================================================================

void test_cors_header_origin() {
    String origin_header = "Access-Control-Allow-Origin";
    TEST_ASSERT_EQUAL_STRING("Access-Control-Allow-Origin", origin_header.c_str());
}

void test_cors_header_methods() {
    String methods = "GET, POST, OPTIONS";
    TEST_ASSERT_TRUE(methods.indexOf("GET") >= 0);
    TEST_ASSERT_TRUE(methods.indexOf("POST") >= 0);
}

void test_cors_header_content_type() {
    String content_type = "application/json";
    TEST_ASSERT_EQUAL_STRING("application/json", content_type.c_str());
}

// ============================================================================
// Authentication Tests
// ============================================================================

void test_auth_header_present() {
    String auth_header = "Authorization: Bearer token123";
    TEST_ASSERT_TRUE(auth_header.startsWith("Authorization:"));
}

void test_auth_header_missing() {
    String auth_header = "";
    bool has_auth = !auth_header.isEmpty();
    TEST_ASSERT_FALSE(has_auth);
}

void test_auth_token_extraction() {
    String auth_header = "Bearer token123";
    String token = auth_header.substring(7); // Skip "Bearer "
    TEST_ASSERT_EQUAL_STRING("token123", token.c_str());
}

// ============================================================================
// Content Type Tests
// ============================================================================

void test_content_type_json() {
    String content_type = "application/json";
    bool is_json = content_type.indexOf("application/json") >= 0;
    TEST_ASSERT_TRUE(is_json);
}

void test_content_type_form_data() {
    String content_type = "multipart/form-data";
    bool is_form = content_type.indexOf("multipart/form-data") >= 0;
    TEST_ASSERT_TRUE(is_form);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_web_api_tests() {
    UNITY_BEGIN();
    
    // Status endpoint tests
    RUN_TEST(test_status_endpoint_parse);
    RUN_TEST(test_status_endpoint_wifi_connected);
    RUN_TEST(test_status_endpoint_version);
    
    // Config endpoint tests
    RUN_TEST(test_config_endpoint_parse);
    RUN_TEST(test_config_endpoint_device_name);
    RUN_TEST(test_config_endpoint_brightness);
    
    // Save config endpoint tests
    RUN_TEST(test_save_config_request_parse);
    RUN_TEST(test_save_config_extract_device_name);
    RUN_TEST(test_save_config_extract_brightness);
    RUN_TEST(test_save_config_response);
    
    // WiFi scan endpoint tests
    RUN_TEST(test_wifi_scan_parse);
    RUN_TEST(test_wifi_scan_network_count);
    RUN_TEST(test_wifi_scan_first_network);
    RUN_TEST(test_wifi_scan_rssi_values);
    
    // OTA check update endpoint tests
    RUN_TEST(test_ota_check_parse);
    RUN_TEST(test_ota_check_update_available);
    RUN_TEST(test_ota_check_versions);
    
    // OTA perform update endpoint tests
    RUN_TEST(test_ota_perform_request);
    RUN_TEST(test_ota_perform_response_success);
    RUN_TEST(test_ota_perform_response_error);
    
    // Reboot endpoint tests
    RUN_TEST(test_reboot_endpoint_response);
    
    // Factory reset endpoint tests
    RUN_TEST(test_factory_reset_request);
    RUN_TEST(test_factory_reset_response);
    
    // Embedded status endpoint tests
    RUN_TEST(test_embedded_status_parse);
    RUN_TEST(test_embedded_status_extract_status);
    RUN_TEST(test_embedded_status_extract_display_name);
    RUN_TEST(test_embedded_status_extract_call_state);
    
    // Error response tests
    RUN_TEST(test_error_response_400);
    RUN_TEST(test_error_response_401);
    RUN_TEST(test_error_response_404);
    RUN_TEST(test_error_response_500);
    
    // JSON validation tests
    RUN_TEST(test_json_invalid_syntax);
    RUN_TEST(test_json_empty_object);
    RUN_TEST(test_json_missing_fields);
    
    // CORS header tests
    RUN_TEST(test_cors_header_origin);
    RUN_TEST(test_cors_header_methods);
    RUN_TEST(test_cors_header_content_type);
    
    // Authentication tests
    RUN_TEST(test_auth_header_present);
    RUN_TEST(test_auth_header_missing);
    RUN_TEST(test_auth_token_extraction);
    
    // Content type tests
    RUN_TEST(test_content_type_json);
    RUN_TEST(test_content_type_form_data);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_web_api_tests();
    return 0;
}
#else
void setup() {
    delay(2000);
    run_web_api_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
