/**
 * @file icons.h
 * @brief Icon bitmaps for the LED matrix display
 * 
 * Icons are stored as 1-bit bitmaps where 1 = pixel on, 0 = pixel off.
 */

#ifndef ICONS_H
#define ICONS_H

#include <Arduino.h>

// Status circle icon (8x8)
// Filled circle representing presence status
const uint8_t STATUS_ICON[] PROGMEM = {
    0, 0, 1, 1, 1, 1, 0, 0,
    0, 1, 1, 1, 1, 1, 1, 0,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1,
    0, 1, 1, 1, 1, 1, 1, 0,
    0, 0, 1, 1, 1, 1, 0, 0,
};

// Camera icon (8x5)
const uint8_t CAMERA_ICON[] PROGMEM = {
    1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 0,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1,
};

// Microphone icon (5x5)
const uint8_t MIC_ICON[] PROGMEM = {
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    1, 0, 1, 0, 1,
    0, 1, 1, 1, 0,
};

// Call/Phone icon (8x5)
const uint8_t CALL_ICON[] PROGMEM = {
    1, 1, 0, 0, 0, 0, 1, 1,
    1, 1, 1, 0, 0, 1, 1, 1,
    0, 1, 1, 1, 1, 1, 1, 0,
    0, 0, 1, 1, 1, 1, 0, 0,
    0, 0, 0, 1, 1, 0, 0, 0,
};

// WiFi icon (7x5)
const uint8_t WIFI_ICON[] PROGMEM = {
    0, 0, 1, 1, 1, 0, 0,
    0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 1, 0, 0,
    0, 0, 0, 1, 0, 0, 0,
};

// Temperature icon (5x7)
const uint8_t TEMP_ICON[] PROGMEM = {
    0, 0, 1, 0, 0,
    0, 1, 0, 1, 0,
    0, 1, 0, 1, 0,
    0, 1, 0, 1, 0,
    1, 1, 1, 1, 1,
    1, 1, 1, 1, 1,
    0, 1, 1, 1, 0,
};

// Humidity/Water drop icon (5x7)
const uint8_t HUMIDITY_ICON[] PROGMEM = {
    0, 0, 1, 0, 0,
    0, 0, 1, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    1, 1, 1, 1, 1,
    1, 1, 1, 1, 1,
    0, 1, 1, 1, 0,
};

// Door icon (5x7)
const uint8_t DOOR_ICON[] PROGMEM = {
    1, 1, 1, 1, 1,
    1, 0, 0, 0, 1,
    1, 0, 0, 0, 1,
    1, 0, 1, 0, 1,
    1, 0, 0, 0, 1,
    1, 0, 0, 0, 1,
    1, 1, 1, 1, 1,
};

// Air quality/Cloud icon (7x5)
const uint8_t AQ_ICON[] PROGMEM = {
    0, 1, 1, 0, 1, 1, 0,
    1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1,
    0, 1, 1, 1, 1, 1, 0,
};

// Update/Download arrow icon (5x7)
const uint8_t UPDATE_ICON[] PROGMEM = {
    0, 0, 1, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 1, 0, 0,
    1, 0, 1, 0, 1,
    0, 1, 1, 1, 0,
    0, 0, 1, 0, 0,
    1, 1, 1, 1, 1,
};

// Checkmark icon (5x5)
const uint8_t CHECK_ICON[] PROGMEM = {
    0, 0, 0, 0, 1,
    0, 0, 0, 1, 0,
    1, 0, 1, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 0, 0, 0,
};

// X/Error icon (5x5)
const uint8_t ERROR_ICON[] PROGMEM = {
    1, 0, 0, 0, 1,
    0, 1, 0, 1, 0,
    0, 0, 1, 0, 0,
    0, 1, 0, 1, 0,
    1, 0, 0, 0, 1,
};

#endif // ICONS_H
