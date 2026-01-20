/**
 * @file bootstrap_display.cpp
 * @brief Minimal LED Matrix Display Implementation
 */

#include "bootstrap_display.h"

BootstrapDisplay::BootstrapDisplay()
    : dma_display(nullptr), initialized(false) {
}

BootstrapDisplay::~BootstrapDisplay() {
    if (dma_display) {
        delete dma_display;
    }
}

bool BootstrapDisplay::begin() {
    Serial.println("[DISPLAY] Initializing LED matrix...");

    // Configure HUB75 pins based on board type
#if defined(ESP32_S3_BOARD)
    // Seengreat adapter pin configuration for ESP32-S3
    HUB75_I2S_CFG::i2s_pins _pins = {
        37, 6, 36,    // R1, G1, B1
        35, 5, 0,     // R2, G2, B2
        45, 1, 48, 2, 4,  // A, B, C, D, E
        38, 21, 47    // LAT, OE, CLK (struct order is lat, oe, clk)
    };
#else
    // ESP32 (standard) pin configuration
    HUB75_I2S_CFG::i2s_pins _pins = {
        25, // R1
        26, // G1
        27, // B1
        14, // R2
        12, // G2
        13, // B2
        23, // A
        19, // B
        5,  // C
        17, // D
        32, // E
        16, // CLK
        4,  // LAT
        15  // OE
    };
#endif

    // Matrix configuration
    HUB75_I2S_CFG mxconfig(
        PANEL_RES_X,
        PANEL_RES_Y,
        PANEL_CHAIN,
        _pins
    );

    // Configure for FM6126A driver (common in these panels)
    mxconfig.driver = HUB75_I2S_CFG::FM6126A;
    // Reduce visible flicker: higher refresh + stable latch blanking
    mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_20M;
    mxconfig.min_refresh_rate = 120;
    mxconfig.latch_blanking = 1;
    mxconfig.clkphase = false;

    // Create display instance
    dma_display = new MatrixPanel_I2S_DMA(mxconfig);

    if (!dma_display->begin()) {
        Serial.println("[DISPLAY] Failed to initialize matrix!");
        delete dma_display;
        dma_display = nullptr;
        return false;
    }

    dma_display->setBrightness8(255);

    initialized = true;
    Serial.println("[DISPLAY] Matrix initialized successfully");
    return true;
}

void BootstrapDisplay::clear() {
    if (!initialized) return;
    dma_display->clearScreen();
}

void BootstrapDisplay::drawText(int x, int y, const String& text, uint16_t color) {
    if (!initialized) return;
    dma_display->setTextColor(color);
    dma_display->setTextSize(1);
    dma_display->setCursor(x, y);
    dma_display->print(text);
}

void BootstrapDisplay::drawSmallText(int x, int y, const String& text, uint16_t color) {
    // Using same size for simplicity (font is already small)
    drawText(x, y, text, color);
}

void BootstrapDisplay::drawCenteredText(int y, const String& text, uint16_t color) {
    if (!initialized) return;
    // Each character is ~6 pixels wide
    int textWidth = text.length() * 6;
    int x = (MATRIX_WIDTH - textWidth) / 2;
    if (x < 0) x = 0;
    drawText(x, y, text, color);
}

void BootstrapDisplay::drawProgressBar(int y, int progress, uint16_t color) {
    if (!initialized) return;
    
    // Draw progress bar background
    int barWidth = MATRIX_WIDTH - 8;
    int barHeight = 6;
    int x = 4;
    
    // Background
    dma_display->drawRect(x, y, barWidth, barHeight, COLOR_GRAY);
    
    // Fill
    int fillWidth = (progress * (barWidth - 2)) / 100;
    if (fillWidth > 0) {
        dma_display->fillRect(x + 1, y + 1, fillWidth, barHeight - 2, color);
    }
}

void BootstrapDisplay::showBootstrap(const char* version) {
    if (!initialized) return;
    
    dma_display->clearScreen();
    
    // Title
    drawCenteredText(2, "BOOTSTRAP", COLOR_CYAN);
    
    // Separator
    dma_display->drawFastHLine(0, 10, MATRIX_WIDTH, COLOR_GRAY);
    
    // Status
    drawCenteredText(13, "LOADING...", COLOR_YELLOW);
    
    // Version
    char ver_str[16];
    snprintf(ver_str, sizeof(ver_str), "v%s", version);
    drawCenteredText(24, ver_str, COLOR_GRAY);
}

