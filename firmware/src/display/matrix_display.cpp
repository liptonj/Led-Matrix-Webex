/**
 * @file matrix_display.cpp
 * @brief LED Matrix Display Driver Implementation
 * Based on working SimpleTestShapes.ino example with FM6047 driver
 */

#include "matrix_display.h"
#include "icons.h"

namespace {
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
const uint8_t TINY_FONT_SLASH[5] = {0b001, 0b001, 0b010, 0b100, 0b100};
const uint8_t TINY_FONT_COLON[5] = {0b000, 0b010, 0b000, 0b010, 0b000};
const uint8_t TINY_FONT_SPACE[5] = {0b000, 0b000, 0b000, 0b000, 0b000};
}

MatrixDisplay::MatrixDisplay()
    : dma_display(nullptr), initialized(false), brightness(128) {
}

MatrixDisplay::~MatrixDisplay() {
    if (dma_display) {
        delete dma_display;
    }
}

bool MatrixDisplay::begin() {
    // Don't call Serial.begin() here - main.cpp already did it
    delay(10);

    Serial.println("===============================================");
    Serial.println("[DISPLAY] Initialization starting...");
    Serial.flush();
    yield(); // Feed watchdog

    // Matrix configuration
    HUB75_I2S_CFG mxconfig(
        PANEL_RES_X,   // 64 pixels wide
        PANEL_RES_Y,   // 32 pixels tall
        PANEL_CHAIN    // 1 panel
    );

    // Configure HUB75 pins based on board type
#if defined(ESP32_S3_BOARD)
    Serial.println("[DISPLAY] Configuring for ESP32-S3 board");
    // Seengreat adapter pin configuration for ESP32-S3 (working pins)
    mxconfig.gpio.r1 = 37;
    mxconfig.gpio.g1 = 6;
    mxconfig.gpio.b1 = 36;
    mxconfig.gpio.r2 = 35;
    mxconfig.gpio.g2 = 5;
    mxconfig.gpio.b2 = 0;
    mxconfig.gpio.a = 45;
    mxconfig.gpio.b = 1;
    mxconfig.gpio.c = 48;
    mxconfig.gpio.d = 2;
    mxconfig.gpio.e = 4;
    mxconfig.gpio.lat = 38;
    mxconfig.gpio.oe = 21;
    mxconfig.gpio.clk = 47;
#else
    Serial.println("[DISPLAY] Configuring for ESP32 standard board");
    // Default ESP32 pins
    mxconfig.gpio.r1 = 25;
    mxconfig.gpio.g1 = 26;
    mxconfig.gpio.b1 = 27;
    mxconfig.gpio.r2 = 14;
    mxconfig.gpio.g2 = 12;
    mxconfig.gpio.b2 = 13;
    mxconfig.gpio.a = 23;
    mxconfig.gpio.b = 19;
    mxconfig.gpio.c = 5;
    mxconfig.gpio.d = 17;
    mxconfig.gpio.e = 32;
    mxconfig.gpio.lat = 4;
    mxconfig.gpio.oe = 15;
    mxconfig.gpio.clk = 16;
#endif

    Serial.println("[DISPLAY] Pin configuration set");

    mxconfig.clkphase = false;
    mxconfig.driver = HUB75_I2S_CFG::FM6126A;
    // Reduce visible flicker: higher refresh + stable latch blanking
    mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_20M;
    mxconfig.min_refresh_rate = 120;
    mxconfig.latch_blanking = 1;

    Serial.println("[DISPLAY] Creating DMA display object...");
    dma_display = new MatrixPanel_I2S_DMA(mxconfig);

    if (!dma_display) {
        Serial.println("[DISPLAY] ERROR: Failed to allocate display object");
        return false;
    }

    Serial.println("[DISPLAY] Calling begin() on display...");
    if (!dma_display->begin()) {
        Serial.println("[DISPLAY] ERROR: Display begin() failed");
        delete dma_display;
        dma_display = nullptr;
        return false;
    }

    Serial.println("[DISPLAY] Setting brightness and clearing screen...");
    brightness = 255;
    dma_display->setBrightness8(brightness);
    dma_display->setTextWrap(false);
    dma_display->clearScreen();

    dma_display->fillScreen(dma_display->color444(0, 0, 0));
    dma_display->setTextSize(1);
    dma_display->setTextColor(dma_display->color444(0, 15, 15));
    dma_display->setCursor(8, 12);
    dma_display->print("WEBEX");

    Serial.println("[DISPLAY] Initialization complete");
    Serial.printf("[DISPLAY] Matrix size: %dx%d pixels\n", MATRIX_WIDTH, MATRIX_HEIGHT);
    Serial.printf("[DISPLAY] Brightness: %d/255\n", brightness);
    Serial.println("===============================================");
    Serial.flush();

    initialized = true;
    return true;
}


