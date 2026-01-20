/**
 * @file display_fonts.h
 * @brief Tiny Font Data for LED Matrix Display
 * 
 * 3x5 pixel fonts for compact text rendering on the LED matrix.
 * Each character is represented as 5 rows of 3-bit patterns.
 */

#ifndef DISPLAY_FONTS_H
#define DISPLAY_FONTS_H

#include <Arduino.h>

namespace DisplayFonts {

// 3x5 pixel digit glyphs (0-9)
const uint8_t TINY_FONT_DIGITS[10][5] = {
    {0b111, 0b101, 0b101, 0b101, 0b111}, // 0
    {0b010, 0b110, 0b010, 0b010, 0b111}, // 1
    {0b111, 0b001, 0b111, 0b100, 0b111}, // 2
    {0b111, 0b001, 0b111, 0b001, 0b111}, // 3
    {0b101, 0b101, 0b111, 0b001, 0b001}, // 4
    {0b111, 0b100, 0b111, 0b001, 0b111}, // 5
    {0b111, 0b100, 0b111, 0b101, 0b111}, // 6
    {0b111, 0b001, 0b001, 0b001, 0b001}, // 7
    {0b111, 0b101, 0b111, 0b101, 0b111}, // 8
    {0b111, 0b101, 0b111, 0b001, 0b111}, // 9
};

// 3x5 pixel alphabet glyphs (A-Z)
const uint8_t TINY_FONT_ALPHA[26][5] = {
    {0b111, 0b101, 0b111, 0b101, 0b101}, // A
    {0b110, 0b101, 0b110, 0b101, 0b110}, // B
    {0b111, 0b100, 0b100, 0b100, 0b111}, // C
    {0b110, 0b101, 0b101, 0b101, 0b110}, // D
    {0b111, 0b100, 0b110, 0b100, 0b111}, // E
    {0b111, 0b100, 0b110, 0b100, 0b100}, // F
    {0b111, 0b100, 0b101, 0b101, 0b111}, // G
    {0b101, 0b101, 0b111, 0b101, 0b101}, // H
    {0b111, 0b010, 0b010, 0b010, 0b111}, // I
    {0b001, 0b001, 0b001, 0b101, 0b111}, // J
    {0b101, 0b110, 0b100, 0b110, 0b101}, // K
    {0b100, 0b100, 0b100, 0b100, 0b111}, // L
    {0b101, 0b111, 0b111, 0b101, 0b101}, // M
    {0b101, 0b111, 0b111, 0b111, 0b101}, // N
    {0b111, 0b101, 0b101, 0b101, 0b111}, // O
    {0b111, 0b101, 0b111, 0b100, 0b100}, // P
    {0b111, 0b101, 0b101, 0b111, 0b001}, // Q
    {0b111, 0b101, 0b111, 0b110, 0b101}, // R
    {0b111, 0b100, 0b111, 0b001, 0b111}, // S
    {0b111, 0b010, 0b010, 0b010, 0b010}, // T
    {0b101, 0b101, 0b101, 0b101, 0b111}, // U
    {0b101, 0b101, 0b101, 0b101, 0b010}, // V
    {0b101, 0b101, 0b111, 0b111, 0b101}, // W
    {0b101, 0b101, 0b010, 0b101, 0b101}, // X
    {0b101, 0b101, 0b010, 0b010, 0b010}, // Y
    {0b111, 0b001, 0b010, 0b100, 0b111}, // Z
};

// Special characters
const uint8_t TINY_FONT_SLASH[5] = {0b001, 0b001, 0b010, 0b100, 0b100};
const uint8_t TINY_FONT_COLON[5] = {0b000, 0b010, 0b000, 0b010, 0b000};
const uint8_t TINY_FONT_SPACE[5] = {0b000, 0b000, 0b000, 0b000, 0b000};

/**
 * @brief Get the glyph data for a character
 * @param c Character to look up
 * @return Pointer to 5-byte glyph data, or nullptr if not found
 */
inline const uint8_t* getGlyph(char c) {
    if (c >= '0' && c <= '9') {
        return TINY_FONT_DIGITS[c - '0'];
    } else if (c >= 'a' && c <= 'z') {
        return TINY_FONT_ALPHA[c - 'a'];
    } else if (c >= 'A' && c <= 'Z') {
        return TINY_FONT_ALPHA[c - 'A'];
    } else if (c == '/') {
        return TINY_FONT_SLASH;
    } else if (c == ':') {
        return TINY_FONT_COLON;
    } else if (c == ' ') {
        return TINY_FONT_SPACE;
    }
    return nullptr;
}

/**
 * @brief Check if a character can be rendered with the tiny font
 * @param c Character to check
 * @return true if renderable
 */
inline bool isRenderable(char c) {
    return (c >= '0' && c <= '9')
        || (c >= 'a' && c <= 'z')
        || (c >= 'A' && c <= 'Z')
        || c == '/' || c == ':' || c == ' ';
}

}  // namespace DisplayFonts

#endif // DISPLAY_FONTS_H
