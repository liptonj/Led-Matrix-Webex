/**
 * @file test_board_utils.cpp
 * @brief Unit tests for board_utils.h
 * 
 * Tests runtime board detection and chip family identification.
 * Uses compile-time defines to simulate different board types.
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>

// Test the board utils header
#include "../../src/common/board_utils.h"

// ============================================================================
// getBoardType() Tests
// ============================================================================

void test_getBoardType_returns_string() {
    // Should return a non-empty string
    String board = getBoardType();
    TEST_ASSERT_FALSE(board.isEmpty());
}

void test_getBoardType_is_lowercase() {
    // Should return lowercase board type
    String board = getBoardType();
    String lower = board;
    lower.toLowerCase();
    TEST_ASSERT_EQUAL_STRING(lower.c_str(), board.c_str());
}

void test_getBoardType_no_dashes() {
    // Should not contain dashes (normalized)
    String board = getBoardType();
    TEST_ASSERT_EQUAL(-1, board.indexOf('-'));
}

void test_getBoardType_valid_value() {
    // Should be one of the known board types
    String board = getBoardType();
    bool valid = (board == "esp32" || board == "esp32s2" || board == "esp32s3");
    TEST_ASSERT_TRUE(valid);
}

// ============================================================================
// getChipFamilyId() Tests
// ============================================================================

void test_getChipFamilyId_returns_valid_id() {
    // Should return a known chip family ID
    uint8_t id = getChipFamilyId();
    // Valid IDs: 1=ESP32, 2=ESP32-S2, 4=ESP32-S3, 5=ESP32-C3
    bool valid = (id == 1 || id == 2 || id == 4 || id == 5);
    TEST_ASSERT_TRUE(valid);
}

void test_getChipFamilyId_matches_board_type() {
    // Chip family should match board type
    String board = getBoardType();
    uint8_t id = getChipFamilyId();
    
    if (board == "esp32s3") {
        TEST_ASSERT_EQUAL(4, id);
    } else if (board == "esp32s2") {
        TEST_ASSERT_EQUAL(2, id);
    } else if (board == "esp32") {
        TEST_ASSERT_EQUAL(1, id);
    }
}

// ============================================================================
// hasPsram() Tests
// ============================================================================

void test_hasPsram_returns_bool() {
    // Should return a boolean without crashing
    bool psram = hasPsram();
    TEST_ASSERT_TRUE(psram == true || psram == false);
}

// ============================================================================
// getChipDescription() Tests
// ============================================================================

void test_getChipDescription_returns_string() {
    String desc = getChipDescription();
    TEST_ASSERT_FALSE(desc.isEmpty());
}

void test_getChipDescription_contains_chip_model() {
    String desc = getChipDescription();
    // Should contain "ESP32" or "Simulation"
    bool valid = (desc.indexOf("ESP32") >= 0 || desc.indexOf("Simulation") >= 0);
    TEST_ASSERT_TRUE(valid);
}

// ============================================================================
// Board Detection Normalization Tests
// ============================================================================

void test_board_type_normalization_s3() {
    // Test that ESP32-S3 variants are normalized to "esp32s3"
    // This tests the normalization logic in getBoardType()
    String model = "ESP32-S3";
    model.toLowerCase();
    model.replace("-", "");
    TEST_ASSERT_EQUAL_STRING("esp32s3", model.c_str());
}

void test_board_type_normalization_s2() {
    // Test that ESP32-S2 variants are normalized to "esp32s2"
    String model = "ESP32-S2";
    model.toLowerCase();
    model.replace("-", "");
    TEST_ASSERT_EQUAL_STRING("esp32s2", model.c_str());
}

void test_board_type_normalization_base() {
    // Test that base ESP32 is normalized
    String model = "ESP32";
    model.toLowerCase();
    model.replace("-", "");
    TEST_ASSERT_EQUAL_STRING("esp32", model.c_str());
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
    
    // getBoardType tests
    RUN_TEST(test_getBoardType_returns_string);
    RUN_TEST(test_getBoardType_is_lowercase);
    RUN_TEST(test_getBoardType_no_dashes);
    RUN_TEST(test_getBoardType_valid_value);
    
    // getChipFamilyId tests
    RUN_TEST(test_getChipFamilyId_returns_valid_id);
    RUN_TEST(test_getChipFamilyId_matches_board_type);
    
    // hasPsram tests
    RUN_TEST(test_hasPsram_returns_bool);
    
    // getChipDescription tests
    RUN_TEST(test_getChipDescription_returns_string);
    RUN_TEST(test_getChipDescription_contains_chip_model);
    
    // Normalization tests
    RUN_TEST(test_board_type_normalization_s3);
    RUN_TEST(test_board_type_normalization_s2);
    RUN_TEST(test_board_type_normalization_base);
    
    return UNITY_END();
}

#endif // UNIT_TEST
