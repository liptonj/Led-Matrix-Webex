/**
 * @file matrix_display.cpp
 * @brief LED Matrix Display Driver Implementation
 * Based on working SimpleTestShapes.ino example with FM6047 driver
 */

#include "matrix_display.h"
#include "icons.h"

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
    
    Serial.println(">>> Display init START");
    Serial.flush();
    yield(); // Feed watchdog
    
#if defined(ESP32_S3_BOARD)
    // Seengreat adapter pin configuration for ESP32-S3
    HUB75_I2S_CFG::i2s_pins _pins = {
        37, 6, 36,    // R1, G1, B1
        35, 5, 0,     // R2, G2, B2
        45, 1, 48, 2, 4,  // A, B, C, D, E
        38, 21, 47    // LAT, OE, CLK (struct order is lat, oe, clk)
    };
    
    Serial.println(">>> Using S3 pins");
#else
    // Default ESP32 pins
    HUB75_I2S_CFG::i2s_pins _pins = {
        25, 26, 27, 14, 12, 13,
        23, 19, 5, 17, 32,
        16, 4, 15
    };
    Serial.println(">>> Using default pins");
#endif
    Serial.flush();
    yield(); // Feed watchdog

    // Module configuration
    Serial.println(">>> Creating config");
    Serial.flush();
    yield();
    
    HUB75_I2S_CFG mxconfig(
        PANEL_RES_X,   // 64 pixels wide
        PANEL_RES_Y,   // 32 pixels tall
        PANEL_CHAIN,   // 1 panel
        _pins          // Pin configuration
    );
    
    mxconfig.clkphase = false;
    mxconfig.driver = HUB75_I2S_CFG::FM6126A;
    // Reduce visible flicker: higher refresh + stable latch blanking
    mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_20M;
    mxconfig.min_refresh_rate = 120;
    mxconfig.latch_blanking = 1;
    
    Serial.println(">>> Creating display object");
    Serial.flush();
    yield();
    
    dma_display = new MatrixPanel_I2S_DMA(mxconfig);
    
    if (!dma_display) {
        Serial.println(">>> FAILED to create display");
        return false;
    }
    
    Serial.println(">>> Calling begin()");
    Serial.flush();
    yield();
    
    if (!dma_display->begin()) {
        Serial.println(">>> begin() FAILED");
        delete dma_display;
        dma_display = nullptr;
        return false;
    }
    
    Serial.println(">>> Setting brightness");
    Serial.flush();
    yield();
    
    brightness = 255;
    dma_display->setBrightness8(brightness);
    
    Serial.println(">>> Clearing screen");
    Serial.flush();
    yield();
    
    dma_display->clearScreen();
    
    Serial.println(">>> Drawing WEBEX text");
    Serial.flush();
    yield();
    
    dma_display->fillScreen(dma_display->color444(0, 0, 0));
    dma_display->setTextSize(1);
    dma_display->setTextColor(dma_display->color444(0, 15, 15));
    dma_display->setCursor(8, 12);
    dma_display->print("WEBEX");
    
    Serial.println(">>> Display init COMPLETE");
    Serial.flush();
    
    initialized = true;
    return true;
}

void MatrixDisplay::update(const DisplayData& data) {
    if (!initialized) return;

    dma_display->clearScreen();

    uint16_t status_color = getStatusColor(data.webex_status);

    // Check if in a meeting/call - show different layout
    if (data.show_call_status && data.in_call) {
        // === IN A CALL LAYOUT (32 pixel height) ===
        // y=0: "IN A CALL" text centered
        drawCenteredText(0, "IN A CALL", status_color);

        // y=8: Separator
        dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);

        // y=10-15: Camera and Mic status with labels
        // Camera icon left side with label
        drawCameraIcon(4, 10, data.camera_on);
        drawSmallText(14, 10, data.camera_on ? "ON" : "OFF", data.camera_on ? COLOR_GREEN : COLOR_RED);

        // Mic icon right side with label
        drawMicIcon(36, 10, data.mic_muted);
        drawSmallText(43, 10, data.mic_muted ? "OFF" : "ON", data.mic_muted ? COLOR_RED : COLOR_GREEN);

        // y=17: Separator
        dma_display->drawFastHLine(0, 17, MATRIX_WIDTH, COLOR_GRAY);

        // y=19-25: Date/Time in status color
        if (data.time_valid) {
            String datetime = formatDate(data.month, data.day) + " " + formatTime(data.hour, data.minute);
            drawCenteredText(19, datetime, status_color);
        }

        // y=26: Separator
        dma_display->drawFastHLine(0, 26, MATRIX_WIDTH, COLOR_GRAY);

        // y=27-31: Sensor data
        if (data.show_sensors) {
            drawSensorBar(data, 27);
        }
    } else {
        // === NORMAL STATUS LAYOUT (32 pixel height) ===
        // y=0-7: Status circle centered (8x8)
        drawStatusIcon(MATRIX_WIDTH / 2 - 4, 0, data.webex_status);

        // y=8: Status text centered
        drawCenteredText(9, getStatusText(data.webex_status), status_color);

        // y=17-24: Date and Time in status color
        if (data.time_valid) {
            String datetime = formatDate(data.month, data.day) + " " + formatTime(data.hour, data.minute);
            drawCenteredText(18, datetime, status_color);
        }

        // y=26-31: Sensor data
        if (data.show_sensors) {
            drawSensorBar(data, 26);
        }
    }
}

