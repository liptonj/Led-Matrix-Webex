/**
 * @file display_primitives.cpp
 * @brief Drawing Primitive Functions
 * 
 * Contains low-level drawing functions for text, icons, shapes, and sensors.
 */

#include "matrix_display.h"
#include "display_fonts.h"
#include "icons.h"

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

void MatrixDisplay::drawText(int x, int y, const String& text, uint16_t color) {
    String safe_text = sanitizeSingleLine(text);
    dma_display->setTextColor(color);
    dma_display->setTextSize(1);
    dma_display->setCursor(x, y);
    dma_display->print(safe_text);
}

void MatrixDisplay::drawSmallText(int x, int y, const String& text, uint16_t color) {
    String safe_text = sanitizeSingleLine(text);
    dma_display->setTextColor(color);
    dma_display->setTextSize(1);
    dma_display->setCursor(x, y);
    dma_display->print(safe_text);
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

void MatrixDisplay::drawScrollingText(int y, const String& text, uint16_t color, int max_width, const String& key) {
    // Call overloaded version with start_x=0 for backward compatibility
    drawScrollingText(y, text, color, 0, max_width, key);
}

void MatrixDisplay::drawScrollingText(int y, const String& text, uint16_t color, int start_x, int max_width, const String& key) {
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
    const int char_width = 6;
    const int max_chars = max_width / char_width;

    ScrollState* state = getScrollState(key);

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
        fillRect(start_x, y, max_width, 8, COLOR_BLACK);
        // Center the text within the content area
        int text_width = safe_text.length() * char_width;
        int x = start_x + (max_width - text_width) / 2;
        if (x < start_x) x = start_x;
        drawSmallText(x, y, safe_text, color);
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
    const int text_width = scroll_text.length() * char_width;
    const int wrap_width = text_width + max_width;
    if (state->offset > wrap_width) {
        state->offset = 0;
    }

    fillRect(start_x, y, max_width, 8, COLOR_BLACK);
    const int x = start_x + max_width - state->offset;
    drawSmallText(x, y, scroll_text, color);
}

void MatrixDisplay::drawTextAutoScroll(int y, const String& text, uint16_t color, int content_x, int content_width, const String& key) {
    if (content_width <= 0) {
        return;
    }
    if (content_x < 0) {
        content_width += content_x;
        content_x = 0;
    }
    if (content_x >= MATRIX_WIDTH) {
        return;
    }
    if (content_x + content_width > MATRIX_WIDTH) {
        content_width = MATRIX_WIDTH - content_x;
        if (content_width <= 0) {
            return;
        }
    }

    String safe_text = sanitizeSingleLine(text);
    const int char_width = 6;
    const int text_width = safe_text.length() * char_width;
    
    // If text fits in content area, draw it centered as static text
    if (text_width <= content_width) {
        fillRect(content_x, y, content_width, 8, COLOR_BLACK);
        int x = content_x + (content_width - text_width) / 2;
        if (x < content_x) x = content_x;
        drawSmallText(x, y, safe_text, color);
    } else {
        // Text too long, use scrolling
        drawScrollingText(y, safe_text, color, content_x, content_width, key);
    }
}

void MatrixDisplay::drawTinyScrollingText(int y, const String& text, uint16_t color, int start_x, int max_width, const String& key) {
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
    const int char_width = 4;  // tiny glyph width (3px + 1px spacing)
    const int text_height = 6; // 5px glyph + 1px breathing room
    const int max_chars = max_width / char_width;

    ScrollState* state = getScrollState(key);

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

    if ((int)safe_text.length() <= max_chars) {
        if (state->offset != 0) {
            state->offset = 0;
            force_redraw = true;
        }
        if (!force_redraw) {
            return;
        }
        fillRect(start_x, y, max_width, text_height, COLOR_BLACK);
        int text_width = tinyTextWidth(safe_text);
        int x = start_x + (max_width - text_width) / 2;
        if (x < start_x) x = start_x;
        drawTinyText(x, y, safe_text, color);
        return;
    }

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
    const int text_width = tinyTextWidth(scroll_text);
    const int wrap_width = text_width + max_width;
    if (state->offset > wrap_width) {
        state->offset = 0;
    }

    fillRect(start_x, y, max_width, text_height, COLOR_BLACK);
    const int x = start_x + max_width - state->offset;
    drawTinyText(x, y, scroll_text, color);
}

void MatrixDisplay::drawStatusIndicator(int x, int y, const String& status) {
    uint16_t color = getStatusColor(status);
    
    static const uint8_t INDICATOR_ICON[36] = {
        0,1,1,1,1,0,
        1,1,1,1,1,1,
        1,1,1,1,1,1,
        1,1,1,1,1,1,
        1,1,1,1,1,1,
        0,1,1,1,1,0
    };
    
    for (int dy = 0; dy < 6; dy++) {
        for (int dx = 0; dx < 6; dx++) {
            if (INDICATOR_ICON[dy * 6 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

void MatrixDisplay::drawSmallStatusIndicator(int x, int y, const String& status) {
    uint16_t color = getStatusColor(status);
    
    // 4x4 filled circle indicator
    static const uint8_t SMALL_INDICATOR[16] = {
        0,1,1,0,
        1,1,1,1,
        1,1,1,1,
        0,1,1,0
    };
    
    for (int dy = 0; dy < 4; dy++) {
        for (int dx = 0; dx < 4; dx++) {
            if (SMALL_INDICATOR[dy * 4 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

void MatrixDisplay::drawScrollingStatusText(int y, const String& text, uint16_t color, int start_x) {
    const int char_width = 6;
    const int available_width = MATRIX_WIDTH - start_x;
    const int max_chars = available_width / char_width;
    
    String safe_text = sanitizeSingleLine(text);
    ScrollState* state = &status_scroll;
    
    bool force_redraw = false;
    if (state->text != safe_text) {
        state->text = safe_text;
        state->offset = available_width;
        state->last_ms = 0;
        force_redraw = true;
    }
    
    // Text fits - no scrolling needed
    if ((int)safe_text.length() <= max_chars) {
        if (state->offset != 0) {
            state->offset = 0;
            force_redraw = true;
        }
        if (!force_redraw) {
            return;  // No change, skip redraw
        }
        // Clear area and draw static text
        fillRect(start_x, y, available_width, 8, COLOR_BLACK);
        drawSmallText(start_x, y, safe_text, color);
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
    const int text_width = scroll_text.length() * char_width;
    const int wrap_width = text_width + available_width;
    if (state->offset > wrap_width) {
        state->offset = 0;
    }
    
    fillRect(start_x, y, available_width, 8, COLOR_BLACK);
    const int x = start_x + available_width - state->offset;
    drawSmallText(x, y, scroll_text, color);
}

void MatrixDisplay::drawLargeStatusCircle(int center_x, int center_y, uint16_t color) {
    int start_x = center_x - 6;
    int start_y = center_y - 6;

    for (int dy = 0; dy < 12; dy++) {
        for (int dx = 0; dx < 12; dx++) {
            if (STATUS_ICON_LARGE[dy * 12 + dx]) {
                int px = start_x + dx;
                int py = start_y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

void MatrixDisplay::drawStatusIcon(int x, int y, const String& status) {
    uint16_t color = getStatusColor(status);

    for (int dy = 0; dy < 8; dy++) {
        for (int dx = 0; dx < 8; dx++) {
            if (STATUS_ICON[dy * 8 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

void MatrixDisplay::drawCameraIcon(int x, int y, bool on) {
    uint16_t color = on ? COLOR_GREEN : COLOR_RED;

    for (int dy = 0; dy < 5; dy++) {
        for (int dx = 0; dx < 8; dx++) {
            if (CAMERA_ICON[dy * 8 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }

    if (!on) {
        int x1 = x;
        int y1 = y;
        int x2 = x + 7;
        int y2 = y + 4;
        if (x1 >= 0 && x1 < MATRIX_WIDTH && y1 >= 0 && y1 < MATRIX_HEIGHT &&
            x2 >= 0 && x2 < MATRIX_WIDTH && y2 >= 0 && y2 < MATRIX_HEIGHT) {
            dma_display->drawLine(x1, y1, x2, y2, COLOR_RED);
        }
        x1 = x;
        y1 = y + 4;
        x2 = x + 7;
        y2 = y;
        if (x1 >= 0 && x1 < MATRIX_WIDTH && y1 >= 0 && y1 < MATRIX_HEIGHT &&
            x2 >= 0 && x2 < MATRIX_WIDTH && y2 >= 0 && y2 < MATRIX_HEIGHT) {
            dma_display->drawLine(x1, y1, x2, y2, COLOR_RED);
        }
    }
}

void MatrixDisplay::drawMicIcon(int x, int y, bool muted) {
    uint16_t color = muted ? COLOR_RED : COLOR_GREEN;

    for (int dy = 0; dy < 5; dy++) {
        for (int dx = 0; dx < 5; dx++) {
            if (MIC_ICON[dy * 5 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }

    if (muted) {
        int x1 = x;
        int y1 = y;
        int x2 = x + 4;
        int y2 = y + 4;
        if (x1 >= 0 && x1 < MATRIX_WIDTH && y1 >= 0 && y1 < MATRIX_HEIGHT &&
            x2 >= 0 && x2 < MATRIX_WIDTH && y2 >= 0 && y2 < MATRIX_HEIGHT) {
            dma_display->drawLine(x1, y1, x2, y2, COLOR_RED);
        }
        x1 = x;
        y1 = y + 4;
        x2 = x + 4;
        y2 = y;
        if (x1 >= 0 && x1 < MATRIX_WIDTH && y1 >= 0 && y1 < MATRIX_HEIGHT &&
            x2 >= 0 && x2 < MATRIX_WIDTH && y2 >= 0 && y2 < MATRIX_HEIGHT) {
            dma_display->drawLine(x1, y1, x2, y2, COLOR_RED);
        }
    }
}

void MatrixDisplay::drawCallIcon(int x, int y) {
    for (int dy = 0; dy < 5; dy++) {
        for (int dx = 0; dx < 8; dx++) {
            if (CALL_ICON[dy * 8 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, COLOR_GREEN);
                }
            }
        }
    }
}

void MatrixDisplay::drawWifiIcon(int x, int y, bool connected) {
    uint16_t color = connected ? COLOR_GREEN : COLOR_RED;

    for (int dy = 0; dy < 5; dy++) {
        for (int dx = 0; dx < 7; dx++) {
            if (WIFI_ICON[dy * 7 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

void MatrixDisplay::drawSensorBar(const DisplayData& data, int y) {
    // Call overloaded version with full width for backward compatibility
    drawSensorBar(data, y, 0, MATRIX_WIDTH);
}

void MatrixDisplay::drawSensorBar(const DisplayData& data, int y, int content_x, int content_width) {
    const int char_width = 6;
    String temp_text, humid_text, right_text;

    int temp_f = (int)((data.temperature * 9.0f / 5.0f) + 32.0f);
    temp_text = String(temp_f) + "F";

    humid_text = String((int)data.humidity) + "%";

    String metric = data.right_metric;
    metric.toLowerCase();
    char right_str[16];
    if (metric == "co2") {
        snprintf(right_str, sizeof(right_str), "C%d", (int)data.co2_ppm);
    } else if (metric == "pm2_5" || metric == "pm2.5") {
        snprintf(right_str, sizeof(right_str), "P%d", (int)data.pm2_5);
    } else if (metric == "noise") {
        int value = (int)data.ambient_noise;
        snprintf(right_str, sizeof(right_str), "N%d", value);
    } else {
        if (data.tvoc >= 1000.0f) {
            int tvoc_k = (int)((data.tvoc + 500.0f) / 1000.0f);
            snprintf(right_str, sizeof(right_str), "T%dk", tvoc_k);
        } else {
            snprintf(right_str, sizeof(right_str), "T%d", (int)data.tvoc);
        }
    }

    right_text = String(right_str);
    int temp_width = temp_text.length() * char_width;
    int humid_width = humid_text.length() * char_width;
    int right_width = right_text.length() * char_width;

    int left_x = content_x;
    int right_x = content_x + content_width - right_width;
    int mid_x = content_x + (content_width - humid_width) / 2;
    int min_mid_x = left_x + temp_width + 2;
    int max_mid_x = right_x - humid_width - 2;
    if (mid_x < min_mid_x) {
        mid_x = min_mid_x;
    }
    if (mid_x > max_mid_x) {
        mid_x = max_mid_x;
    }
    if (mid_x < content_x) {
        mid_x = content_x;
    }

    drawSmallText(left_x, y, temp_text, data.metric_color);
    if (mid_x + humid_width <= content_x + content_width) {
        drawSmallText(mid_x, y, humid_text, data.metric_color);
    }
    if (right_x >= content_x) {
        drawSmallText(right_x, y, right_text, data.metric_color);
    }
}

void MatrixDisplay::drawDateTimeLine(int y, const DisplayData& data, uint16_t date_color, uint16_t time_color) {
    // Call overloaded version with full width for backward compatibility
    drawDateTimeLine(y, data, date_color, time_color, 0, MATRIX_WIDTH);
}

void MatrixDisplay::drawDateTimeLine(int y, const DisplayData& data, uint16_t date_color, uint16_t time_color,
                                     int content_x, int content_width) {
    String date_text = formatDate(data.month, data.day, data.date_format);
    if (!isTinyRenderable(date_text)) {
        date_text = String(data.month) + "/" + String(data.day);
    }

    String time_text = data.use_24h
        ? formatTime24(data.hour, data.minute)
        : formatTime(data.hour, data.minute);
    if (!isTinyRenderable(time_text)) {
        time_text = formatTime24(data.hour, data.minute);
    }

    int time_width = tinyTextWidth(time_text);
    int date_width = tinyTextWidth(date_text);
    const int min_gap = 4;

    if (date_width + min_gap + time_width <= content_width) {
        drawTinyText(content_x, y, date_text, date_color);
        int time_x = content_x + content_width - time_width;
        drawTinyText(time_x, y, time_text, time_color);
    } else {
        date_text = String(data.month) + "/" + String(data.day);
        date_width = tinyTextWidth(date_text);

        if (date_width + min_gap + time_width <= content_width) {
            drawTinyText(content_x, y, date_text, date_color);
            int time_x = content_x + content_width - time_width;
            drawTinyText(time_x, y, time_text, time_color);
        } else {
            int time_x = content_x + content_width - time_width;
            if (time_x < content_x) time_x = content_x;
            drawTinyText(time_x, y, time_text, time_color);
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
