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
#include "../debug/log_system.h"

static const char* TAG = "DISPLAY";

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
    ESP_LOGI(TAG, "Using default pins for %s", getChipDescription().c_str());
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

    ESP_LOGI(TAG, "===============================================");
    ESP_LOGI(TAG, "Initialization starting...");
    ESP_LOGI(TAG, "Board type: %s", getChipDescription().c_str());
    Serial.flush();
    yield(); // Feed watchdog

    // Validate pin configuration
    if (!pins.isValid()) {
        ESP_LOGE(TAG, "Invalid pin configuration");
        return false;
    }

    // Matrix configuration
    HUB75_I2S_CFG mxconfig(
        PANEL_RES_X,   // 64 pixels wide
        PANEL_RES_Y,   // 32 pixels tall
        PANEL_CHAIN    // 1 panel
    );

    // Apply pin configuration from runtime settings
    ESP_LOGI(TAG, "Applying runtime pin configuration");
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

    ESP_LOGI(TAG, "Pins: R1=%d G1=%d B1=%d R2=%d G2=%d B2=%d",
                  pins.r1, pins.g1, pins.b1, pins.r2, pins.g2, pins.b2);
    ESP_LOGI(TAG, "Pins: A=%d B=%d C=%d D=%d E=%d CLK=%d LAT=%d OE=%d",
                  pins.a, pins.b, pins.c, pins.d, pins.e, pins.clk, pins.lat, pins.oe);

    mxconfig.clkphase = false;
    mxconfig.driver = HUB75_I2S_CFG::FM6126A;
    // Reduce visible flicker: higher refresh + stable latch blanking
    mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_20M;
    mxconfig.min_refresh_rate = 120;
    mxconfig.latch_blanking = 1;

    ESP_LOGI(TAG, "Creating DMA display object...");
    dma_display = new MatrixPanel_I2S_DMA(mxconfig);

    if (!dma_display) {
        ESP_LOGE(TAG, "Failed to allocate display object");
        return false;
    }

    ESP_LOGI(TAG, "Calling begin() on display...");
    if (!dma_display->begin()) {
        ESP_LOGE(TAG, "Display begin() failed");
        delete dma_display;
        dma_display = nullptr;
        return false;
    }

    ESP_LOGI(TAG, "Setting brightness and clearing screen...");
    brightness = 255;
    dma_display->setBrightness8(brightness);
    dma_display->setTextWrap(false);
    dma_display->clearScreen();

    dma_display->fillScreen(dma_display->color444(0, 0, 0));
    dma_display->setTextSize(1);
    dma_display->setTextColor(dma_display->color444(0, 15, 15));
    dma_display->setCursor(8, 12);
    dma_display->print("WEBEX");

    ESP_LOGI(TAG, "Initialization complete");
    ESP_LOGI(TAG, "Matrix size: %dx%d pixels", MATRIX_WIDTH, MATRIX_HEIGHT);
    ESP_LOGI(TAG, "Brightness: %d/255", brightness);
    ESP_LOGI(TAG, "===============================================");
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
