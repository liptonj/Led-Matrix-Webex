/**
 * @file matrix_display.cpp
 * @brief LED Matrix Display Driver Implementation
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
    // Configure HUB75 pins for ESP32-S3
    HUB75_I2S_CFG::i2s_pins _pins = {
        42, // R1
        41, // G1
        40, // B1
        38, // R2
        39, // G2
        37, // B2
        45, // A
        36, // B
        48, // C
        35, // D
        21, // E
        2,  // CLK
        47, // LAT
        14  // OE
    };

    // Matrix configuration
    HUB75_I2S_CFG mxconfig(
        PANEL_RES_X,   // width
        PANEL_RES_Y,   // height
        PANEL_CHAIN,   // chain length
        _pins          // pin configuration
    );

    // Configure for 1/16 scan panel
    mxconfig.driver = HUB75_I2S_CFG::FM6126A;
    mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_10M;
    mxconfig.clkphase = false;

    // Create display instance
    dma_display = new MatrixPanel_I2S_DMA(mxconfig);

    if (!dma_display->begin()) {
        Serial.println("[DISPLAY] Failed to initialize matrix!");
        return false;
    }

    dma_display->setBrightness8(brightness);
    dma_display->clearScreen();

    initialized = true;
    Serial.println("[DISPLAY] Matrix initialized successfully");
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

        // y=16: Separator
        dma_display->drawFastHLine(0, 16, MATRIX_WIDTH, COLOR_GRAY);

        // y=17-24: Date and Time in status color
        if (data.time_valid) {
            String datetime = formatDate(data.month, data.day) + " " + formatTime(data.hour, data.minute);
            drawCenteredText(18, datetime, status_color);
        }

        // y=25: Separator
        dma_display->drawFastHLine(0, 25, MATRIX_WIDTH, COLOR_GRAY);

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

    dma_display->clearScreen();
    drawText(4, 2, "SETUP", COLOR_YELLOW);
    drawSmallText(2, 12, "Connect to:", COLOR_WHITE);
    drawSmallText(2, 19, "Webex-Setup", COLOR_CYAN);
    drawSmallText(2, 26, ip_address, COLOR_GREEN);
}

void MatrixDisplay::showConnecting(const String& ssid) {
    if (!initialized) return;

    dma_display->clearScreen();
    drawText(2, 8, "Connecting", COLOR_YELLOW);

    String short_ssid = ssid;
    if (short_ssid.length() > 12) {
        short_ssid = short_ssid.substring(0, 12);
    }
    drawSmallText(2, 20, short_ssid, COLOR_WHITE);
}

void MatrixDisplay::showConnected(const String& ip_address) {
    if (!initialized) return;

    dma_display->clearScreen();
    drawText(4, 8, "Connected!", COLOR_GREEN);
    drawSmallText(2, 22, ip_address, COLOR_WHITE);
    delay(2000);
}

void MatrixDisplay::showUpdating(const String& version) {
    if (!initialized) return;

    dma_display->clearScreen();
    drawText(4, 4, "UPDATING", COLOR_ORANGE);
    drawSmallText(2, 16, "Installing:", COLOR_WHITE);
    drawSmallText(2, 24, version, COLOR_CYAN);
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
