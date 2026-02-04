/**
 * @file board_utils.h
 * @brief Runtime board detection utilities
 * 
 * Provides runtime chip detection using ESP.getChipModel() with normalization
 * to standard board type strings (esp32s3, esp32s2, esp32).
 * 
 * This replaces scattered #ifdef ESP32_S3_BOARD blocks with a single utility.
 */

#pragma once

#include <Arduino.h>

#ifdef NATIVE_BUILD
// For native builds, use compile-time detection
inline String getBoardType() {
    #if defined(ESP32_S3_BOARD)
    return "esp32s3";
    #elif defined(ESP32_S2_BOARD)
    return "esp32s2";
    #else
    return "esp32";
    #endif
}
#else
// For ESP32 builds, use runtime detection
inline String getBoardType() {
    String model = ESP.getChipModel();  // Returns "ESP32-S3", "ESP32-S2", "ESP32", etc.
    model.toLowerCase();                 // "esp32-s3", "esp32-s2", "esp32"
    model.replace("-", "");              // "esp32s3", "esp32s2", "esp32"
    
    // Handle any unexpected chip models by extracting the base type
    if (model.startsWith("esp32s3")) return "esp32s3";
    if (model.startsWith("esp32s2")) return "esp32s2";
    if (model.startsWith("esp32c")) return "esp32";  // C3, C6 treated as base ESP32
    return "esp32";  // Default fallback
}
#endif

/**
 * @brief Get Improv WiFi ChipFamily enum for the detected board
 * @return ImprovTypes::ChipFamily enum value
 * 
 * Note: Requires ImprovWiFi library to be included before this header
 * if using the enum directly. Otherwise use getBoardType() string comparison.
 */
inline uint8_t getChipFamilyId() {
    String board = getBoardType();
    if (board == "esp32s3") return 4;  // CF_ESP32_S3
    if (board == "esp32s2") return 2;  // CF_ESP32_S2
    if (board == "esp32c3") return 5;  // CF_ESP32_C3
    return 1;  // CF_ESP32
}

/**
 * @brief Check if the current chip has PSRAM
 * @return true if PSRAM is available and usable
 */
inline bool hasPsram() {
    #ifdef NATIVE_BUILD
    return false;
    #else
    return ESP.getPsramSize() > 0;
    #endif
}

/**
 * @brief Get a human-readable chip description for logging
 * @return String like "ESP32-S3 (PSRAM)" or "ESP32-S2"
 */
inline String getChipDescription() {
    #ifdef NATIVE_BUILD
    return "Native Simulation";
    #else
    String desc = ESP.getChipModel();
    if (hasPsram()) {
        desc += " (PSRAM)";
    }
    return desc;
    #endif
}