void MatrixDisplay::drawSensorBar(const DisplayData& data, int y) {
    const int char_width = 6;
    // Temperature left
    char temp_str[8];
    int temp_f = (int)((data.temperature * 9.0f / 5.0f) + 32.0f);
    snprintf(temp_str, sizeof(temp_str), "%dF", temp_f);
    String temp_text = String(temp_str);
    if (temp_text.length() > 3) {
        temp_text = String(temp_f);
    }

    // Humidity center
    char humid_str[8];
    snprintf(humid_str, sizeof(humid_str), "%d%%", (int)data.humidity);
    String humid_text = String(humid_str);
    if (humid_text.length() > 3) {
        humid_text = String((int)data.humidity);
    }

    // Configurable right metric
    String metric = data.right_metric;
    metric.toLowerCase();
    char right_str[8];
    String right_text;

    if (metric == "iaq" || metric == "iaqindex") {
        int value = data.air_quality_index;
        if (value > 999) value = 999;
        snprintf(right_str, sizeof(right_str), "A%d", value);
    } else if (metric == "co2") {
        int value = (int)data.co2_ppm;
        if (value >= 1000) {
            int value_k = (value + 500) / 1000;
            snprintf(right_str, sizeof(right_str), "C%dk", value_k);
        } else {
            snprintf(right_str, sizeof(right_str), "C%d", value);
        }
    } else if (metric == "pm2_5" || metric == "pm2.5") {
        int value = (int)data.pm2_5;
        if (value > 999) value = 999;
        snprintf(right_str, sizeof(right_str), "P%d", value);
    } else if (metric == "noise" || metric == "ambientnoise") {
        int value = (int)data.ambient_noise;
        if (value > 999) value = 999;
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

    int left_x = 0;
    int right_x = MATRIX_WIDTH - right_width;
    int mid_x = (MATRIX_WIDTH - humid_width) / 2;
    int min_mid_x = left_x + temp_width + 2;
    int max_mid_x = right_x - humid_width - 2;
    if (mid_x < min_mid_x) {
        mid_x = min_mid_x;
    }
    if (mid_x > max_mid_x) {
        mid_x = max_mid_x;
    }
    if (mid_x < 0) {
        mid_x = 0;
    }

    drawSmallText(left_x, y, temp_text, COLOR_CYAN);
    if (mid_x + humid_width <= MATRIX_WIDTH) {
        drawSmallText(mid_x, y, humid_text, COLOR_CYAN);
    }
    if (right_x >= 0) {
        drawSmallText(right_x, y, right_text, COLOR_CYAN);
    }
}


void MatrixDisplay::clear() {
    if (!initialized) return;
    dma_display->clearScreen();
}

void MatrixDisplay::setBrightness(uint8_t b) {
    brightness = b;
    if (initialized) {
        dma_display->setBrightness8(brightness);
    }
}

void MatrixDisplay::setScrollSpeedMs(uint16_t speed_ms) {
    scroll_speed_ms = speed_ms;
}

void MatrixDisplay::drawLargeStatusCircle(int center_x, int center_y, uint16_t color) {
    // Draw 12x12 status circle centered at (center_x, center_y)
    int start_x = center_x - 6;
    int start_y = center_y - 6;  // Proper centering for 12x12 icon

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

    // Draw 8x8 status circle with bounds checking
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

    // Draw 8x5 camera icon with bounds checking
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

    // Draw X if off (with bounds checking)
    if (!on) {
        // Clamp line endpoints to display bounds
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

    // Draw 5x5 mic icon with bounds checking
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

    // Draw X if muted (with bounds checking)
    if (muted) {
        // Clamp line endpoints to display bounds
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
    // Draw 8x5 call icon with bounds checking
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

    // Draw 7x5 WiFi icon with bounds checking
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

void MatrixDisplay::drawScrollingText(int y, const String& text, uint16_t color, int max_width, const String& key) {
    String safe_text = sanitizeSingleLine(text);
    const int char_width = 6;
    const int max_chars = max_width / char_width;

    ScrollState* state = nullptr;
    if (key == "ap") {
        state = &ap_scroll;
    } else if (key == "unconfig") {
        state = &unconfig_scroll;
    } else if (key == "connecting") {
        state = &connecting_scroll;
    } else if (key == "connected") {
        state = &connected_scroll;
    }

    if (!state) {
        drawSmallText(2, y, safe_text, color);
        return;
    }

    bool force_redraw = false;
    if (state->text != safe_text) {
        state->text = safe_text;
        state->offset = 0;
        state->last_ms = 0;
        force_redraw = true;
    }

    if (safe_text.length() <= max_chars) {
        if (state->offset != 0) {
            state->offset = 0;
            force_redraw = true;
        }
        if (!force_redraw) {
            return; // No change, skip redraw to prevent flicker
        }
        // Clear only the text line to reduce flicker
        dma_display->fillRect(0, y, MATRIX_WIDTH, 8, COLOR_BLACK);
        drawSmallText(2, y, safe_text, color);
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

    // Add spacer so text doesn't appear squished at the wrap point
    const String scroll_text = safe_text + "   ";
    const int text_width = scroll_text.length() * char_width;
    const int wrap_width = text_width + max_width;
    if (state->offset > wrap_width) {
        state->offset = 0;
    }

    // Clear only the text line to reduce flicker
    dma_display->fillRect(0, y, MATRIX_WIDTH, 8, COLOR_BLACK);

    // Start just off the right edge and scroll left
    const int x = 2 + max_width - state->offset;
    drawSmallText(x, y, scroll_text, color);
}

String MatrixDisplay::normalizeIpText(const String& input) {
    String out;
    out.reserve(input.length());
    char last = '\0';
    for (size_t i = 0; i < input.length(); i++) {
        char c = input[i];
        if (c == '.' && last == '.') {
            continue;
        }
        out += c;
        last = c;
    }
    return out;
}

String MatrixDisplay::sanitizeSingleLine(const String& input) {
    String out = input;
    out.replace('\r', ' ');
    out.replace('\n', ' ');
    return out;
}
void MatrixDisplay::drawCenteredText(int y, const String& text, uint16_t color) {
    // Each character is 6 pixels wide in default font
    String safe_text = sanitizeSingleLine(text);
    int text_width = safe_text.length() * 6;
    int x = (MATRIX_WIDTH - text_width) / 2;
    if (x < 0) x = 0;
    drawSmallText(x, y, safe_text, color);
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

void MatrixDisplay::drawRect(int x, int y, int w, int h, uint16_t color) {
    dma_display->drawRect(x, y, w, h, color);
}

void MatrixDisplay::fillRect(int x, int y, int w, int h, uint16_t color) {
    dma_display->fillRect(x, y, w, h, color);
}

void MatrixDisplay::drawPixel(int x, int y, uint16_t color) {
    dma_display->drawPixel(x, y, color);
}

void MatrixDisplay::drawDateTimeLine(int y, const DisplayData& data, uint16_t color) {
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
    const int min_gap = 4; // Minimum gap between date and time

    // Check if both fit with minimum gap
    if (date_width + min_gap + time_width <= MATRIX_WIDTH) {
        // Both fit - draw date on left, time on right
        drawTinyText(0, y, date_text, color);
        int time_x = MATRIX_WIDTH - time_width;
        drawTinyText(time_x, y, time_text, color);
    } else {
        // Not enough space - use shorter date format and check again
        date_text = String(data.month) + "/" + String(data.day);
        date_width = tinyTextWidth(date_text);

        if (date_width + min_gap + time_width <= MATRIX_WIDTH) {
            // Fits with short date format
            drawTinyText(0, y, date_text, color);
            int time_x = MATRIX_WIDTH - time_width;
            drawTinyText(time_x, y, time_text, color);
        } else {
            // Still doesn't fit - show only time, centered or right-aligned
            int time_x = MATRIX_WIDTH - time_width;
            if (time_x < 0) time_x = 0;
            drawTinyText(time_x, y, time_text, color);
        }
    }
}

void MatrixDisplay::drawTinyText(int x, int y, const String& text, uint16_t color) {
    int cursor_x = x;
    for (size_t i = 0; i < text.length(); i++) {
        drawTinyChar(cursor_x, y, text[i], color);
        cursor_x += 4; // 3px glyph + 1px spacing
    }
}

void MatrixDisplay::drawTinyChar(int x, int y, char c, uint16_t color) {
    const uint8_t* glyph = nullptr;
    if (c >= '0' && c <= '9') {
        glyph = TINY_FONT_DIGITS[c - '0'];
    } else if (c >= 'a' && c <= 'z') {
        glyph = TINY_FONT_ALPHA[c - 'a'];
    } else if (c >= 'A' && c <= 'Z') {
        glyph = TINY_FONT_ALPHA[c - 'A'];
    } else if (c == '/') {
        glyph = TINY_FONT_SLASH;
    } else if (c == ':') {
        glyph = TINY_FONT_COLON;
    } else if (c == ' ') {
        glyph = TINY_FONT_SPACE;
    }

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

int MatrixDisplay::tinyTextWidth(const String& text) const {
    if (text.isEmpty()) {
        return 0;
    }
    return (int)(text.length() * 4 - 1);
}

bool MatrixDisplay::isTinyRenderable(const String& text) const {
    for (size_t i = 0; i < text.length(); i++) {
        char c = text[i];
        if ((c >= '0' && c <= '9')
            || (c >= 'a' && c <= 'z')
            || (c >= 'A' && c <= 'Z')
            || c == '/' || c == ':' || c == ' ') {
            continue;
        }
        return false;
    }
    return true;
}

uint16_t MatrixDisplay::getStatusColor(const String& status) {
    if (status == "active") return COLOR_ACTIVE;
    if (status == "inactive" || status == "away") return COLOR_AWAY;
    if (status == "DoNotDisturb" || status == "dnd") return COLOR_DND;
    if (status == "busy" || status == "meeting") return COLOR_BUSY;
    if (status == "OutOfOffice" || status == "ooo") return COLOR_OOO;
    return COLOR_OFFLINE;
}

String MatrixDisplay::getStatusText(const String& status) {
    if (status == "active") return "AVAILABLE";
    if (status == "inactive" || status == "away") return "AWAY";
    if (status == "DoNotDisturb" || status == "dnd") return "DND";
    if (status == "busy") return "BUSY";
    if (status == "meeting") return "IN A CALL";
    if (status == "OutOfOffice" || status == "ooo") return "OOO";
    if (status == "pending") return "PENDING";
    return "OFFLINE";
}

String MatrixDisplay::formatTime(int hour, int minute) {
    // Convert to 12-hour format with AM/PM
    bool is_pm = hour >= 12;
    int hour12 = hour % 12;
    if (hour12 == 0) hour12 = 12;

    char time_str[12];
    snprintf(time_str, sizeof(time_str), "%d:%02d%s", hour12, minute, is_pm ? "PM" : "AM");
    return String(time_str);
}

String MatrixDisplay::formatTime24(int hour, int minute) {
    char time_str[8];
    snprintf(time_str, sizeof(time_str), "%02d:%02d", hour, minute);
    return String(time_str);
}

String MatrixDisplay::formatDate(int month, int day, uint8_t format) {
    char date_str[8];
    if (format == 1) {
        snprintf(date_str, sizeof(date_str), "%d%s", day, getMonthAbbrev(month).c_str());
        return String(date_str);
    }
    if (format == 2) {
        snprintf(date_str, sizeof(date_str), "%02d/%02d", month, day);
        return String(date_str);
    }
    snprintf(date_str, sizeof(date_str), "%s%d", getMonthAbbrev(month).c_str(), day);
    return String(date_str);
}

String MatrixDisplay::getMonthAbbrev(int month) {
    switch (month) {
        case 1: return "JAN";
        case 2: return "FEB";
        case 3: return "MAR";
        case 4: return "APR";
        case 5: return "MAY";
        case 6: return "JUN";
        case 7: return "JUL";
        case 8: return "AUG";
        case 9: return "SEP";
        case 10: return "OCT";
        case 11: return "NOV";
        case 12: return "DEC";
        default: return "???";
    }
}
