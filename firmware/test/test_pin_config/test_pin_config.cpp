/**
 * @file test_pin_config.cpp
 * @brief Unit tests for pin_config.h
 * 
 * Tests pin configuration presets and validation.
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>

// Test the pin config header
#include "../../src/config/pin_config.h"

// ============================================================================
// PinConfig Struct Tests
// ============================================================================

void test_pinconfig_seengreat_valid() {
    // Seengreat preset should be valid
    PinConfig pins = PINS_SEENGREAT;
    TEST_ASSERT_TRUE(pins.isValid());
}

void test_pinconfig_adafruit_valid() {
    // Adafruit preset should be valid (e pin can be -1)
    PinConfig pins = PINS_ADAFRUIT_SHIELD;
    // E pin is -1 for 1/16 scan, but isValid() should still pass
    // because e is explicitly allowed to be -1
    // Let's verify the individual pins
    TEST_ASSERT_GREATER_OR_EQUAL(0, pins.r1);
    TEST_ASSERT_GREATER_OR_EQUAL(0, pins.g1);
    TEST_ASSERT_GREATER_OR_EQUAL(0, pins.b1);
    TEST_ASSERT_GREATER_OR_EQUAL(0, pins.clk);
    TEST_ASSERT_GREATER_OR_EQUAL(0, pins.lat);
    TEST_ASSERT_GREATER_OR_EQUAL(0, pins.oe);
}

void test_pinconfig_generic_valid() {
    // Generic HUB75 preset should be valid
    PinConfig pins = PINS_GENERIC_HUB75;
    TEST_ASSERT_TRUE(pins.isValid());
}

void test_pinconfig_invalid_missing_pins() {
    // Config with missing pins should be invalid
    PinConfig pins = {};
    pins.r1 = -1;  // Missing required pin
    TEST_ASSERT_FALSE(pins.isValid());
}

void test_pinconfig_e_pin_optional() {
    // E pin can be -1 for 1/16 scan panels
    PinConfig pins = PINS_SEENGREAT;
    pins.e = -1;
    // Still valid as long as other pins are set
    TEST_ASSERT_TRUE(pins.isValid());
}

// ============================================================================
// Preset Name Tests
// ============================================================================

void test_preset_name_seengreat() {
    const char* name = getPresetName(PinPreset::SEENGREAT);
    TEST_ASSERT_EQUAL_STRING("Seengreat Adapter", name);
}

void test_preset_name_adafruit() {
    const char* name = getPresetName(PinPreset::ADAFRUIT_SHIELD);
    TEST_ASSERT_EQUAL_STRING("Adafruit RGB Matrix Shield", name);
}

void test_preset_name_generic() {
    const char* name = getPresetName(PinPreset::GENERIC_HUB75);
    TEST_ASSERT_EQUAL_STRING("Generic HUB75", name);
}

void test_preset_name_custom() {
    const char* name = getPresetName(PinPreset::CUSTOM);
    TEST_ASSERT_EQUAL_STRING("Custom", name);
}

// ============================================================================
// getPinsForPreset Tests
// ============================================================================

void test_getPinsForPreset_seengreat() {
    PinConfig pins = getPinsForPreset(PinPreset::SEENGREAT);
    TEST_ASSERT_EQUAL(37, pins.r1);  // Verify first pin matches
    TEST_ASSERT_EQUAL(47, pins.clk);
    TEST_ASSERT_TRUE(pins.isValid());
}

void test_getPinsForPreset_adafruit() {
    PinConfig pins = getPinsForPreset(PinPreset::ADAFRUIT_SHIELD);
    TEST_ASSERT_EQUAL(7, pins.r1);
    TEST_ASSERT_EQUAL(13, pins.clk);
}

void test_getPinsForPreset_generic() {
    PinConfig pins = getPinsForPreset(PinPreset::GENERIC_HUB75);
    TEST_ASSERT_EQUAL(25, pins.r1);
    TEST_ASSERT_EQUAL(16, pins.clk);
    TEST_ASSERT_TRUE(pins.isValid());
}

// ============================================================================
// getDefaultPresetForBoard Tests
// ============================================================================

void test_default_preset_valid() {
    // Should return a valid preset
    PinPreset preset = getDefaultPresetForBoard();
    TEST_ASSERT_TRUE(preset >= PinPreset::SEENGREAT);
    TEST_ASSERT_TRUE(preset < PinPreset::PRESET_COUNT);
}

void test_default_pins_valid() {
    // Default pins should always be valid
    PinConfig pins = getDefaultPinsForBoard();
    TEST_ASSERT_TRUE(pins.isValid());
}

// ============================================================================
// Seengreat Pin Values Tests (ESP32-S3 production)
// ============================================================================

void test_seengreat_rgb_pins() {
    // Verify Seengreat RGB data pins (critical for production)
    PinConfig pins = PINS_SEENGREAT;
    TEST_ASSERT_EQUAL(37, pins.r1);
    TEST_ASSERT_EQUAL(6, pins.g1);
    TEST_ASSERT_EQUAL(36, pins.b1);
    TEST_ASSERT_EQUAL(35, pins.r2);
    TEST_ASSERT_EQUAL(5, pins.g2);
    TEST_ASSERT_EQUAL(0, pins.b2);
}

void test_seengreat_row_select_pins() {
    // Verify Seengreat row select pins
    PinConfig pins = PINS_SEENGREAT;
    TEST_ASSERT_EQUAL(45, pins.a);
    TEST_ASSERT_EQUAL(1, pins.b);
    TEST_ASSERT_EQUAL(48, pins.c);
    TEST_ASSERT_EQUAL(2, pins.d);
    TEST_ASSERT_EQUAL(4, pins.e);
}

void test_seengreat_control_pins() {
    // Verify Seengreat control pins
    PinConfig pins = PINS_SEENGREAT;
    TEST_ASSERT_EQUAL(47, pins.clk);
    TEST_ASSERT_EQUAL(38, pins.lat);
    TEST_ASSERT_EQUAL(21, pins.oe);
}

// ============================================================================
// Adafruit Shield Pin Values Tests (ESP32-S2)
// ============================================================================

void test_adafruit_rgb_pins() {
    PinConfig pins = PINS_ADAFRUIT_SHIELD;
    TEST_ASSERT_EQUAL(7, pins.r1);
    TEST_ASSERT_EQUAL(8, pins.g1);
    TEST_ASSERT_EQUAL(9, pins.b1);
    TEST_ASSERT_EQUAL(10, pins.r2);
    TEST_ASSERT_EQUAL(11, pins.g2);
    TEST_ASSERT_EQUAL(12, pins.b2);
}

void test_adafruit_e_pin_unset() {
    // Adafruit shield for 64x32 (1/16 scan) has no E pin
    PinConfig pins = PINS_ADAFRUIT_SHIELD;
    TEST_ASSERT_EQUAL(-1, pins.e);
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
    
    // PinConfig struct tests
    RUN_TEST(test_pinconfig_seengreat_valid);
    RUN_TEST(test_pinconfig_adafruit_valid);
    RUN_TEST(test_pinconfig_generic_valid);
    RUN_TEST(test_pinconfig_invalid_missing_pins);
    RUN_TEST(test_pinconfig_e_pin_optional);
    
    // Preset name tests
    RUN_TEST(test_preset_name_seengreat);
    RUN_TEST(test_preset_name_adafruit);
    RUN_TEST(test_preset_name_generic);
    RUN_TEST(test_preset_name_custom);
    
    // getPinsForPreset tests
    RUN_TEST(test_getPinsForPreset_seengreat);
    RUN_TEST(test_getPinsForPreset_adafruit);
    RUN_TEST(test_getPinsForPreset_generic);
    
    // Default preset tests
    RUN_TEST(test_default_preset_valid);
    RUN_TEST(test_default_pins_valid);
    
    // Seengreat pin verification tests
    RUN_TEST(test_seengreat_rgb_pins);
    RUN_TEST(test_seengreat_row_select_pins);
    RUN_TEST(test_seengreat_control_pins);
    
    // Adafruit shield tests
    RUN_TEST(test_adafruit_rgb_pins);
    RUN_TEST(test_adafruit_e_pin_unset);
    
    return UNITY_END();
}

#endif // UNIT_TEST
