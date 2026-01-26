/**
 * @file display_status.cpp
 * @brief Display Status Page Rendering
 *
 * Contains the main update() method and page-specific drawing functions.
 * Uses a line-key caching system to minimize redraws and reduce flicker.
 */

#include "matrix_display.h"

// Constants for layout
static const int INDICATOR_X = 1;
static const int INDICATOR_Y = 1;
static const int TEXT_START_X = 8;  // After 6px indicator + 2px gap

// Line positions
static const int LINE_0_Y = 0;
static const int LINE_1_Y = 8;
static const int LINE_2_Y = 16;
static const int LINE_3_Y = 24;
static const int LINE_HEIGHT = 8;

/**
 * @brief Build a cache key for date/time line
 */
static String buildDateTimeKey(const DisplayData& data, uint16_t status_color) {
    String key = "time|";
    if (data.time_valid) {
        key += String(data.month) + "/" + String(data.day) + "|";
        key += String(data.hour) + ":" + String(data.minute);
        key += data.use_24h ? "|24" : "|12";
        key += "|" + String(data.date_format);
    } else {
        key += "none";
    }
    key += "|" + String(status_color);
    return key;
}

/**
 * @brief Build a cache key for sensor bar
 */
static String buildSensorKey(const DisplayData& data, const String& prefix) {
    String key = prefix + "|";
    if (data.show_sensors) {
        key += String((int)data.temperature) + "/" + String((int)data.humidity);
        key += "/" + String((int)data.tvoc) + "/" + data.right_metric;
    } else {
        key += "none";
    }
    return key;
}

