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
#include "../config/pin_config.h"
#include "../common/board_utils.h"

MatrixDisplay::MatrixDisplay()
    : dma_display(nullptr), initialized(false), brightness(128) {
}

MatrixDisplay::~MatrixDisplay() {
    if (dma_display) {
        delete dma_display;
    }
}

bool MatrixDisplay::begin() {
    // Use default pins for the detected board type
    PinConfig pins = getDefaultPinsForBoard();
    Serial.printf("[DISPLAY] Using default pins for %s\n", getChipDescription().c_str());
    return begin(pins);
}

bool MatrixDisplay::begin(const PinConfig& pins) {
    // Don't call Serial.begin() here - main.cpp already did it
    delay(10);

    if (dma_display) {
        delete dma_display;
        dma_display = nullptr;
        initialized = false;
    }

    Serial.println("===============================================");
    Serial.println("[DISPLAY] Initialization starting...");
    Serial.printf("[DISPLAY] Board type: %s\n", getChipDescription().c_str());
    Serial.flush();
    yield(); // Feed watchdog

    // Validate pin configuration
    if (!pins.isValid()) {
        Serial.println("[DISPLAY] ERROR: Invalid pin configuration");
        return false;
    }

    // Matrix configuration
    HUB75_I2S_CFG mxconfig(
        PANEL_RES_X,   // 64 pixels wide
        PANEL_RES_Y,   // 32 pixels tall
        PANEL_CHAIN    // 1 panel
    );

    // Apply pin configuration from runtime settings
    Serial.println("[DISPLAY] Applying runtime pin configuration");
    mxconfig.gpio.r1 = pins.r1;
    mxconfig.gpio.g1 = pins.g1;
    mxconfig.gpio.b1 = pins.b1;
    mxconfig.gpio.r2 = pins.r2;
    mxconfig.gpio.g2 = pins.g2;
    mxconfig.gpio.b2 = pins.b2;
    mxconfig.gpio.a = pins.a;
    mxconfig.gpio.b = pins.b;
    mxconfig.gpio.c = pins.c;
    mxconfig.gpio.d = pins.d;
    mxconfig.gpio.e = pins.e;  // Can be -1 for 1/16 scan panels
    mxconfig.gpio.lat = pins.lat;
    mxconfig.gpio.oe = pins.oe;
    mxconfig.gpio.clk = pins.clk;

    Serial.printf("[DISPLAY] Pins: R1=%d G1=%d B1=%d R2=%d G2=%d B2=%d\n",
                  pins.r1, pins.g1, pins.b1, pins.r2, pins.g2, pins.b2);
    Serial.printf("[DISPLAY] Pins: A=%d B=%d C=%d D=%d E=%d CLK=%d LAT=%d OE=%d\n",
                  pins.a, pins.b, pins.c, pins.d, pins.e, pins.clk, pins.lat, pins.oe);

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
