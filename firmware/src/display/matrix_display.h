/**
 * @file matrix_display.h
 * @brief LED Matrix Display Driver Header
 */

#ifndef MATRIX_DISPLAY_H
#define MATRIX_DISPLAY_H

#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

// Matrix configuration
#define MATRIX_WIDTH 64
#define MATRIX_HEIGHT 32
#define PANEL_RES_X 64
#define PANEL_RES_Y 32
#define PANEL_CHAIN 1

// Colors (RGB565 format)
#define COLOR_BLACK     0x0000
#define COLOR_WHITE     0xFFFF
#define COLOR_RED       0xF800
#define COLOR_GREEN     0x07E0
#define COLOR_BLUE      0x001F
#define COLOR_YELLOW    0xFFE0
#define COLOR_ORANGE    0xFD20
#define COLOR_PURPLE    0x8010
#define COLOR_CYAN      0x07FF
#define COLOR_GRAY      0x8410

// Status colors
#define COLOR_ACTIVE    0x07E0  // Green
#define COLOR_AWAY      0xFFE0  // Yellow
#define COLOR_DND       0xF800  // Red
#define COLOR_BUSY      0xF800  // Red
#define COLOR_OFFLINE   0x8410  // Gray
#define COLOR_OOO       0x8010  // Purple

/**
 * @brief Display data structure
 */
struct DisplayData {
    String webex_status = "unknown";
    String display_name = "";
    bool camera_on = false;
    bool mic_muted = false;
    bool in_call = false;
    bool show_call_status = false;
    float temperature = 0.0f;
    float humidity = 0.0f;
    String door_status = "";
    int air_quality_index = 0;      // Air quality as numeric value (0-500)
    bool show_sensors = false;
    bool wifi_connected = false;
    bool bridge_connected = false;
    // Time and date
    int hour = 0;                   // 0-23
    int minute = 0;                 // 0-59
    int day = 0;                    // 1-31
    int month = 0;                  // 1-12
    bool time_valid = false;        // True if time has been synced
};

/**
 * @brief Matrix Display Driver Class
 */
class MatrixDisplay {
public:
    MatrixDisplay();
    ~MatrixDisplay();

    /**
     * @brief Initialize the display
     * @return true on success
     */
    bool begin();

    /**
     * @brief Update display with current data
     * @param data Display data structure
     */
    void update(const DisplayData& data);

    /**
     * @brief Show startup screen
     * @param version Firmware version string
     */
    void showStartupScreen(const char* version);

    /**
     * @brief Show AP mode screen
     * @param ip_address AP IP address
     */
    void showAPMode(const String& ip_address);

    /**
     * @brief Show connecting screen
     * @param ssid WiFi SSID
     */
    void showConnecting(const String& ssid);

    /**
     * @brief Show connected screen
     * @param ip_address Device IP address
     */
    void showConnected(const String& ip_address);

    /**
     * @brief Show updating screen
     * @param version New version being installed
     */
    void showUpdating(const String& version);

    /**
     * @brief Show setup screen with hostname for embedded app access
     * @param hostname Device hostname (e.g., "webex-display.local")
     */
    void showSetupHostname(const String& hostname);

    /**
     * @brief Show waiting for Webex connection screen
     * @param hostname Device hostname for embedded app
     */
    void showWaitingForWebex(const String& hostname);

    /**
     * @brief Clear the display
     */
    void clear();

    /**
     * @brief Set display brightness
     * @param brightness Brightness level (0-255)
     */
    void setBrightness(uint8_t brightness);

private:
    MatrixPanel_I2S_DMA* dma_display;
    bool initialized;
    uint8_t brightness;

    // Drawing helpers
    void drawLargeStatusCircle(int center_x, int center_y, uint16_t color);
    void drawStatusIcon(int x, int y, const String& status);
    void drawCameraIcon(int x, int y, bool on);
    void drawMicIcon(int x, int y, bool muted);
    void drawCallIcon(int x, int y);
    void drawWifiIcon(int x, int y, bool connected);
    void drawText(int x, int y, const String& text, uint16_t color);
    void drawSmallText(int x, int y, const String& text, uint16_t color);
    void drawCenteredText(int y, const String& text, uint16_t color);
    void drawSensorBar(const DisplayData& data, int y);
    void drawRect(int x, int y, int w, int h, uint16_t color);
    void fillRect(int x, int y, int w, int h, uint16_t color);
    void drawPixel(int x, int y, uint16_t color);

    uint16_t getStatusColor(const String& status);
    String getStatusText(const String& status);
    String formatTime(int hour, int minute);
    String formatDate(int month, int day);
    String getMonthAbbrev(int month);
};

#endif // MATRIX_DISPLAY_H
