/**
 * @file display_status.cpp
 * @brief Display Status Page Rendering
 *
 * Contains the main update() method and page-specific drawing functions.
 * Uses a line-key caching system to minimize redraws and reduce flicker.
 * Status is indicated by a colored border around the entire display.
 */

#include "matrix_display.h"
#include "../debug/log_system.h"

static const char* TAG = "DISP_STATUS";

void MatrixDisplay::drawStatusPage(const DisplayData& data) {
    // Status Page Layout (64x32) with colored border:
    // Border: Status-colored border around entire display (1-3 pixels)
    // Line 0: AVAILABLE           <- Centered status text
    // Line 1: JAN20  12:30PM      <- Date and time (custom colors) - with extra spacing
    // Line 2: (display name)      <- Optional display name (scrolls if long)
    // Line 3: 72°F 45% T125       <- Compact sensors if available

    uint16_t status_color = getStatusColor(data.webex_status);
    String status_text = getStatusText(data.webex_status);
    const uint16_t date_color = data.date_color;
    const uint16_t time_color = data.time_color;
    const uint16_t name_color = data.name_color;

    // Calculate content area and layout
    const int border = clampBorderWidth(data.border_width);
    int content_x, content_width;
    calculateContentArea(border, content_x, content_width);

    int available_height, max_lines;
    calculateAvailableHeight(border, available_height, max_lines);
    const int extra_date_spacing = calculateExtraSpacing(available_height);

    int line0_y, line1_y, line2_y, line3_y;
    calculateLinePositions(border, extra_date_spacing, line0_y, line1_y, line2_y, line3_y);

    // Draw border (cached - only redraw when status or width changes)
    bool border_changed = updateBorderCache(status_color, border, data.webex_status, data.status_layout);
    if (border_changed) {
        // Force redraw of all content when border changes
        clearPageCache();
        clearScrollStates();
    }

    // Line 0: Status text (centered, scrolls if too long)
    // Always draw status text (it handles its own caching)
    drawScrollingText(line0_y, status_text, status_color, content_x, content_width, "status_text");

    // Line 1: Date and time (date=tiny, time=regular for better visibility)
    const String line1_key = buildDateTimeKey(data, date_color, time_color);
    if (line1_key != last_line_keys[1] || border_changed) {
        last_line_keys[1] = line1_key;
        fillRect(content_x, line1_y, content_width, getLineHeight(), COLOR_BLACK);
        if (data.time_valid) {
            // Format date (tiny text, 4px per char) and time (regular text, 6px per char)
            String date_text = formatDate(data.month, data.day, data.date_format);
            String time_text = data.use_24h
                ? formatTime24(data.hour, data.minute)
                : formatTime(data.hour, data.minute);

            int date_width = tinyTextWidth(date_text);
            int time_width = time_text.length() * 6;  // Regular text
            const int min_gap = 4;

            // Draw date (tiny) on left, time (regular) on right
            if (date_width + min_gap + time_width <= content_width) {
                drawTinyText(content_x, line1_y, date_text, date_color);
                int time_x = content_x + content_width - time_width;
                drawSmallText(time_x, line1_y, time_text, time_color);
            } else {
                // If doesn't fit, try shorter date format
                char short_date[16];
                snprintf(short_date, sizeof(short_date), "%d/%d", data.month, data.day);
                date_text = String(short_date);
                date_width = tinyTextWidth(date_text);
                if (date_width + min_gap + time_width <= content_width) {
                    drawTinyText(content_x, line1_y, date_text, date_color);
                    int time_x = content_x + content_width - time_width;
                    drawSmallText(time_x, line1_y, time_text, time_color);
                } else {
                    // Last resort: just show time
                    int time_x = content_x + content_width - time_width;
                    if (time_x < content_x) time_x = content_x;
                    drawSmallText(time_x, line1_y, time_text, time_color);
                }
            }
        }
    }

    const bool show_inline_sensors =
        data.show_sensors && (data.status_layout == StatusLayoutMode::SENSORS);

    // Log layout mode and content on first draw or when layout changes
    static bool first_draw = true;
    static String last_status_logged = "";
    static String last_name_logged = "";
    static StatusLayoutMode last_layout_logged = StatusLayoutMode::SENSORS;
    bool layout_changed = (data.status_layout != last_layout_logged);
    bool content_changed = (status_text != last_status_logged) ||
                          (data.display_name != last_name_logged);

    if (first_draw || layout_changed || content_changed) {
        first_draw = false;
        last_status_logged = status_text;
        last_name_logged = data.display_name;
        last_layout_logged = data.status_layout;

        ESP_LOGD("DISPLAY", "========== Status Page ==========");
        ESP_LOGD("DISPLAY", "Border: %dpx, Content: %dx%d, Max lines: %d",
                     border, content_width, available_height, max_lines);
        ESP_LOGD("DISPLAY", "Line 0 (y=%d): %s (status)", line0_y, status_text.c_str());

        if (data.time_valid) {
            String date_str = formatDate(data.month, data.day, data.date_format);
            String time_str = data.use_24h ? formatTime24(data.hour, data.minute) : formatTime(data.hour, data.minute);
            DEBUG_DISPLAY("Line 1 (y=%d): %s  %s (date/time)", line1_y, date_str.c_str(), time_str.c_str());
        } else {
            DEBUG_DISPLAY("Line 1 (y=%d): (no time)", line1_y);
        }

        if (show_inline_sensors) {
            DEBUG_DISPLAY("Layout: SENSORS (sensors large, name tiny)");
            if (data.show_sensors) {
                DEBUG_DISPLAY("Line 2 (y=%d): %dF %d%% (sensors)",
                             line2_y, (int)((data.temperature * 9.0f / 5.0f) + 32.0f), (int)data.humidity);
            }
            if (!data.display_name.isEmpty() && max_lines >= 4) {
                DEBUG_DISPLAY("Line 3 (y=%d): %s (name, tiny)", line3_y, data.display_name.c_str());
            } else if (!data.display_name.isEmpty()) {
                DEBUG_DISPLAY("Line 3 (y=%d): %s (name, tiny) - NOT DRAWN, no space", line3_y, data.display_name.c_str());
            }
        } else {
            DEBUG_DISPLAY("Layout: NAME (name large, sensors bottom)");
            if (!data.display_name.isEmpty()) {
                DEBUG_DISPLAY("Line 2 (y=%d): %s (name)", line2_y, data.display_name.c_str());
            }
            if (data.show_sensors && max_lines >= 4) {
                DEBUG_DISPLAY("Line 3 (y=%d): %dF %d%% (sensors)",
                             line3_y, (int)((data.temperature * 9.0f / 5.0f) + 32.0f), (int)data.humidity);
            } else if (data.show_sensors) {
                DEBUG_DISPLAY("Line 3 (y=%d): %dF %d%% (sensors) - NOT DRAWN, no space",
                             line3_y, (int)((data.temperature * 9.0f / 5.0f) + 32.0f), (int)data.humidity);
            }
        }
        DEBUG_DISPLAY("===============================");
    }

    if (show_inline_sensors) {
        // Line 2: Compact sensor bar
        const String line2_key = buildSensorKey(data, "sensors_inline");
        if (line2_key != last_line_keys[2] || border_changed) {
            last_line_keys[2] = line2_key;
            fillRect(content_x, line2_y, content_width, getLineHeight(), COLOR_BLACK);
            drawSensorBar(data, line2_y, content_x, content_width);
        }

        // Line 3 (tiny): Display name if space allows
        const int used_height = getLineHeight() * 3 + extra_date_spacing;
        const int leftover = available_height - used_height;
        const int tiny_height = 6;
        if (!data.display_name.isEmpty() && leftover >= tiny_height) {
            const int name_y = border + used_height + (leftover - tiny_height) / 2;
            char line3_key_buf[128];
            snprintf(line3_key_buf, sizeof(line3_key_buf), "name_tiny|%s|%d|%d", 
                     data.display_name.c_str(), name_color, name_y);
            const String line3_key = String(line3_key_buf);
            if (line3_key != last_line_keys[3] || border_changed) {
                last_line_keys[3] = line3_key;
                fillRect(content_x, name_y, content_width, tiny_height, COLOR_BLACK);
            }
            drawTinyScrollingText(name_y, data.display_name, name_color, content_x, content_width, "display_name_tiny");
        } else {
            const String line3_key = "name_tiny|hidden";
            if (line3_key != last_line_keys[3] || border_changed) {
                last_line_keys[3] = line3_key;
                const int clear_y = border + used_height;
                const int clear_h = available_height - used_height;
                if (clear_h > 0) {
                    fillRect(content_x, clear_y, content_width, clear_h, COLOR_BLACK);
                }
            }
        }
    } else {
        // Line 2: Display name (scrolls if long)
        if (!data.display_name.isEmpty()) {
            // Always draw display name (it handles its own caching)
            drawScrollingText(line2_y, data.display_name, name_color, content_x, content_width, "display_name");
        } else {
            const String line2_key = "name|empty";
            if (line2_key != last_line_keys[2] || border_changed) {
                last_line_keys[2] = line2_key;
                fillRect(content_x, line2_y, content_width, getLineHeight(), COLOR_BLACK);
            }
        }

        // Line 3: Compact sensor bar (if sensors available)
        if (max_lines >= 4) {
            const String line3_key = buildSensorKey(data, "sensors");
            if (line3_key != last_line_keys[3] || border_changed) {
                last_line_keys[3] = line3_key;
                fillRect(content_x, line3_y, content_width, getLineHeight(), COLOR_BLACK);
                if (data.show_sensors) {
                    drawSensorBar(data, line3_y, content_x, content_width);
                }
            }
        } else {
            const String line3_key = "sensors|hidden";
            if (line3_key != last_line_keys[3] || border_changed) {
                last_line_keys[3] = line3_key;
                const int clear_y = border + (getLineHeight() * max_lines);
                const int clear_h = MATRIX_HEIGHT - border - clear_y;
                if (clear_h > 0) {
                    fillRect(content_x, clear_y, content_width, clear_h, COLOR_BLACK);
                }
            }
        }
    }
}