void MatrixDisplay::drawStatusPage(const DisplayData& data) {
    // Status Page Layout (64x32):
    // Line 0 (y=0):  [●] AVAILABLE     <- 6x6 indicator + scrolling status text
    // Line 1 (y=8):  JAN20  12:30PM    <- Date and time
    // Line 2 (y=16): (display name)    <- Optional display name (scrolls if long)
    // Line 3 (y=24): 72°F 45% T125     <- Compact sensors if available

    uint16_t status_color = getStatusColor(data.webex_status);
    String status_text = getStatusText(data.webex_status);

    // Line 0: Status indicator (cached) + status text (always updated for scrolling)
    const String line0_key = String("indicator|") + data.webex_status;
    if (line0_key != last_line_keys[0]) {
        last_line_keys[0] = line0_key;
        // Only redraw indicator when status changes
        fillRect(0, LINE_0_Y, TEXT_START_X, LINE_HEIGHT, COLOR_BLACK);
        drawStatusIndicator(INDICATOR_X, INDICATOR_Y, data.webex_status);
    }
    // Always update status text (scrolling handles its own timing)
    drawScrollingStatusText(LINE_0_Y, status_text, status_color, TEXT_START_X);

    // Line 1: Date and time
    const String line1_key = buildDateTimeKey(data, status_color);
    if (line1_key != last_line_keys[1]) {
        last_line_keys[1] = line1_key;
        fillRect(0, LINE_1_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        if (data.time_valid) {
            drawDateTimeLine(LINE_1_Y, data, status_color);
        }
    }

    // Line 2: Display name (scrolls if long)
    if (!data.display_name.isEmpty()) {
        drawScrollingText(LINE_2_Y, data.display_name, COLOR_WHITE, MATRIX_WIDTH, "display_name");
    } else {
        const String line2_key = "name|empty";
        if (line2_key != last_line_keys[2]) {
            last_line_keys[2] = line2_key;
            fillRect(0, LINE_2_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        }
    }

    // Line 3: Compact sensor bar (if sensors available)
    const String line3_key = buildSensorKey(data, "sensors");
    if (line3_key != last_line_keys[3]) {
        last_line_keys[3] = line3_key;
        fillRect(0, LINE_3_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        if (data.show_sensors) {
            drawSensorBar(data, LINE_3_Y);
        }
    }
}

void MatrixDisplay::drawSensorPage(const DisplayData& data) {
    // Sensor Page Layout (64x32):
    // Line 0 (y=0):  [●] TMP: 72F      <- 4x4 indicator + temperature
    // Line 1 (y=8):  HUM: 45%          <- Humidity
    // Line 2 (y=16): TVOC: 125         <- TVOC or selected metric
    // Line 3 (y=24): IAQ: 35           <- Air quality index
    // All text uses status color to match indicator

    uint16_t status_color = getStatusColor(data.webex_status);
    int temp_f = (int)((data.temperature * 9.0f / 5.0f) + 32.0f);

    // Smaller indicator position (4x4, centered in 8px line height)
    const int small_indicator_x = 1;
    const int small_indicator_y = 2;  // Vertically centered
    const int sensor_text_x = 6;      // After 4px indicator + 2px gap

    // Line 0: Small status indicator + Temperature
    char temp_str[16];
    snprintf(temp_str, sizeof(temp_str), "TMP: %dF", temp_f);

    const String line0_key = String("sensor0|") + data.webex_status + "|" + String(temp_f);
    if (line0_key != last_line_keys[0]) {
        last_line_keys[0] = line0_key;
        fillRect(0, LINE_0_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        drawSmallStatusIndicator(small_indicator_x, small_indicator_y, data.webex_status);
        drawSmallText(sensor_text_x, LINE_0_Y, temp_str, status_color);
    }

    // Line 1: Humidity
    char humid_str[16];
    snprintf(humid_str, sizeof(humid_str), "HUM: %d%%", (int)data.humidity);

    const String line1_key = String("sensor1|") + data.webex_status + "|" + String((int)data.humidity);
    if (line1_key != last_line_keys[1]) {
        last_line_keys[1] = line1_key;
        fillRect(0, LINE_1_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        drawSmallText(0, LINE_1_Y, humid_str, status_color);
    }

    // Line 2: TVOC or selected metric
    char metric_str[16];
    String metric = data.right_metric;
    metric.toLowerCase();

    if (metric == "co2") {
        snprintf(metric_str, sizeof(metric_str), "CO2: %d", (int)data.co2_ppm);
    } else if (metric == "pm2_5" || metric == "pm2.5") {
        snprintf(metric_str, sizeof(metric_str), "PM2.5: %d", (int)data.pm2_5);
    } else if (metric == "noise") {
        snprintf(metric_str, sizeof(metric_str), "NOISE: %d", (int)data.ambient_noise);
    } else {
        snprintf(metric_str, sizeof(metric_str), "TVOC: %d", (int)data.tvoc);
    }

    const String line2_key = String("sensor2|") + data.webex_status + "|" + metric + "|" + String((int)data.tvoc);
    if (line2_key != last_line_keys[2]) {
        last_line_keys[2] = line2_key;
        fillRect(0, LINE_2_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        drawSmallText(0, LINE_2_Y, metric_str, status_color);
    }

    // Line 3: Air Quality Index
    char iaq_str[16];
    snprintf(iaq_str, sizeof(iaq_str), "IAQ: %d", data.air_quality_index);

    const String line3_key = String("sensor3|") + data.webex_status + "|" + String(data.air_quality_index);
    if (line3_key != last_line_keys[3]) {
        last_line_keys[3] = line3_key;
        fillRect(0, LINE_3_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        drawSmallText(0, LINE_3_Y, iaq_str, status_color);
    }
}

void MatrixDisplay::drawInCallPage(const DisplayData& data) {
    // In-Call Page Layout (64x32):
    // Line 0 (y=0):  [●] IN A CALL     <- 6x6 indicator + call text
    // Line 1 (y=8):  📷 ON  🎤 OFF     <- Camera and mic status
    // Line 2 (y=16): JAN20  12:30PM    <- Date/time
    // Line 3 (y=24): 72°F 45% T125     <- Compact sensors

    uint16_t status_color = getStatusColor(data.webex_status);

    // Line 0: Status indicator + "IN A CALL"
    const String line0_key = String("call0|") + data.webex_status;
    if (line0_key != last_line_keys[0]) {
        last_line_keys[0] = line0_key;
        fillRect(0, LINE_0_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        drawStatusIndicator(INDICATOR_X, INDICATOR_Y, data.webex_status);
        drawSmallText(TEXT_START_X, LINE_0_Y, "IN A CALL", status_color);
    }

    // Line 1: Camera and Mic status
    const String line1_key = String("call1|")
        + (data.camera_on ? "1" : "0")
        + (data.mic_muted ? "1" : "0");

    if (line1_key != last_line_keys[1]) {
        last_line_keys[1] = line1_key;
        fillRect(0, LINE_1_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);

        // Camera icon and status on left
        const int camera_x = 2;
        drawCameraIcon(camera_x, LINE_1_Y, data.camera_on);
        drawSmallText(camera_x + 10, LINE_1_Y, data.camera_on ? "ON" : "OFF",
                      data.camera_on ? COLOR_GREEN : COLOR_RED);

        // Mic icon and status on right
        const int mic_x = 36;
        drawMicIcon(mic_x, LINE_1_Y, data.mic_muted);
        drawSmallText(mic_x + 7, LINE_1_Y, data.mic_muted ? "OFF" : "ON",
                      data.mic_muted ? COLOR_RED : COLOR_GREEN);
    }

    // Line 2: Date/time (reuse helper)
    const String line2_key = "call2|" + buildDateTimeKey(data, status_color);
    if (line2_key != last_line_keys[2]) {
        last_line_keys[2] = line2_key;
        fillRect(0, LINE_2_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        if (data.time_valid) {
            drawDateTimeLine(LINE_2_Y, data, status_color);
        }
    }

    // Line 3: Compact sensor bar (reuse helper)
    const String line3_key = buildSensorKey(data, "call3");
    if (line3_key != last_line_keys[3]) {
        last_line_keys[3] = line3_key;
        fillRect(0, LINE_3_Y, MATRIX_WIDTH, LINE_HEIGHT, COLOR_BLACK);
        if (data.show_sensors) {
            drawSensorBar(data, LINE_3_Y);
        }
    }
}

void MatrixDisplay::update(const DisplayData& data) {
    if (!initialized) return;

    // Don't override display during OTA updates
    if (ota_in_progress) return;

    const unsigned long now = millis();

    // Determine which page to show
    DisplayPage target_page;

    // In-call overrides page rotation
    if (data.show_call_status && data.in_call) {
        target_page = DisplayPage::IN_CALL;
    } else if (data.show_sensors) {
        // Page rotation between status and sensors
        if (now - last_page_change_ms >= page_interval_ms) {
            last_page_change_ms = now;
            current_page = (current_page == DisplayPage::STATUS)
                ? DisplayPage::SENSORS
                : DisplayPage::STATUS;
        }
        target_page = current_page;
    } else {
        // No sensors, just show status
        target_page = DisplayPage::STATUS;
    }

    // Check if page changed - clear screen and reset line keys
    if (target_page != last_page) {
        dma_display->clearScreen();
        for (int i = 0; i < 4; i++) {
            last_line_keys[i].clear();
        }
        last_page = target_page;
    }

    // Draw the current page
    switch (target_page) {
        case DisplayPage::IN_CALL:
            drawInCallPage(data);
            break;
        case DisplayPage::SENSORS:
            drawSensorPage(data);
            break;
        case DisplayPage::STATUS:
        default:
            drawStatusPage(data);
            break;
    }
}
