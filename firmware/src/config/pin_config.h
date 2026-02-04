/**
 * @file pin_config.h
 * @brief HUB75 display pin configuration with presets
 * 
 * Provides configurable pin mappings for different HUB75 adapter boards.
 * Pins can be selected via preset or customized through the web UI.
 * 
 * Default presets:
 * - ESP32-S3: Seengreat adapter (current production pins)
 * - ESP32-S2: Adafruit RGB Matrix Shield
 * - ESP32: Generic HUB75 pinout
 */

#pragma once

#include <Arduino.h>
#include "../common/board_utils.h"

/**
 * @brief HUB75 pin configuration structure
 * 
 * All pins use int8_t to allow -1 for unused pins (e.g., E pin on 1/16 scan panels)
 */
struct PinConfig {
    // RGB data pins (active accent)
    int8_t r1;   // Upper half red
    int8_t g1;   // Upper half green
    int8_t b1;   // Upper half blue
    int8_t r2;   // Lower half red
    int8_t g2;   // Lower half green
    int8_t b2;   // Lower half blue
    
    // Row select pins (active accent)
    int8_t a;    // Row select A
    int8_t b;    // Row select B
    int8_t c;    // Row select C
    int8_t d;    // Row select D
    int8_t e;    // Row select E (-1 for 1/16 scan panels)
    
    // Control pins
    int8_t clk;  // Clock
    int8_t lat;  // Latch
    int8_t oe;   // Output enable
    
    /**
     * @brief Check if this is a valid pin configuration
     * @return true if all required pins are set (>= 0)
     */
    bool isValid() const {
        // E pin can be -1 for 1/16 scan panels
        return r1 >= 0 && g1 >= 0 && b1 >= 0 &&
               r2 >= 0 && g2 >= 0 && b2 >= 0 &&
               a >= 0 && b >= 0 && c >= 0 && d >= 0 &&
               clk >= 0 && lat >= 0 && oe >= 0;
    }
};

/**
 * @brief Pin preset identifiers
 */
enum class PinPreset : uint8_t {
    SEENGREAT = 0,      // Seengreat adapter (ESP32-S3 default)
    ADAFRUIT_SHIELD,    // Adafruit RGB Matrix Shield (ESP32-S2 default)
    GENERIC_HUB75,      // Generic HUB75 pinout (ESP32 default)
    CUSTOM,             // User-defined custom pins
    PRESET_COUNT
};

/**
 * @brief Get preset name as string
 */
inline const char* getPresetName(PinPreset preset) {
    switch (preset) {
        case PinPreset::SEENGREAT:       return "Seengreat Adapter";
        case PinPreset::ADAFRUIT_SHIELD: return "Adafruit RGB Matrix Shield";
        case PinPreset::GENERIC_HUB75:   return "Generic HUB75";
        case PinPreset::CUSTOM:          return "Custom";
        default:                         return "Unknown";
    }
}

// =============================================================================
// Pin Presets
// =============================================================================

/**
 * Seengreat adapter for ESP32-S3 (current production default)
 * This is the pinout used in the original firmware.
 */
constexpr PinConfig PINS_SEENGREAT = {
    .r1 = 37, .g1 = 6,  .b1 = 36,
    .r2 = 35, .g2 = 5,  .b2 = 0,
    .a  = 45, .b  = 1,  .c  = 48, .d = 2, .e = 4,
    .clk = 47, .lat = 38, .oe = 21
};

/**
 * Adafruit RGB Matrix Shield for Metro ESP32-S2
 * Based on Adafruit documentation for the RGB Matrix Shield.
 * https://learn.adafruit.com/rgb-led-matrices-matrix-panels-with-circuitpython
 */
constexpr PinConfig PINS_ADAFRUIT_SHIELD = {
    .r1 = 7,  .g1 = 8,  .b1 = 9,
    .r2 = 10, .g2 = 11, .b2 = 12,
    .a  = 17, .b  = 18, .c  = 1,  .d = 2, .e = -1,  // E=-1 for 1/16 scan (64x32)
    .clk = 13, .lat = 15, .oe = 14
};

/**
 * Generic HUB75 pinout for standard ESP32 DevKit
 * Common default pinout used by many tutorials and examples.
 */
constexpr PinConfig PINS_GENERIC_HUB75 = {
    .r1 = 25, .g1 = 26, .b1 = 27,
    .r2 = 14, .g2 = 12, .b2 = 13,
    .a  = 23, .b  = 19, .c  = 5,  .d = 17, .e = 32,
    .clk = 16, .lat = 4, .oe = 15
};

/**
 * @brief Get the preset pins for a given preset ID
 */
inline PinConfig getPinsForPreset(PinPreset preset) {
    switch (preset) {
        case PinPreset::SEENGREAT:       return PINS_SEENGREAT;
        case PinPreset::ADAFRUIT_SHIELD: return PINS_ADAFRUIT_SHIELD;
        case PinPreset::GENERIC_HUB75:   return PINS_GENERIC_HUB75;
        default:                         return PINS_GENERIC_HUB75;
    }
}

/**
 * @brief Get the default preset for the detected board type
 * 
 * This provides sensible defaults based on the chip model:
 * - ESP32-S3: Seengreat adapter (current production)
 * - ESP32-S2: Adafruit RGB Matrix Shield
 * - ESP32: Generic HUB75
 */
inline PinPreset getDefaultPresetForBoard() {
    String board = getBoardType();
    if (board == "esp32s3") return PinPreset::SEENGREAT;
    if (board == "esp32s2") return PinPreset::ADAFRUIT_SHIELD;
    return PinPreset::GENERIC_HUB75;
}

/**
 * @brief Get the default pins for the detected board type
 */
inline PinConfig getDefaultPinsForBoard() {
    return getPinsForPreset(getDefaultPresetForBoard());
}
