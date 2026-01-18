/**
 * @file bootstrap_display.h
 * @brief Minimal LED Matrix Display for Bootstrap Firmware
 * 
 * Lightweight display driver for showing:
 * - IP address and mDNS hostname
 * - OTA progress
 * - Status messages
 */

#ifndef BOOTSTRAP_DISPLAY_H
#define BOOTSTRAP_DISPLAY_H

#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

// Matrix configuration
#define MATRIX_WIDTH 64
#define MATRIX_HEIGHT 32
#define PANEL_RES_X 64
#define PANEL_RES_Y 32
#define PANEL_CHAIN 1

// Colors (RGB565)
#define COLOR_BLACK   0x0000
#define COLOR_WHITE   0xFFFF
#define COLOR_RED     0xF800
#define COLOR_GREEN   0x07E0
#define COLOR_BLUE    0x001F
#define COLOR_YELLOW  0xFFE0
#define COLOR_CYAN    0x07FF
#define COLOR_ORANGE  0xFD20
#define COLOR_GRAY    0x8410

/**
 * @brief Minimal display class for bootstrap firmware
 */
class BootstrapDisplay {
public:
    BootstrapDisplay();
    ~BootstrapDisplay();

    /**
     * @brief Initialize the display hardware
     * @return true on success
     */
    bool begin();

    /**
     * @brief Check if display is initialized
     */
    bool isInitialized() const { return initialized; }

    /**
     * @brief Clear the display
     */
    void clear();

    /**
     * @brief Show bootstrap mode startup screen
     * @param version Bootstrap firmware version
     */
    void showBootstrap(const char* version);

    /**
     * @brief Show AP mode screen with connection info
     * @param ssid AP SSID to connect to
     * @param ip AP IP address
     */
    void showAPMode(const String& ssid, const String& ip);

    /**
     * @brief Show connecting to WiFi
     * @param ssid Network being connected to
     */
    void showConnecting(const String& ssid);

    /**
     * @brief Show connected screen with IP and hostname
     * @param ip Device IP address
     * @param hostname mDNS hostname (without .local)
     */
    void showConnected(const String& ip, const String& hostname);

    /**
     * @brief Show OTA download progress
     * @param progress Percentage (0-100)
     * @param message Status message
     */
    void showOTAProgress(int progress, const String& message);

    /**
     * @brief Show error message
     * @param error Error message to display
     */
    void showError(const String& error);

    /**
     * @brief Show status message
     * @param line1 First line of text
     * @param line2 Second line of text (optional)
     * @param line3 Third line of text (optional)
     */
    void showStatus(const String& line1, const String& line2 = "", const String& line3 = "");

private:
    MatrixPanel_I2S_DMA* dma_display;
    bool initialized;

    void drawText(int x, int y, const String& text, uint16_t color);
    void drawSmallText(int x, int y, const String& text, uint16_t color);
    void drawCenteredText(int y, const String& text, uint16_t color);
    void drawProgressBar(int y, int progress, uint16_t color);
};

#endif // BOOTSTRAP_DISPLAY_H
