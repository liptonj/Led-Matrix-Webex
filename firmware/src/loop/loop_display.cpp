/**
 * @file loop_display.cpp
 * @brief Display update handlers
 *
 * Handles LED matrix display updates and rendering.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include <WiFi.h>
#include <time.h>
#include "config/config_manager.h"
#include "display/matrix_display.h"
#include "wifi/wifi_manager.h"
#include "web/web_server.h"

// External globals from main.cpp
extern ConfigManager config_manager;
extern MatrixDisplay matrix_display;
extern WiFiManager wifi_manager;
extern WebServerManager web_server;
extern AppState app_state;

// Forward declaration for extractFirstName (defined in loop_webex.cpp)
// We'll define it here as static since it's used by both files
static String extractFirstName(const String& input) {
    String name = input;
    name.trim();
    if (name.isEmpty()) {
        return name;
    }
    int comma = name.indexOf(',');
    if (comma >= 0) {
        String after = name.substring(comma + 1);
        after.trim();
        if (!after.isEmpty()) {
            name = after;
        }
    }
    int space = name.indexOf(' ');
    if (space > 0) {
        name = name.substring(0, space);
    }
    return name;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * @brief Parse a hex color string to RGB565 format
 */
static uint16_t parseColor565(const String& input, uint16_t fallback) {
    String hex = input;
    hex.trim();
    if (hex.startsWith("#")) {
        hex = hex.substring(1);
    }
    if (hex.startsWith("0x") || hex.startsWith("0X")) {
        hex = hex.substring(2);
    }
    if (hex.length() == 3) {
        String expanded;
        expanded.reserve(6);
        for (size_t i = 0; i < 3; i++) {
            char c = hex[i];
            expanded += c;
            expanded += c;
        }
        hex = expanded;
    }
    if (hex.length() != 6) {
        return fallback;
    }
    char* endptr = nullptr;
    long value = strtol(hex.c_str(), &endptr, 16);
    if (endptr == nullptr || *endptr != '\0') {
        return fallback;
    }
    uint8_t r = (value >> 16) & 0xFF;
    uint8_t g = (value >> 8) & 0xFF;
    uint8_t b = value & 0xFF;
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

// =============================================================================
// DISPLAY UPDATE HANDLER
// =============================================================================

/**
 * @brief Update the LED matrix display
 */
void update_display() {
    static unsigned long last_update = 0;
    static unsigned long last_config_refresh = 0;
    static uint8_t last_brightness = 0;
    static bool brightness_initialized = false;

    struct DisplayConfigCache {
        bool initialized = false;
        uint8_t brightness = 128;
        uint16_t scroll_speed_ms = 60;
        uint16_t page_interval_ms = 5000;
        uint8_t border_width = 1;
        String display_pages;
        String status_layout;
        String display_metric;
        String display_name;
        String display_name_short;
        String device_name;
        String device_name_short;
        uint16_t date_color = COLOR_CYAN;
        uint16_t time_color = COLOR_WHITE;
        uint16_t name_color = COLOR_ORANGE;
        uint16_t metric_color = COLOR_BLUE;
        bool use_24h = false;
        uint8_t date_format = 0;
    };
    static DisplayConfigCache cached;

    // Update display at ~30 FPS
    if (millis() - last_update < 33) {
        return;
    }
    last_update = millis();
    const unsigned long now = millis();
    if (!cached.initialized || now - last_config_refresh >= 1000) {
        last_config_refresh = now;
        cached.initialized = true;
        cached.brightness = config_manager.getBrightness();
        cached.scroll_speed_ms = config_manager.getScrollSpeedMs();
        cached.page_interval_ms = config_manager.getPageIntervalMs();
        cached.border_width = config_manager.getBorderWidth();
        cached.display_pages = config_manager.getDisplayPages();
        cached.status_layout = config_manager.getStatusLayout();
        cached.display_metric = config_manager.getDisplayMetric();
        cached.display_name = config_manager.getDisplayName();
        cached.display_name_short = extractFirstName(cached.display_name);
        cached.device_name = config_manager.getDeviceName();
        cached.device_name_short = extractFirstName(cached.device_name);
        cached.date_color = parseColor565(config_manager.getDateColor(), COLOR_CYAN);
        cached.time_color = parseColor565(config_manager.getTimeColor(), COLOR_WHITE);
        cached.name_color = parseColor565(config_manager.getNameColor(), COLOR_ORANGE);
        cached.metric_color = parseColor565(config_manager.getMetricColor(), COLOR_BLUE);
        cached.use_24h = config_manager.use24HourTime();
        cached.date_format = config_manager.getDateFormatCode();
        
        // Update runtime debug flags
        extern bool g_debug_display;
        extern bool g_debug_realtime;
        g_debug_display = config_manager.getDebugDisplay();
        g_debug_realtime = config_manager.getDebugRealtime();
    }

    if (!brightness_initialized || last_brightness != cached.brightness) {
        last_brightness = cached.brightness;
        brightness_initialized = true;
        matrix_display.setBrightness(cached.brightness);
    }
    matrix_display.setScrollSpeedMs(cached.scroll_speed_ms);
    matrix_display.setPageIntervalMs(cached.page_interval_ms);

    // Show updating screen during OTA file upload
    if (web_server.isOTAUploadInProgress()) {
        matrix_display.showUpdating("Uploading...");
        return;
    }

    // If WiFi is not connected, show appropriate screen
    if (!app_state.wifi_connected) {
        if (wifi_manager.isAPModeActive()) {
            // In AP mode for setup - show AP mode screen
            matrix_display.showAPMode(WiFi.softAPIP().toString());
        } else {
            // WiFi was configured but connection dropped
            matrix_display.showWifiDisconnected();
        }
        return;
    }

    // If Webex is unavailable, keep showing a generic screen with IP
    // Only show unconfigured screen if WiFi is connected but no services are connected
    // Note: Even "unknown" status should be displayed on the status page, not trigger unconfigured screen
    const bool has_app_presence = app_state.embedded_app_connected || app_state.supabase_app_connected;
    if (app_state.wifi_connected &&
        !app_state.xapi_connected &&
        !app_state.webex_authenticated &&
        !app_state.mqtt_connected &&
        !has_app_presence &&
        !app_state.webex_status_received) {
        // Show unconfigured screen only when truly no services are connected
        // Status display will show "unknown" status if webex_status is "unknown"
        const uint16_t unconfigured_scroll = cached.scroll_speed_ms < 60 ? cached.scroll_speed_ms : 60;
        matrix_display.setScrollSpeedMs(unconfigured_scroll);
        matrix_display.showUnconfigured(WiFi.localIP().toString(), cached.device_name);
        return;
    }

    // Build display data
    DisplayData data;
    data.webex_status = app_state.webex_status;
    // Prefer embedded app display name (from Webex SDK), fallback to config, then device name
    if (app_state.embedded_app_connected && !app_state.embedded_app_display_name.isEmpty()) {
        data.display_name = extractFirstName(app_state.embedded_app_display_name);
    } else if (!cached.display_name_short.isEmpty()) {
        data.display_name = cached.display_name_short;
    } else {
        // Fallback to device name if no display name is configured
        data.display_name = cached.device_name_short;
    }
    data.camera_on = app_state.camera_on;
    data.mic_muted = app_state.mic_muted;
    data.in_call = app_state.in_call;
    // Show call status when we have camera/mic info (xAPI) OR when in a call from any source
    data.show_call_status = app_state.xapi_connected || app_state.embedded_app_connected || app_state.in_call;
    data.temperature = app_state.temperature;
    data.humidity = app_state.humidity;
    data.door_status = app_state.door_status;
    data.air_quality_index = app_state.air_quality_index;
    data.tvoc = app_state.tvoc;
    data.co2_ppm = app_state.co2_ppm;
    data.pm2_5 = app_state.pm2_5;
    data.ambient_noise = app_state.ambient_noise;
    data.right_metric = cached.display_metric;
    data.show_sensors = app_state.mqtt_connected && app_state.sensor_data_valid;
    const String& page_mode = cached.display_pages;
    if (page_mode == "status") {
        data.page_mode = DisplayPageMode::STATUS_ONLY;
    } else if (page_mode == "sensors") {
        data.page_mode = DisplayPageMode::SENSORS_ONLY;
    } else {
        data.page_mode = DisplayPageMode::ROTATE;
    }
    const String& status_layout = cached.status_layout;
    data.status_layout = (status_layout == "name") ? StatusLayoutMode::NAME : StatusLayoutMode::SENSORS;
    data.border_width = cached.border_width;
    data.date_color = cached.date_color;
    data.time_color = cached.time_color;
    data.name_color = cached.name_color;
    data.metric_color = cached.metric_color;

    // Connection indicators
    data.wifi_connected = app_state.wifi_connected;

    // Get current time (cache once per second)
    static struct tm last_timeinfo;
    static bool has_time = false;
    static unsigned long last_time_check_ms = 0;
    if (millis() - last_time_check_ms >= 1000) {
        last_time_check_ms = millis();
        struct tm timeinfo;
        if (getLocalTime(&timeinfo)) {
            last_timeinfo = timeinfo;
            has_time = true;
            app_state.time_synced = true;
        } else if (!app_state.time_synced) {
            has_time = false;
        }
    }
    if (has_time) {
        data.hour = last_timeinfo.tm_hour;
        data.minute = last_timeinfo.tm_min;
        data.day = last_timeinfo.tm_mday;
        data.month = last_timeinfo.tm_mon + 1;  // tm_mon is 0-11
        data.time_valid = true;
    }
    data.use_24h = cached.use_24h;
    data.date_format = cached.date_format;

    matrix_display.update(data);
}

void handleDisplayUpdate(LoopContext& ctx) {
    update_display();
}

#endif // !NATIVE_BUILD