void MatrixDisplay::drawSensorPage(const DisplayData& data) {
    // Sensor Page Layout (64x32) with colored border:
    // Border: Status-colored border around entire display (1-3 pixels)
    // Line 0: TMP: 72F           <- Temperature
    // Line 1: HUM: 45%           <- Humidity
    // Line 2: TVOC: 125          <- TVOC or selected metric
    // Line 3: IAQ: 35            <- Air quality index
    // All text uses configured metric color (independent of status)

    // Log sensor page content on first draw
    static bool sensor_first_draw = true;
    if (sensor_first_draw) {
        sensor_first_draw = false;
        int temp_f = (int)((data.temperature * 9.0f / 5.0f) + 32.0f);
        DEBUG_DISPLAY("========== Sensor Page ==========");
        DEBUG_DISPLAY("Line 0: TMP: %dF", temp_f);
        DEBUG_DISPLAY("Line 1: HUM: %d%%", (int)data.humidity);
        DEBUG_DISPLAY("Line 2: TVOC: %d", (int)data.tvoc);
        DEBUG_DISPLAY("Line 3: IAQ: %d", data.air_quality_index);
        DEBUG_DISPLAY("===============================");
    }

    uint16_t status_color = getStatusColor(data.webex_status);
    const uint16_t metric_color = data.metric_color;
    int temp_f = (int)((data.temperature * 9.0f / 5.0f) + 32.0f);

    // Calculate content area and layout
    const int border = clampBorderWidth(data.border_width);
    int content_x, content_width;
    calculateContentArea(border, content_x, content_width);

    int available_height, max_lines;
    calculateAvailableHeight(border, available_height, max_lines);

    int line0_y, line1_y, line2_y, line3_y;
    calculateLinePositions(border, line0_y, line1_y, line2_y, line3_y);

    // Draw border (cached - only redraw when status or width changes)
    bool border_changed = updateBorderCache(status_color, border, data.webex_status, data.status_layout);
    if (border_changed) {
        // Force redraw of all content when border changes
        clearPageCache();
        clearScrollStates();
    }

    // Line 0: Temperature
    char temp_str[16];
    snprintf(temp_str, sizeof(temp_str), "TMP: %dF", temp_f);

    char line0_key_buf[96];
    snprintf(line0_key_buf, sizeof(line0_key_buf), "sensor0|%s|%d|%d", 
             data.webex_status.c_str(), temp_f, metric_color);
    const String line0_key = String(line0_key_buf);
    if (line0_key != last_line_keys[0] || border_changed) {
        last_line_keys[0] = line0_key;
        drawTextAutoScroll(line0_y, temp_str, metric_color, content_x, content_width, "sensor_temp");
    }

    // Line 1: Humidity
    char humid_str[16];
    snprintf(humid_str, sizeof(humid_str), "HUM: %d%%", (int)data.humidity);

    char line1_key_buf[96];
    snprintf(line1_key_buf, sizeof(line1_key_buf), "sensor1|%s|%d|%d",
             data.webex_status.c_str(), (int)data.humidity, metric_color);
    const String line1_key = String(line1_key_buf);
    if (line1_key != last_line_keys[1] || border_changed) {
        last_line_keys[1] = line1_key;
        drawTextAutoScroll(line1_y, humid_str, metric_color, content_x, content_width, "sensor_humid");
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

    char line2_key_buf[128];
    snprintf(line2_key_buf, sizeof(line2_key_buf), "sensor2|%s|%s|%d|%d",
             data.webex_status.c_str(), metric.c_str(), (int)data.tvoc, metric_color);
    const String line2_key = String(line2_key_buf);
    if (line2_key != last_line_keys[2] || border_changed) {
        last_line_keys[2] = line2_key;
        drawTextAutoScroll(line2_y, metric_str, metric_color, content_x, content_width, "sensor_metric");
    }

    // Line 3: Air Quality Index
    char aqi_str[20];
    snprintf(aqi_str, sizeof(aqi_str), "AQI: %d", data.air_quality_index);

    if (max_lines >= 4) {
        char line3_key_buf[96];
        snprintf(line3_key_buf, sizeof(line3_key_buf), "sensor3|%s|%d|%d",
                 data.webex_status.c_str(), data.air_quality_index, metric_color);
        const String line3_key = String(line3_key_buf);
        if (line3_key != last_line_keys[3] || border_changed) {
            last_line_keys[3] = line3_key;
            drawTextAutoScroll(line3_y, aqi_str, metric_color, content_x, content_width, "sensor_aqi");
        }
    } else {
        const String line3_key = "sensor3|hidden";
        if (line3_key != last_line_keys[3] || border_changed) {
            last_line_keys[3] = line3_key;
            const int clear_y = border + (getLineHeight() * max_lines);
            const int clear_h = MATRIX_HEIGHT - border - clear_y;
            if (clear_h > 0) {
                fillRect(content_x, clear_y, content_width, clear_h, COLOR_BLACK);
            }
        }
    }
}

void MatrixDisplay::drawInCallPage(const DisplayData& data) {
    // In-Call Page Layout (64x32) with colored border:
    // Border: Status-colored border around entire display (1-3 pixels)
    // Line 0: IN A CALL           <- Call status text
    // Line 1: 📷 ON  🎤 OFF       <- Camera and mic status
    // Line 2: JAN20  12:30PM      <- Date/time - with extra spacing
    // Line 3: 72°F 45% T125       <- Compact sensors

    // Log in-call page content on first draw
    static bool call_first_draw = true;
    if (call_first_draw) {
        call_first_draw = false;
        DEBUG_DISPLAY("========== In-Call Page ==========");
        DEBUG_DISPLAY("Line 0: IN A CALL");
        DEBUG_DISPLAY("Line 1: Camera: %s  Mic: %s",
                     data.camera_on ? "ON" : "OFF",
                     data.mic_muted ? "MUTED" : "ON");
        if (data.time_valid) {
            String date_str = formatDate(data.month, data.day, data.date_format);
            String time_str = data.use_24h ? formatTime24(data.hour, data.minute) : formatTime(data.hour, data.minute);
            DEBUG_DISPLAY("Line 2: %s  %s (date/time)", date_str.c_str(), time_str.c_str());
        }
        if (data.show_sensors) {
            ESP_LOGD(TAG, "Line 3: %dF %d%% (sensors)",
                     (int)((data.temperature * 9.0f / 5.0f) + 32.0f), (int)data.humidity);
        }
        DEBUG_DISPLAY("===============================");
    }

    uint16_t status_color = getStatusColor(data.webex_status);
    const uint16_t date_color = data.date_color;
    const uint16_t time_color = data.time_color;

    // Calculate content area and layout
    const int border = clampBorderWidth(data.border_width);
    int content_x, content_width;
    calculateContentArea(border, content_x, content_width);

    int available_height, max_lines;
    calculateAvailableHeight(border, available_height, max_lines);
    const int extra_date_spacing = 2; // Extra pixels between status and camera/mic line
    
    int line0_y, line1_y, line2_y, line3_y;
    // Custom line positions for in-call page (extra spacing only after line 0)
    line0_y = border + getLineHeight() * 0;
    line1_y = border + getLineHeight() * 1 + extra_date_spacing;
    line2_y = border + getLineHeight() * 2; // No extra spacing - keep normal position
    line3_y = border + getLineHeight() * 3; // No extra spacing - keep normal position

    // Draw border (cached - only redraw when status or width changes)
    bool border_changed = updateBorderCache(status_color, border, data.webex_status, data.status_layout);
    if (border_changed) {
        // Force redraw of all content when border changes
        clearPageCache();
        clearScrollStates();
    }

    // Line 0: "IN A CALL" text
    char line0_key_buf[64];
    snprintf(line0_key_buf, sizeof(line0_key_buf), "call0|%s", data.webex_status.c_str());
    const String line0_key = String(line0_key_buf);
    if (line0_key != last_line_keys[0] || border_changed) {
        last_line_keys[0] = line0_key;
        drawTextAutoScroll(line0_y, "IN A CALL", status_color, content_x, content_width, "call_status");
    }

    // Line 1: Camera and Mic status
    char line1_key_buf[32];
    snprintf(line1_key_buf, sizeof(line1_key_buf), "call1|%d%d",
             data.camera_on ? 1 : 0, data.mic_muted ? 1 : 0);
    const String line1_key = String(line1_key_buf);

    if (line1_key != last_line_keys[1] || border_changed) {
        last_line_keys[1] = line1_key;
        fillRect(content_x, line1_y, content_width, getLineHeight(), COLOR_BLACK);

        // Camera icon and status on left (offset by border)
        const int camera_x = content_x + 2;
        drawCameraIcon(camera_x, line1_y, data.camera_on);
        drawSmallText(camera_x + 10, line1_y, data.camera_on ? "ON" : "OFF",
                      data.camera_on ? COLOR_GREEN : COLOR_RED);

        // Mic icon and status on right
        const int mic_x = content_x + 34;
        drawMicIcon(mic_x, line1_y, data.mic_muted);
        drawSmallText(mic_x + 7, line1_y, data.mic_muted ? "OFF" : "ON",
                      data.mic_muted ? COLOR_RED : COLOR_GREEN);
    }

    // Line 2: Date/time (date=tiny, time=regular for better visibility)
    char line2_key_buf[128];
    String datetime_key = buildDateTimeKey(data, date_color, time_color);
    snprintf(line2_key_buf, sizeof(line2_key_buf), "call2|%s", datetime_key.c_str());
    const String line2_key = String(line2_key_buf);
    if (line2_key != last_line_keys[2] || border_changed) {
        last_line_keys[2] = line2_key;
        fillRect(content_x, line2_y, content_width, getLineHeight(), COLOR_BLACK);
        if (data.time_valid) {
            // Format date (tiny text, 4px per char) and time (regular text, 6px per char)
            String date_text = formatDate(data.month, data.day, data.date_format);
            String time_text = data.use_24h
                ? formatTime24(data.hour, data.minute)
                : formatTime(data.hour, data.minute);

            int date_width = tinyTextWidth(date_text);
            int time_width = time_text.length() * 6;  // Regular text
            const int min_gap = 4;

            // Draw date (tiny) on left, time (regular) on right
            if (date_width + min_gap + time_width <= content_width) {
                drawTinyText(content_x, line2_y, date_text, date_color);
                int time_x = content_x + content_width - time_width;
                drawSmallText(time_x, line2_y, time_text, time_color);
            } else {
                // If doesn't fit, try shorter date format
                char short_date[16];
                snprintf(short_date, sizeof(short_date), "%d/%d", data.month, data.day);
                date_text = String(short_date);
                date_width = tinyTextWidth(date_text);
                if (date_width + min_gap + time_width <= content_width) {
                    drawTinyText(content_x, line2_y, date_text, date_color);
                    int time_x = content_x + content_width - time_width;
                    drawSmallText(time_x, line2_y, time_text, time_color);
                } else {
                    // Last resort: just show time
                    int time_x = content_x + content_width - time_width;
                    if (time_x < content_x) time_x = content_x;
                    drawSmallText(time_x, line2_y, time_text, time_color);
                }
            }
        }
    }

    // Line 3: Compact sensor bar (reuse helper)
    if (max_lines >= 4) {
        const String line3_key = buildSensorKey(data, "call3");
        if (line3_key != last_line_keys[3] || border_changed) {
            last_line_keys[3] = line3_key;
            fillRect(content_x, line3_y, content_width, getLineHeight(), COLOR_BLACK);
            if (data.show_sensors) {
                drawSensorBar(data, line3_y, content_x, content_width);
            }
        }
    } else {
        const String line3_key = "call3|hidden";
        if (line3_key != last_line_keys[3] || border_changed) {
            last_line_keys[3] = line3_key;
            const int clear_y = border + (getLineHeight() * max_lines);
            const int clear_h = MATRIX_HEIGHT - border - clear_y;
            if (clear_h > 0) {
                fillRect(content_x, clear_y, content_width, clear_h, COLOR_BLACK);
            }
        }
    }
}

void MatrixDisplay::update(const DisplayData& data) {
    if (!initialized) return;

    // Don't override display during OTA updates
    if (ota_in_progress) return;

    // Clear static screen state when switching to dynamic status display
    // This ensures proper transition from static screens (startup, unconfigured, etc.)
    if (!last_static_key.isEmpty()) {
        last_static_key.clear();
        dma_display->clearScreen();
    }

    const unsigned long now = millis();

    // Determine which page to show
    DisplayPage target_page;

    // In-call overrides page rotation
    if (data.show_call_status && data.in_call) {
        target_page = DisplayPage::IN_CALL;
    } else {
        switch (data.page_mode) {
            case DisplayPageMode::SENSORS_ONLY:
                target_page = data.show_sensors ? DisplayPage::SENSORS : DisplayPage::STATUS;
                break;
            case DisplayPageMode::ROTATE:
                if (data.show_sensors) {
                    // Page rotation between status and sensors
                    if (now - last_page_change_ms >= page_interval_ms) {
                        last_page_change_ms = now;
                        current_page = (current_page == DisplayPage::STATUS)
                            ? DisplayPage::SENSORS
                            : DisplayPage::STATUS;
                    }
                    target_page = current_page;
                } else {
                    target_page = DisplayPage::STATUS;
                }
                break;
            case DisplayPageMode::STATUS_ONLY:
            default:
                target_page = DisplayPage::STATUS;
                break;
        }
    }

    // Check if page changed - clear screen and reset line keys
    if (target_page != last_page) {
        dma_display->clearScreen();
        clearAllCaches();

        // Log page change
        const char* page_name = (target_page == DisplayPage::STATUS) ? "STATUS" :
                                (target_page == DisplayPage::SENSORS) ? "SENSORS" : "IN_CALL";
        ESP_LOGD("DISPLAY", "==========================================");
        ESP_LOGD("DISPLAY", "PAGE SWITCH: %s", page_name);
        ESP_LOGD("DISPLAY", "==========================================");

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