void BootstrapDisplay::showAPMode(const String& ssid, const String& ip) {
    if (!initialized) return;
    
    dma_display->clearScreen();
    
    // Title
    drawCenteredText(0, "SETUP MODE", COLOR_YELLOW);
    
    // Separator
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);
    
    // WiFi info
    drawText(2, 10, "WiFi:", COLOR_WHITE);
    
    // SSID (may need truncation)
    String displaySSID = ssid;
    if (displaySSID.length() > 10) {
        displaySSID = displaySSID.substring(0, 10);
    }
    drawText(2, 17, displaySSID, COLOR_CYAN);
    
    // IP address
    drawText(2, 25, ip, COLOR_GREEN);
}

void BootstrapDisplay::showConnecting(const String& ssid) {
    if (!initialized) return;
    
    dma_display->clearScreen();
    
    drawCenteredText(4, "CONNECTING", COLOR_YELLOW);
    
    dma_display->drawFastHLine(0, 12, MATRIX_WIDTH, COLOR_GRAY);
    
    String displaySSID = ssid;
    if (displaySSID.length() > 10) {
        displaySSID = displaySSID.substring(0, 10);
    }
    drawCenteredText(16, displaySSID, COLOR_WHITE);
    
    drawCenteredText(25, "Please wait", COLOR_GRAY);
}

void BootstrapDisplay::showConnected(const String& ip, const String& hostname) {
    if (!initialized) return;
    
    dma_display->clearScreen();
    
    // Title
    drawCenteredText(0, "CONNECTED", COLOR_GREEN);
    
    // Separator
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);
    
    // IP address
    drawText(2, 10, "IP:", COLOR_WHITE);
    drawText(20, 10, ip, COLOR_CYAN);
    
    // mDNS hostname
    drawText(2, 18, "mDNS:", COLOR_WHITE);
    String displayHost = hostname;
    if (displayHost.length() > 8) {
        displayHost = displayHost.substring(0, 8);
    }
    drawText(2, 25, displayHost + ".local", COLOR_GREEN);
}

void BootstrapDisplay::showOTAProgress(int progress, const String& message) {
    if (!initialized) return;
    
    dma_display->clearScreen();
    
    // Title
    drawCenteredText(0, "UPDATING", COLOR_ORANGE);
    
    // Separator
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);
    
    // Progress bar
    drawProgressBar(12, progress, COLOR_CYAN);
    
    // Percentage
    char pct_str[8];
    snprintf(pct_str, sizeof(pct_str), "%d%%", progress);
    drawCenteredText(20, pct_str, COLOR_WHITE);
    
    // Status message (truncate if needed)
    String displayMsg = message;
    if (displayMsg.length() > 10) {
        displayMsg = displayMsg.substring(0, 10);
    }
    drawCenteredText(27, displayMsg, COLOR_GRAY);
}

void BootstrapDisplay::showError(const String& error) {
    if (!initialized) return;
    
    dma_display->clearScreen();
    
    drawCenteredText(4, "ERROR", COLOR_RED);
    
    dma_display->drawFastHLine(0, 12, MATRIX_WIDTH, COLOR_GRAY);
    
    // Wrap error message if needed
    String displayError = error;
    if (displayError.length() > 10) {
        // Show first part
        drawCenteredText(15, displayError.substring(0, 10), COLOR_WHITE);
        if (displayError.length() > 20) {
            drawCenteredText(23, displayError.substring(10, 20), COLOR_WHITE);
        } else {
            drawCenteredText(23, displayError.substring(10), COLOR_WHITE);
        }
    } else {
        drawCenteredText(18, displayError, COLOR_WHITE);
    }
}

void BootstrapDisplay::showStatus(const String& line1, const String& line2, const String& line3) {
    if (!initialized) return;
    
    dma_display->clearScreen();
    
    if (!line1.isEmpty()) {
        drawCenteredText(4, line1, COLOR_CYAN);
    }
    
    if (!line2.isEmpty()) {
        dma_display->drawFastHLine(0, 12, MATRIX_WIDTH, COLOR_GRAY);
        drawCenteredText(15, line2, COLOR_WHITE);
    }
    
    if (!line3.isEmpty()) {
        drawCenteredText(24, line3, COLOR_GREEN);
    }
}
