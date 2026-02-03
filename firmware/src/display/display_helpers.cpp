/**
 * @file display_helpers.cpp
 * @brief Implementation of display helper classes
 * 
 * @note This helper class requires MatrixDisplay to declare StaticScreenBuilder as a friend
 *       to access private drawing methods. Add this line to matrix_display.h:
 *       `friend class StaticScreenBuilder;`
 */

#include "display_helpers.h"

// Default line height constant (8 pixels)
static const int DEFAULT_LINE_HEIGHT = 8;

StaticScreenBuilder::StaticScreenBuilder(MatrixDisplay* display, const String& screen_key, String& last_static_key_ref)
    : _display(display), _key(screen_key), _last_static_key_ref(&last_static_key_ref) {
    
    // Check if screen changed by comparing with last_static_key
    _changed = (*_last_static_key_ref != _key);
    
    // Update last_static_key if changed
    if (_changed) {
        *_last_static_key_ref = _key;
    }
}

void StaticScreenBuilder::clearScreen() {
    if (!_display) return;
    
    // Use MatrixDisplay's public clear() method
    _display->clear();
}

void StaticScreenBuilder::drawTitle(const String& text, uint16_t color) {
    if (!_display) return;
    
    // Draw centered text at top (line 0)
    // Note: Requires friend access to call drawCenteredText (private method)
    int y = getLineY(0);
    _display->drawCenteredText(y, text, color);
}

void StaticScreenBuilder::drawLine(int line, const String& text, uint16_t color) {
    drawLine(line, DEFAULT_LINE_HEIGHT, 0, text, color);
}

void StaticScreenBuilder::drawLine(int line, int line_height, int top_offset, const String& text, uint16_t color) {
    if (!_display) return;
    
    int y = getLineY(line, line_height, top_offset);
    // Use a small left margin (2 pixels) for left-aligned text
    // Note: Requires friend access to call drawSmallText (private method)
    _display->drawSmallText(2, y, text, color);
}

void StaticScreenBuilder::drawCentered(int y, const String& text, uint16_t color) {
    if (!_display) return;
    
    // Note: Requires friend access to call drawCenteredText (private method)
    _display->drawCenteredText(y, text, color);
}

void StaticScreenBuilder::drawSeparator(int y, uint16_t color) {
    if (!_display) return;
    
    // Draw horizontal line across the display with small margins
    // Note: Requires friend access to call fillRect (private method)
    // Alternative: Could use dma_display->drawFastHLine if we had direct access
    _display->fillRect(4, y, MATRIX_WIDTH - 8, 1, color);
}

int StaticScreenBuilder::getLineY(int line) const {
    return getLineY(line, DEFAULT_LINE_HEIGHT, 0);
}

int StaticScreenBuilder::getLineY(int line, int line_height) const {
    return getLineY(line, line_height, 0);
}

int StaticScreenBuilder::getLineY(int line, int line_height, int top_offset) const {
    if (!_display) return 0;
    
    // Note: Requires friend access to call getTextLineY (private method)
    // Convert int parameters to uint8_t as required by getTextLineY
    return _display->getTextLineY(static_cast<uint8_t>(line), 
                                   static_cast<uint8_t>(line_height), 
                                   top_offset);
}

String StaticScreenBuilder::getScrollKey(const String& suffix) const {
    return _key + "_" + suffix;
}
