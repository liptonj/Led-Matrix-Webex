/**
 * @file matrix_display.h
 * @brief LED Matrix Display Driver Header
 */

#ifndef MATRIX_DISPLAY_H
#define MATRIX_DISPLAY_H

#include <Arduino.h>
#include "display_config.h"
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include "../config/config_manager.h"

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
#define COLOR_PRESENTING 0xF81F // Magenta for presenting/sharing

// Page rotation
#define DEFAULT_PAGE_INTERVAL_MS 5000  // 5 seconds between pages

/**
 * @brief Display page types
 */
enum class DisplayPage : uint8_t {
    STATUS = 0,    // Status with date/time
    SENSORS = 1,   // Sensor data page
    IN_CALL = 2    // In-call with camera/mic status
};

enum class DisplayPageMode : uint8_t {
    STATUS_ONLY = 0,
    SENSORS_ONLY = 1,
    ROTATE = 2
};

enum class StatusLayoutMode : uint8_t {
    NAME = 0,     // Display name uses full line, sensors on separate page
    SENSORS = 1   // Sensor bar inline, name shown in tiny text when space allows
};

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
    float tvoc = 0.0f;              // TVOC in ppb
    float co2_ppm = 0.0f;
    float pm2_5 = 0.0f;
    float ambient_noise = 0.0f;
    String right_metric = "tvoc";
    bool show_sensors = false;
    DisplayPageMode page_mode = DisplayPageMode::ROTATE;
    StatusLayoutMode status_layout = StatusLayoutMode::SENSORS;
    bool wifi_connected = false;
    uint8_t border_width = 1;         // Status border width (1-3 pixels)
    uint16_t date_color = COLOR_CYAN;
    uint16_t time_color = COLOR_WHITE;
    uint16_t name_color = COLOR_ORANGE;
    uint16_t metric_color = COLOR_BLUE;
    // Time and date
    int hour = 0;                   // 0-23
    int minute = 0;                 // 0-59
    int day = 0;                    // 1-31
    int month = 0;                  // 1-12
    bool time_valid = false;        // True if time has been synced
    bool use_24h = true;
    uint8_t date_format = 0;        // 0=mdy, 1=dmy, 2=numeric
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
     * @brief Show fallback screen when Webex is unavailable
     * @param ip_address Device IP address
     */
    void showUnconfigured(const String& ip_address, const String& hostname = "");

    /**
     * @brief Show WiFi disconnected screen
     */
    void showWifiDisconnected();

    /**
     * @brief Show Improv provisioning screen (waiting for WiFi setup via Web Serial)
     */
    void showImprovProvisioning();

    /**
     * @brief Show connected screen with IP and hostname
     * @param ip_address Device IP address
     * @param hostname Device mDNS hostname (optional)
     */
    void showConnected(const String& ip_address, const String& hostname = "");

    /**
     * @brief Show updating screen
     * @param version New version being installed
     */
    void showUpdating(const String& version);
    
    /**
     * @brief Show updating screen with progress bar
     * @param version New version being installed
     * @param progress Progress percentage (0-100)
     * @param status Status message (e.g., "Downloading firmware...")
     */
    void showUpdatingProgress(const String& version, int progress, const String& status);

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
     * @brief Show pairing code for app connection
     * @param code 6-character pairing code
     * @param hub_url Optional hub URL to display
     */
    void showPairingCode(const String& code, const String& hub_url = "");

    /**
     * @brief Clear the display
     */
    void clear();

    /**
     * @brief Set display brightness
     * @param brightness Brightness level (0-255)
     */
    void setBrightness(uint8_t brightness);
    void setScrollSpeedMs(uint16_t speed_ms);
    void setPageIntervalMs(uint16_t interval_ms);

private:
    // Page rendering
    void drawStatusPage(const DisplayData& data);
    void drawSensorPage(const DisplayData& data);
    void drawInCallPage(const DisplayData& data);
    void drawStatusIndicator(int x, int y, const String& status);
    void drawSmallStatusIndicator(int x, int y, const String& status);
    void drawScrollingStatusText(int y, const String& text, uint16_t color, int start_x);
    MatrixPanel_I2S_DMA* dma_display;
    bool initialized;
    uint8_t brightness;
    uint16_t scroll_speed_ms = DEFAULT_SCROLL_SPEED_MS;

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
    void drawScrollingText(int y, const String& text, uint16_t color, int max_width, const String& key);
    void drawScrollingText(int y, const String& text, uint16_t color, int start_x, int max_width, const String& key);
    void drawTextAutoScroll(int y, const String& text, uint16_t color, int content_x, int content_width, const String& key);
    void drawTinyScrollingText(int y, const String& text, uint16_t color, int start_x, int max_width, const String& key);
    int getTextLineY(uint8_t line_index, uint8_t line_height) const;
    int getTextLineY(uint8_t line_index, uint8_t line_height, int top_offset) const;
    String normalizeIpText(const String& input);
    String sanitizeSingleLine(const String& input);
    void drawSensorBar(const DisplayData& data, int y);
    void drawSensorBar(const DisplayData& data, int y, int content_x, int content_width);
    void drawRect(int x, int y, int w, int h, uint16_t color);
    void fillRect(int x, int y, int w, int h, uint16_t color);
    void drawPixel(int x, int y, uint16_t color);
    void drawStatusBorder(uint16_t color, uint8_t width);
    void drawDateTimeLine(int y, const DisplayData& data, uint16_t date_color, uint16_t time_color);
    void drawDateTimeLine(int y, const DisplayData& data, uint16_t date_color, uint16_t time_color,
                          int content_x, int content_width);
    void drawTinyText(int x, int y, const String& text, uint16_t color);
    void drawTinyChar(int x, int y, char c, uint16_t color);
    int tinyTextWidth(const String& text) const;
    bool isTinyRenderable(const String& text) const;

    uint16_t getStatusColor(const String& status);
    String getStatusText(const String& status);
    String formatTime(int hour, int minute);
    String formatTime24(int hour, int minute);
    String formatDate(int month, int day, uint8_t format);
    String getMonthAbbrev(int month);

    struct ScrollState {
        String text;
        int offset = 0;
        unsigned long last_ms = 0;
        uint16_t color = 0;
    };

    // Dynamic scroll states for different text elements
    static const int MAX_SCROLL_STATES = 16;
    struct ScrollEntry {
        String key;
        ScrollState state;
        bool active = false;
    };
    ScrollEntry scroll_states[MAX_SCROLL_STATES];
    ScrollState* getScrollState(const String& key);
    
    ScrollState status_scroll;  // For scrolling status text (used by drawScrollingStatusText)
    String last_static_key;
    unsigned long last_static_ms = 0;
    String last_line_keys[4];
    String last_render_key;
    unsigned long last_render_ms = 0;
    bool last_in_call_layout = false;
    
    // Page rotation state
    DisplayPage current_page = DisplayPage::STATUS;
    unsigned long last_page_change_ms = 0;
    uint16_t page_interval_ms = DEFAULT_PAGE_INTERVAL_MS;
    DisplayPage last_page = DisplayPage::STATUS;
    
    // OTA update lock - prevents other display updates during OTA
    bool ota_in_progress = false;
    
public:
    /**
     * @brief Lock display for OTA updates (prevents other updates)
     */
    void lockForOTA() { ota_in_progress = true; }
    
    /**
     * @brief Unlock display after OTA completes
     */
    void unlockFromOTA() { ota_in_progress = false; }
    
    /**
     * @brief Check if display is locked for OTA
     */
    bool isOTALocked() const { return ota_in_progress; }
};

#endif // MATRIX_DISPLAY_H
