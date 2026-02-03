/**
 * @file display_scrolling.cpp
 * @brief Unified Scrolling Text Engine
 * 
 * Contains scrolling text rendering functions with unified implementation
 * for different text sizes (normal and tiny).
 */

#include "matrix_display.h"
#include "display_fonts.h"

// Get or create a scroll state for a given key
MatrixDisplay::ScrollState* MatrixDisplay::getScrollState(const String& key) {
    // Look for existing entry
    for (int i = 0; i < MAX_SCROLL_STATES; i++) {
        if (scroll_states[i].active && scroll_states[i].key == key) {
            return &scroll_states[i].state;
        }
    }
    // Find an empty slot
    for (int i = 0; i < MAX_SCROLL_STATES; i++) {
        if (!scroll_states[i].active) {
            scroll_states[i].key = key;
            scroll_states[i].active = true;
            scroll_states[i].state.text = "";
            scroll_states[i].state.offset = 0;
            scroll_states[i].state.last_ms = 0;
            return &scroll_states[i].state;
        }
    }
    // All slots full, reuse the first one (shouldn't happen with 16 slots)
    scroll_states[0].key = key;
    scroll_states[0].state.text = "";
    scroll_states[0].state.offset = 0;
    scroll_states[0].state.last_ms = 0;
    return &scroll_states[0].state;
}

/**
 * @brief Generic scrolling text renderer that handles both normal and tiny text
 * 
 * Internal helper function that consolidates scrolling logic for both normal and tiny text.
 * This function is called by the public scrolling functions to avoid code duplication.
 */
void MatrixDisplay::drawScrollingTextGeneric(int y, const String& text, uint16_t color, 
                                               int start_x, int max_width, ScrollState* state, bool use_tiny) {
    if (max_width <= 0) {
        return;
    }
    if (start_x < 0) {
        max_width += start_x;
        start_x = 0;
    }
    if (start_x >= MATRIX_WIDTH) {
        return;
    }
    if (start_x + max_width > MATRIX_WIDTH) {
        max_width = MATRIX_WIDTH - start_x;
        if (max_width <= 0) {
            return;
        }
    }

    String safe_text = sanitizeSingleLine(text);
    const int char_width = use_tiny ? 4 : 6;  // tiny: 3px glyph + 1px spacing, normal: 6px
    const int text_height = use_tiny ? 6 : 8;  // tiny: 5px glyph + 1px breathing room, normal: 8px
    const int max_chars = max_width / char_width;

    bool force_redraw = false;
    if (state->text != safe_text) {
        state->text = safe_text;
        state->offset = max_width;
        state->last_ms = 0;
        force_redraw = true;
    }
    if (state->color != color) {
        state->color = color;
        force_redraw = true;
    }

    // Text fits - draw centered, no scrolling needed
    if ((int)safe_text.length() <= max_chars) {
        if (state->offset != 0) {
            state->offset = 0;
            force_redraw = true;
        }
        if (!force_redraw) {
            return;  // No change, skip redraw
        }
        fillRect(start_x, y, max_width, text_height, COLOR_BLACK);
        // Center the text within the content area
        int text_width = use_tiny ? tinyTextWidth(safe_text) : safe_text.length() * char_width;
        int x = start_x + (max_width - text_width) / 2;
        if (x < start_x) x = start_x;
        if (use_tiny) {
            drawTinyText(x, y, safe_text, color);
        } else {
            drawSmallText(x, y, safe_text, color);
        }
        return;
    }

    // Text too long - scroll it
    const unsigned long now = millis();
    if (!force_redraw) {
        if (now - state->last_ms <= scroll_speed_ms) {
            return;
        }
        state->offset++;
    }
    state->last_ms = now;

    // Use String::reserve() to pre-allocate memory before concatenation
    String scroll_text;
    scroll_text.reserve(safe_text.length() + 3);
    scroll_text = safe_text + "   ";
    const int text_width = use_tiny ? tinyTextWidth(scroll_text) : scroll_text.length() * char_width;
    const int wrap_width = text_width + max_width;
    if (state->offset > wrap_width) {
        state->offset = 0;
    }

    fillRect(start_x, y, max_width, text_height, COLOR_BLACK);
    const int x = start_x + max_width - state->offset;
    if (use_tiny) {
        drawTinyText(x, y, scroll_text, color);
    } else {
        drawSmallText(x, y, scroll_text, color);
    }
}

void MatrixDisplay::drawScrollingText(int y, const String& text, uint16_t color, int max_width, const String& key) {
    // Call overloaded version with start_x=0 for backward compatibility
    drawScrollingText(y, text, color, 0, max_width, key);
}

void MatrixDisplay::drawScrollingText(int y, const String& text, uint16_t color, int start_x, int max_width, const String& key) {
    ScrollState* state = getScrollState(key);
    drawScrollingTextGeneric(y, text, color, start_x, max_width, state, false);
}

void MatrixDisplay::drawTextAutoScroll(int y, const String& text, uint16_t color, int content_x, int content_width, const String& key) {
    // drawScrollingText() handles bounds checking, centering when text fits, and scrolling when it doesn't
    drawScrollingText(y, text, color, content_x, content_width, key);
}

void MatrixDisplay::drawTinyScrollingText(int y, const String& text, uint16_t color, int start_x, int max_width, const String& key) {
    ScrollState* state = getScrollState(key);
    drawScrollingTextGeneric(y, text, color, start_x, max_width, state, true);
}

void MatrixDisplay::drawScrollingStatusText(int y, const String& text, uint16_t color, int start_x) {
    const int available_width = MATRIX_WIDTH - start_x;
    // Reuse the generic implementation with status_scroll state
    drawScrollingTextGeneric(y, text, color, start_x, available_width, &status_scroll, false);
}
