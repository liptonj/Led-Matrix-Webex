/**
 * @file matrix_display.cpp
 * @brief LED Matrix Display Driver Core Implementation
 *
 * This file contains the core display functionality:
 * - Hardware initialization
 * - Display lifecycle management
 * - Brightness and scroll speed settings
 *
 * Drawing primitives are in: display_primitives.cpp
 * Formatting utilities are in: display_utils.cpp
 * Font data is in: display_fonts.h
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

void MatrixDisplay::setPageIntervalMs(uint16_t interval_ms) {
    page_interval_ms = interval_ms;
}
