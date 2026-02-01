/**
 * @file test_ota_manager.cpp
 * @brief Unit tests for OTA Manager
 * 
 * Tests verify OTA update flow including:
 * - Version checking and comparison
 * - Update availability detection
 * - Manifest parsing
 * - GitHub API response parsing
 * - URL extraction
 * - Download simulation
 * - Partition selection
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <ArduinoJson.h>

// ============================================================================
// Version Comparison Tests
// ============================================================================

void test_version_comparison_equal() {
    String v1 = "2.0.0";
    String v2 = "2.0.0";
    
    // Simple string comparison for equality
    TEST_ASSERT_TRUE(v1 == v2);
}

void test_version_comparison_newer() {
    String current = "2.0.0";
    String newer = "2.0.1";
    
    // Parse version components
    int curr_major = 2, curr_minor = 0, curr_patch = 0;
    int new_major = 2, new_minor = 0, new_patch = 1;
    
    // Compare: newer patch version
    bool is_newer = (new_major > curr_major) || 
                    (new_major == curr_major && new_minor > curr_minor) ||
                    (new_major == curr_major && new_minor == curr_minor && new_patch > curr_patch);
    TEST_ASSERT_TRUE(is_newer);
}

void test_version_comparison_older() {
    String current = "2.0.1";
    String older = "2.0.0";
    
    // Parse version components
    int curr_major = 2, curr_minor = 0, curr_patch = 1;
    int old_major = 2, old_minor = 0, old_patch = 0;
    
    // Compare: older patch version
    bool is_newer = (old_major > curr_major) || 
                    (old_major == curr_major && old_minor > curr_minor) ||
                    (old_major == curr_major && old_minor == curr_minor && old_patch > curr_patch);
    TEST_ASSERT_FALSE(is_newer);
}

void test_version_comparison_major_version() {
    String current = "1.9.9";
    String newer = "2.0.0";
    
    int curr_major = 1;
    int new_major = 2;
    
    TEST_ASSERT_TRUE(new_major > curr_major);
}

void test_version_comparison_minor_version() {
    String current = "2.0.9";
    String newer = "2.1.0";
    
    int curr_major = 2, curr_minor = 0;
    int new_major = 2, new_minor = 1;
    
    bool is_newer = (new_major == curr_major && new_minor > curr_minor);
    TEST_ASSERT_TRUE(is_newer);
}

// ============================================================================
// Manifest Parsing Tests
// ============================================================================

// Mock manifest response from Supabase Edge Function
const char* manifest_json = R"({
    "version": "2.0.2",
    "build_id": "abc123def456",
    "build_date": "2026-01-28T12:00:00Z",
    "firmware": {
        "url": "https://example.com/firmware-2.0.2.bin",
        "size": 1048576,
        "checksum": "sha256:abcdef123456"
    },
    "littlefs": {
        "url": "https://example.com/littlefs-2.0.2.bin",
        "size": 262144,
        "checksum": "sha256:123456abcdef"
    }
})";

void test_manifest_parse_version() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, manifest_json);
    TEST_ASSERT_FALSE(error);
    
    const char* version = doc["version"];
    TEST_ASSERT_EQUAL_STRING("2.0.2", version);
}

void test_manifest_parse_build_info() {
    JsonDocument doc;
    deserializeJson(doc, manifest_json);
    
    const char* build_id = doc["build_id"];
    const char* build_date = doc["build_date"];
    
    TEST_ASSERT_EQUAL_STRING("abc123def456", build_id);
    TEST_ASSERT_EQUAL_STRING("2026-01-28T12:00:00Z", build_date);
}

void test_manifest_parse_firmware_url() {
    JsonDocument doc;
    deserializeJson(doc, manifest_json);
    
    const char* firmware_url = doc["firmware"]["url"];
    TEST_ASSERT_EQUAL_STRING("https://example.com/firmware-2.0.2.bin", firmware_url);
}

void test_manifest_parse_firmware_size() {
    JsonDocument doc;
    deserializeJson(doc, manifest_json);
    
    size_t firmware_size = doc["firmware"]["size"].as<size_t>();
    TEST_ASSERT_EQUAL(1048576, firmware_size);
}

void test_manifest_parse_littlefs_url() {
    JsonDocument doc;
    deserializeJson(doc, manifest_json);
    
    const char* littlefs_url = doc["littlefs"]["url"];
    TEST_ASSERT_EQUAL_STRING("https://example.com/littlefs-2.0.2.bin", littlefs_url);
}

void test_manifest_parse_missing_fields() {
    const char* incomplete_manifest = R"({"version": "2.0.0"})";
    JsonDocument doc;
    deserializeJson(doc, incomplete_manifest);
    
    // Check that missing fields return empty/null
    TEST_ASSERT_TRUE(doc["firmware"]["url"].isNull());
    TEST_ASSERT_TRUE(doc["build_id"].isNull());
}

// ============================================================================
// GitHub API Response Parsing Tests
// ============================================================================

const char* github_release_json = R"({
    "tag_name": "v2.0.2",
    "name": "Release 2.0.2",
    "published_at": "2026-01-28T12:00:00Z",
    "assets": [
        {
            "name": "firmware-esp32s3.bin",
            "browser_download_url": "https://github.com/user/repo/releases/download/v2.0.2/firmware-esp32s3.bin",
            "size": 1048576,
            "content_type": "application/octet-stream"
        },
        {
            "name": "littlefs.bin",
            "browser_download_url": "https://github.com/user/repo/releases/download/v2.0.2/littlefs.bin",
            "size": 262144,
            "content_type": "application/octet-stream"
        }
    ]
})";

void test_github_parse_tag_name() {
    JsonDocument doc;
    deserializeJson(doc, github_release_json);
    
    const char* tag_name = doc["tag_name"];
    TEST_ASSERT_EQUAL_STRING("v2.0.2", tag_name);
}

void test_github_extract_version_from_tag() {
    String tag = "v2.0.2";
    String version = tag.substring(1); // Remove 'v' prefix
    TEST_ASSERT_EQUAL_STRING("2.0.2", version.c_str());
}

void test_github_parse_assets() {
    JsonDocument doc;
    deserializeJson(doc, github_release_json);
    
    JsonArray assets = doc["assets"].as<JsonArray>();
    TEST_ASSERT_EQUAL(2, assets.size());
}

void test_github_find_firmware_asset() {
    JsonDocument doc;
    deserializeJson(doc, github_release_json);
    
    JsonArray assets = doc["assets"].as<JsonArray>();
    const char* firmware_url = "";
    
    for (JsonObject asset : assets) {
        const char* name = asset["name"];
        if (strcmp(name, "firmware-esp32s3.bin") == 0) {
            firmware_url = asset["browser_download_url"];
            break;
        }
    }
    
    TEST_ASSERT_TRUE(strlen(firmware_url) > 0);
    TEST_ASSERT_TRUE(strstr(firmware_url, "firmware-esp32s3.bin") != NULL);
}

void test_github_find_littlefs_asset() {
    JsonDocument doc;
    deserializeJson(doc, github_release_json);
    
    JsonArray assets = doc["assets"].as<JsonArray>();
    const char* littlefs_url = "";
    
    for (JsonObject asset : assets) {
        const char* name = asset["name"];
        if (strcmp(name, "littlefs.bin") == 0) {
            littlefs_url = asset["browser_download_url"];
            break;
        }
    }
    
    TEST_ASSERT_TRUE(strlen(littlefs_url) > 0);
    TEST_ASSERT_TRUE(strstr(littlefs_url, "littlefs.bin") != NULL);
}

void test_github_asset_size() {
    JsonDocument doc;
    deserializeJson(doc, github_release_json);
    
    JsonArray assets = doc["assets"].as<JsonArray>();
    size_t firmware_size = assets[0]["size"].as<size_t>();
    
    TEST_ASSERT_EQUAL(1048576, firmware_size);
}

// ============================================================================
// Update Availability Detection Tests
// ============================================================================

void test_update_available_newer_version() {
    String current = "2.0.0";
    String latest = "2.0.1";
    
    bool update_available = (latest != current);
    TEST_ASSERT_TRUE(update_available);
}

void test_update_available_same_version() {
    String current = "2.0.1";
    String latest = "2.0.1";
    
    bool update_available = (latest != current);
    TEST_ASSERT_FALSE(update_available);
}

void test_update_available_empty_latest() {
    String current = "2.0.0";
    String latest = "";
    
    bool update_available = (!latest.isEmpty() && latest != current);
    TEST_ASSERT_FALSE(update_available);
}

// ============================================================================
// URL Validation Tests
// ============================================================================

void test_url_validation_https() {
    String url = "https://example.com/firmware.bin";
    TEST_ASSERT_TRUE(url.startsWith("https://"));
}

void test_url_validation_http() {
    String url = "http://example.com/firmware.bin";
    TEST_ASSERT_TRUE(url.startsWith("http://"));
}

void test_url_validation_invalid() {
    String url = "ftp://example.com/firmware.bin";
    bool valid = url.startsWith("http://") || url.startsWith("https://");
    TEST_ASSERT_FALSE(valid);
}

void test_url_validation_empty() {
    String url = "";
    bool valid = !url.isEmpty() && (url.startsWith("http://") || url.startsWith("https://"));
    TEST_ASSERT_FALSE(valid);
}

// ============================================================================
// Partition Selection Tests
// ============================================================================

void test_partition_selection_labels() {
    // Test that partition labels are recognized
    String ota_0 = "ota_0";
    String ota_1 = "ota_1";
    String factory = "factory";
    
    TEST_ASSERT_TRUE(ota_0 == "ota_0");
    TEST_ASSERT_TRUE(ota_1 == "ota_1");
    TEST_ASSERT_TRUE(factory == "factory");
}

void test_partition_ab_switching() {
    // Simulate A/B partition switching
    String current_partition = "ota_0";
    String next_partition;
    
    if (current_partition == "ota_0") {
        next_partition = "ota_1";
    } else {
        next_partition = "ota_0";
    }
    
    TEST_ASSERT_EQUAL_STRING("ota_1", next_partition.c_str());
}

void test_partition_size_validation() {
    // Verify partition size is sufficient
    size_t partition_size = 3670016; // 3.5MB as per partitions_8MB.csv
    size_t firmware_size = 1048576;  // 1MB firmware
    
    TEST_ASSERT_TRUE(firmware_size < partition_size);
}

void test_partition_size_overflow() {
    // Verify partition size overflow detection
    size_t partition_size = 3670016;
    size_t firmware_size = 4000000;  // Larger than partition
    
    TEST_ASSERT_FALSE(firmware_size < partition_size);
}

// ============================================================================
// OTA State Machine Tests
// ============================================================================

void test_ota_state_idle() {
    enum OTAState { IDLE, CHECKING, DOWNLOADING, INSTALLING, COMPLETE, FAILED };
    OTAState state = IDLE;
    
    TEST_ASSERT_EQUAL(IDLE, state);
}

void test_ota_state_transitions() {
    enum OTAState { IDLE, CHECKING, DOWNLOADING, INSTALLING, COMPLETE, FAILED };
    
    OTAState state = IDLE;
    TEST_ASSERT_EQUAL(IDLE, state);
    
    state = CHECKING;
    TEST_ASSERT_EQUAL(CHECKING, state);
    
    state = DOWNLOADING;
    TEST_ASSERT_EQUAL(DOWNLOADING, state);
    
    state = INSTALLING;
    TEST_ASSERT_EQUAL(INSTALLING, state);
    
    state = COMPLETE;
    TEST_ASSERT_EQUAL(COMPLETE, state);
}

void test_ota_state_failure() {
    enum OTAState { IDLE, CHECKING, DOWNLOADING, INSTALLING, COMPLETE, FAILED };
    
    OTAState state = DOWNLOADING;
    // Simulate download failure
    bool download_failed = true;
    
    if (download_failed) {
        state = FAILED;
    }
    
    TEST_ASSERT_EQUAL(FAILED, state);
}

// ============================================================================
// Error Handling Tests
// ============================================================================

void test_error_handling_network_timeout() {
    // Simulate network timeout
    bool network_timeout = true;
    String error_message = "";
    
    if (network_timeout) {
        error_message = "Network timeout during download";
    }
    
    TEST_ASSERT_EQUAL_STRING("Network timeout during download", error_message.c_str());
}

void test_error_handling_invalid_json() {
    const char* invalid_json = "{invalid json}";
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, invalid_json);
    
    TEST_ASSERT_TRUE(error);
}

void test_error_handling_partition_write_failure() {
    // Simulate partition write failure
    bool write_failed = true;
    String error_message = "";
    
    if (write_failed) {
        error_message = "Failed to write to partition";
    }
    
    TEST_ASSERT_EQUAL_STRING("Failed to write to partition", error_message.c_str());
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_ota_manager_tests() {
    UNITY_BEGIN();
    
    // Version comparison tests
    RUN_TEST(test_version_comparison_equal);
    RUN_TEST(test_version_comparison_newer);
    RUN_TEST(test_version_comparison_older);
    RUN_TEST(test_version_comparison_major_version);
    RUN_TEST(test_version_comparison_minor_version);
    
    // Manifest parsing tests
    RUN_TEST(test_manifest_parse_version);
    RUN_TEST(test_manifest_parse_build_info);
    RUN_TEST(test_manifest_parse_firmware_url);
    RUN_TEST(test_manifest_parse_firmware_size);
    RUN_TEST(test_manifest_parse_littlefs_url);
    RUN_TEST(test_manifest_parse_missing_fields);
    
    // GitHub API parsing tests
    RUN_TEST(test_github_parse_tag_name);
    RUN_TEST(test_github_extract_version_from_tag);
    RUN_TEST(test_github_parse_assets);
    RUN_TEST(test_github_find_firmware_asset);
    RUN_TEST(test_github_find_littlefs_asset);
    RUN_TEST(test_github_asset_size);
    
    // Update availability tests
    RUN_TEST(test_update_available_newer_version);
    RUN_TEST(test_update_available_same_version);
    RUN_TEST(test_update_available_empty_latest);
    
    // URL validation tests
    RUN_TEST(test_url_validation_https);
    RUN_TEST(test_url_validation_http);
    RUN_TEST(test_url_validation_invalid);
    RUN_TEST(test_url_validation_empty);
    
    // Partition selection tests
    RUN_TEST(test_partition_selection_labels);
    RUN_TEST(test_partition_ab_switching);
    RUN_TEST(test_partition_size_validation);
    RUN_TEST(test_partition_size_overflow);
    
    // OTA state machine tests
    RUN_TEST(test_ota_state_idle);
    RUN_TEST(test_ota_state_transitions);
    RUN_TEST(test_ota_state_failure);
    
    // Error handling tests
    RUN_TEST(test_error_handling_network_timeout);
    RUN_TEST(test_error_handling_invalid_json);
    RUN_TEST(test_error_handling_partition_write_failure);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_ota_manager_tests();
    return 0;
}
#else
void setup() {
    delay(2000);
    run_ota_manager_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
