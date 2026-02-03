/**
 * @file display_primitives.cpp
 * @brief Core Drawing Primitive Functions
 * 
 * Contains low-level drawing functions for shapes and basic text rendering.
 */

#include "matrix_display.h"
#include "display_fonts.h"

void MatrixDisplay::drawRect(int x, int y, int w, int h, uint16_t color) {
    dma_display->drawRect(x, y, w, h, color);
}

void MatrixDisplay::fillRect(int x, int y, int w, int h, uint16_t color) {
    dma_display->fillRect(x, y, w, h, color);
}

void MatrixDisplay::drawPixel(int x, int y, uint16_t color) {
    dma_display->drawPixel(x, y, color);
}

void MatrixDisplay::drawStatusBorder(uint16_t color, uint8_t width) {
    // Clamp width to valid range
    if (width < 1) width = 1;
    if (width > 3) width = 3;
    
    // Draw concentric rectangles for the border
    for (uint8_t i = 0; i < width; i++) {
        drawRect(i, i, MATRIX_WIDTH - 2 * i, MATRIX_HEIGHT - 2 * i, color);
    }
}

/**
 * @brief Draw text at the specified position
 * 
 * On a 64x32 LED matrix, all text is effectively "small" (size 1).
 * This function and drawSmallText are equivalent - use either.
 */
void MatrixDisplay::drawSmallText(int x, int y, const String& text, uint16_t color) {
    String safe_text = sanitizeSingleLine(text);
    dma_display->setTextColor(color);
    dma_display->setTextSize(1);
    dma_display->setCursor(x, y);
    dma_display->print(safe_text);
}

// Alias for backward compatibility - identical to drawSmallText
void MatrixDisplay::drawText(int x, int y, const String& text, uint16_t color) {
    drawSmallText(x, y, text, color);
}

void MatrixDisplay::drawCenteredText(int y, const String& text, uint16_t color) {
    String safe_text = sanitizeSingleLine(text);
    int text_width = safe_text.length() * 6;
    int x = (MATRIX_WIDTH - text_width) / 2;
    if (x < 0) x = 0;
    drawSmallText(x, y, safe_text, color);
}

void MatrixDisplay::drawTinyText(int x, int y, const String& text, uint16_t color) {
    int cursor_x = x;
    for (size_t i = 0; i < text.length(); i++) {
        drawTinyChar(cursor_x, y, text[i], color);
        cursor_x += 4; // 3px glyph + 1px spacing
    }
}

void MatrixDisplay::drawTinyChar(int x, int y, char c, uint16_t color) {
    const uint8_t* glyph = DisplayFonts::getGlyph(c);
    if (!glyph) {
        return;
    }

    for (int row = 0; row < 5; row++) {
        uint8_t row_bits = glyph[row];
        for (int col = 0; col < 3; col++) {
            if (row_bits & (1 << (2 - col))) {
                drawPixel(x + col, y + row, color);
            }
        }
    }
}

int MatrixDisplay::getTextLineY(uint8_t line_index, uint8_t line_height) const {
    return getTextLineY(line_index, line_height, 0);
}

int MatrixDisplay::getTextLineY(uint8_t line_index, uint8_t line_height, int top_offset) const {
    if (line_height == 0) {
        line_height = 8;
    }
    int y = top_offset + line_height * line_index;
    const int max_y = MATRIX_HEIGHT - line_height;
    if (y > max_y) {
        y = max_y;
    }
    if (y < 0) {
        y = 0;
    }
    return y;
}