void MatrixDisplay::drawSensorBar(const DisplayData& data, int y) {
    // Temperature left
    char temp_str[8];
    int temp_f = (int)((data.temperature * 9.0f / 5.0f) + 32.0f);
    snprintf(temp_str, sizeof(temp_str), "%dF", temp_f);
    drawSmallText(2, y, temp_str, COLOR_CYAN);

    // Humidity center
    char humid_str[8];
    snprintf(humid_str, sizeof(humid_str), "%d%%", (int)data.humidity);
    drawSmallText(22, y, humid_str, COLOR_CYAN);

    // Air quality right
    char aq_str[8];
    snprintf(aq_str, sizeof(aq_str), "AQ%d", data.air_quality_index);
    drawSmallText(44, y, aq_str, COLOR_CYAN);
}

void MatrixDisplay::showStartupScreen(const char* version) {
    if (!initialized) return;

    dma_display->clearScreen();
    drawText(8, 4, "WEBEX", COLOR_CYAN);
    drawText(4, 14, "DISPLAY", COLOR_WHITE);

    char ver_str[16];
    snprintf(ver_str, sizeof(ver_str), "v%s", version);
    drawSmallText(16, 25, ver_str, COLOR_GRAY);
}

void MatrixDisplay::showAPMode(const String& ip_address) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "ap:" + ip_text;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawText(2, 2, "WEBEX", COLOR_CYAN);
        drawText(2, 11, "DISPLAY", COLOR_WHITE);
        drawSmallText(2, 20, "Open WiFi AP", COLOR_YELLOW);
    }
    drawScrollingText(22, ip_text, COLOR_GREEN, MATRIX_WIDTH - 4, "ap");
}

void MatrixDisplay::showUnconfigured(const String& ip_address) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "unconfig:" + ip_text;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawText(2, 2, "WEBEX", COLOR_CYAN);
        drawText(2, 11, "DISPLAY", COLOR_WHITE);
    }
    drawScrollingText(22, ip_text, COLOR_GREEN, MATRIX_WIDTH - 4, "unconfig");
}

void MatrixDisplay::showWifiDisconnected() {
    if (!initialized) return;

    const String screen_key = "wifi_offline";
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();

        // Draw WiFi icon centered, disconnected (red)
        int icon_x = (MATRIX_WIDTH - 7) / 2;
        int icon_y = 6;
        drawWifiIcon(icon_x, icon_y, false);

        drawCenteredText(16, "WIFI OFFLINE", COLOR_YELLOW);
        drawCenteredText(24, "NO CONNECTION", COLOR_WHITE);
    }
}

void MatrixDisplay::showConnecting(const String& ssid) {
    if (!initialized) return;

    const String screen_key = "connecting:" + ssid;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawText(2, 2, "CONNECTING", COLOR_YELLOW);
    }

    drawScrollingText(22, ssid, COLOR_WHITE, MATRIX_WIDTH - 4, "connecting");
}

void MatrixDisplay::showConnected(const String& ip_address) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "connected:" + ip_text;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawText(2, 2, "CONNECTED", COLOR_GREEN);
    }
    drawScrollingText(22, ip_text, COLOR_WHITE, MATRIX_WIDTH - 4, "connected");
}

void MatrixDisplay::showUpdating(const String& version) {
    if (!initialized) return;

    dma_display->clearScreen();
    drawText(4, 4, "UPDATING", COLOR_ORANGE);
    drawSmallText(2, 16, "Installing:", COLOR_WHITE);
    drawSmallText(2, 24, version, COLOR_CYAN);
}

void MatrixDisplay::showSetupHostname(const String& hostname) {
    if (!initialized) return;

    dma_display->clearScreen();
    
    // Title
    drawCenteredText(0, "SETUP", COLOR_CYAN);
    
    // Separator
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);
    
    // Instructions
    drawCenteredText(10, "Open in Webex:", COLOR_WHITE);
    
    // Hostname - may need to scroll if too long
    String displayHost = hostname;
    if (displayHost.length() > 10) {
        // Truncate with ".local" visible
        displayHost = hostname.substring(0, 7) + "...";
    }
    drawCenteredText(18, displayHost, COLOR_GREEN);
    
    // Separator
    dma_display->drawFastHLine(0, 25, MATRIX_WIDTH, COLOR_GRAY);
    
    // Embedded app path hint
    drawCenteredText(27, "/embedded", COLOR_YELLOW);
}

