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
    
    // Row 1: Status icon and name (y=0-10)
    drawStatusIcon(2, 2, data.webex_status);
    
    // Display name or status text
    String display_text = data.display_name.isEmpty() ? 
                         getStatusText(data.webex_status) : data.display_name;
    if (display_text.length() > 10) {
        display_text = display_text.substring(0, 10);
    }
    drawText(14, 2, display_text, COLOR_WHITE);
    
    // Row 2: Call status (y=11-16)
    if (data.show_call_status) {
        int x_pos = 2;
        
        if (data.in_call) {
            drawCallIcon(x_pos, 12);
            x_pos += 12;
        }
        
        drawCameraIcon(x_pos, 12, data.camera_on);
        x_pos += 12;
        
        drawMicIcon(x_pos, 12, data.mic_muted);
    } else {
        // Show connection status
        drawWifiIcon(2, 12, data.wifi_connected);
        if (data.bridge_connected) {
            drawSmallText(14, 12, "BRIDGE", COLOR_GREEN);
        }
    }
    
    // Horizontal separator
    dma_display->drawFastHLine(0, 17, MATRIX_WIDTH, COLOR_GRAY);
    
    // Row 3-4: Sensor data (y=18-31)
    if (data.show_sensors) {
        // Temperature and Humidity
        char temp_str[16];
        snprintf(temp_str, sizeof(temp_str), "%.0fF", (data.temperature * 9.0f / 5.0f) + 32.0f);
        drawSmallText(2, 19, temp_str, COLOR_CYAN);
        
        char humid_str[16];
        snprintf(humid_str, sizeof(humid_str), "%.0f%%", data.humidity);
        drawSmallText(32, 19, humid_str, COLOR_CYAN);
        
        // Door and Air Quality
        if (!data.door_status.isEmpty()) {
            uint16_t door_color = (data.door_status == "open") ? COLOR_YELLOW : COLOR_GREEN;
            drawSmallText(2, 26, data.door_status, door_color);
        }
        
        if (!data.air_quality.isEmpty()) {
            uint16_t aq_color = COLOR_GREEN;
            if (data.air_quality == "moderate") aq_color = COLOR_YELLOW;
            else if (data.air_quality == "poor") aq_color = COLOR_RED;
            drawSmallText(32, 26, data.air_quality, aq_color);
        }
    } else {
        // Show status when no sensors
        drawSmallText(2, 22, getStatusText(data.webex_status), getStatusColor(data.webex_status));
    }
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
    if (status == "active") return "Active";
    if (status == "inactive") return "Away";
    if (status == "DoNotDisturb" || status == "dnd") return "DND";
    if (status == "busy") return "Busy";
    if (status == "meeting") return "In Meeting";
    if (status == "OutOfOffice" || status == "ooo") return "OOO";
    if (status == "pending") return "Pending";
    return "Offline";
}