void MatrixDisplay::showWaitingForWebex(const String& hostname) {
    if (!initialized) return;

    dma_display->clearScreen();
    
    // Status indicator - pulsing effect would be nice but static for now
    drawStatusIcon(MATRIX_WIDTH / 2 - 4, 0, "pending");
    
    // Message
    drawCenteredText(10, "WAITING", COLOR_YELLOW);
    
    // Separator
    dma_display->drawFastHLine(0, 17, MATRIX_WIDTH, COLOR_GRAY);
    
    // Hostname info
    drawCenteredText(19, "Connect via:", COLOR_WHITE);
    
    String displayHost = hostname;
    if (displayHost.length() > 10) {
        displayHost = hostname.substring(0, 10);
    }
    drawCenteredText(26, displayHost, COLOR_CYAN);
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
    int start_y = center_y - 4;  // Offset to fit in display

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

    // Draw 8x8 status circle
    for (int dy = 0; dy < 8; dy++) {
        for (int dx = 0; dx < 8; dx++) {
            if (STATUS_ICON[dy * 8 + dx]) {
                dma_display->drawPixel(x + dx, y + dy, color);
            }
        }
    }
}

void MatrixDisplay::drawCameraIcon(int x, int y, bool on) {
    uint16_t color = on ? COLOR_GREEN : COLOR_RED;

    for (int dy = 0; dy < 5; dy++) {
        for (int dx = 0; dx < 8; dx++) {
            if (CAMERA_ICON[dy * 8 + dx]) {
                dma_display->drawPixel(x + dx, y + dy, color);
            }
        }
    }

    // Draw X if off
    if (!on) {
        dma_display->drawLine(x, y, x + 7, y + 4, COLOR_RED);
        dma_display->drawLine(x, y + 4, x + 7, y, COLOR_RED);
    }
}

void MatrixDisplay::drawMicIcon(int x, int y, bool muted) {
    uint16_t color = muted ? COLOR_RED : COLOR_GREEN;

    for (int dy = 0; dy < 5; dy++) {
        for (int dx = 0; dx < 5; dx++) {
            if (MIC_ICON[dy * 5 + dx]) {
                dma_display->drawPixel(x + dx, y + dy, color);
            }
        }
    }

    // Draw X if muted
    if (muted) {
        dma_display->drawLine(x, y, x + 4, y + 4, COLOR_RED);
        dma_display->drawLine(x, y + 4, x + 4, y, COLOR_RED);
    }
}

void MatrixDisplay::drawCallIcon(int x, int y) {
    for (int dy = 0; dy < 5; dy++) {
        for (int dx = 0; dx < 8; dx++) {
            if (CALL_ICON[dy * 8 + dx]) {
                dma_display->drawPixel(x + dx, y + dy, COLOR_GREEN);
            }
        }
    }
}

void MatrixDisplay::drawWifiIcon(int x, int y, bool connected) {
    uint16_t color = connected ? COLOR_GREEN : COLOR_RED;

    for (int dy = 0; dy < 5; dy++) {
        for (int dx = 0; dx < 7; dx++) {
            if (WIFI_ICON[dy * 7 + dx]) {
                dma_display->drawPixel(x + dx, y + dy, color);
            }
        }
    }
}

void MatrixDisplay::drawText(int x, int y, const String& text, uint16_t color) {
    dma_display->setTextColor(color);
    dma_display->setTextSize(1);
    dma_display->setCursor(x, y);
    dma_display->print(text);
}

void MatrixDisplay::drawSmallText(int x, int y, const String& text, uint16_t color) {
    dma_display->setTextColor(color);
    dma_display->setTextSize(1);
    dma_display->setCursor(x, y);
    dma_display->print(text);
}

void MatrixDisplay::drawScrollingText(int y, const String& text, uint16_t color, int max_width, const String& key) {
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
        drawSmallText(2, y, text, color);
        return;
    }

    if (state->text != text) {
        state->text = text;
        state->offset = 0;
        state->last_ms = 0;
    }

    // Clear only the text line to reduce flicker
    dma_display->fillRect(0, y, MATRIX_WIDTH, 8, COLOR_BLACK);

    if (text.length() <= max_chars) {
        drawSmallText(2, y, text, color);
        return;
    }

    const unsigned long now = millis();
    if (now - state->last_ms > scroll_speed_ms) {
        state->offset++;
        state->last_ms = now;
    }

    // Add spacer so text doesn't appear squished at the wrap point
    const String scroll_text = text + "   ";
    const int text_width = scroll_text.length() * char_width;
    const int wrap_width = text_width + max_width;
    if (state->offset > wrap_width) {
        state->offset = 0;
    }

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
void MatrixDisplay::drawCenteredText(int y, const String& text, uint16_t color) {
    // Each character is 6 pixels wide in default font
    int text_width = text.length() * 6;
    int x = (MATRIX_WIDTH - text_width) / 2;
    if (x < 0) x = 0;
    drawSmallText(x, y, text, color);
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

String MatrixDisplay::formatDate(int month, int day) {
    char date_str[8];
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
