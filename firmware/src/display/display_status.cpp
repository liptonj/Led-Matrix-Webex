#include "matrix_display.h"

void MatrixDisplay::update(const DisplayData& data) {
    if (!initialized) return;

    const bool in_call_layout = data.show_call_status && data.in_call;
    String render_key;
    render_key.reserve(120);
    render_key += data.webex_status;
    render_key += '|';
    render_key += data.show_call_status ? '1' : '0';
    render_key += data.in_call ? '1' : '0';
    render_key += data.camera_on ? '1' : '0';
    render_key += data.mic_muted ? '1' : '0';
    render_key += data.show_sensors ? '1' : '0';
    if (data.show_sensors) {
        render_key += data.right_metric;
        render_key += '|';
    }
    render_key += data.time_valid ? '1' : '0';
    render_key += data.use_24h ? '1' : '0';
    render_key += String(data.date_format);
    render_key += '|';
    render_key += String(data.month);
    render_key += '/';
    render_key += String(data.day);
    render_key += ' ';
    render_key += String(data.hour);
    render_key += ':';
    render_key += String(data.minute);
    render_key += '|';
    render_key += String((int)data.temperature);
    render_key += '/';
    render_key += String((int)data.humidity);
    render_key += '/';
    render_key += String((int)data.air_quality_index);
    render_key += '/';
    render_key += String((int)data.tvoc);
    render_key += '/';
    render_key += String((int)data.co2_ppm);
    render_key += '/';
    render_key += String((int)data.pm2_5);
    render_key += '/';
    render_key += String((int)data.ambient_noise);

    if (!data.show_sensors) {
        render_key += "|nosensors";
    }

    const unsigned long now = millis();
    if (render_key == last_render_key) {
        return;
    }
    const bool is_first_render = last_render_key.isEmpty();
    const bool layout_changed = in_call_layout != last_in_call_layout;
    if (!is_first_render && !layout_changed && (now - last_render_ms) < 250) {
        return;
    }
    if (is_first_render || layout_changed) {
        dma_display->clearScreen();
        for (int i = 0; i < 4; i++) {
            last_line_keys[i].clear();
        }
    }
    last_render_key = render_key;
    last_render_ms = now;
    last_in_call_layout = in_call_layout;

    uint16_t status_color = getStatusColor(data.webex_status);

    // Check if in a meeting/call - show different layout
    if (in_call_layout) {
        // === IN A CALL LAYOUT (32 pixel height) ===
        const int line0_y = getTextLineY(0, 8);
        const int line1_y = getTextLineY(1, 8);
        const int line2_y = getTextLineY(2, 8);
        const int line3_y = getTextLineY(3, 8);

        // y=0-7: "IN A CALL" text centered
        const String line0_key = String("call_title|") + data.webex_status;
        if (line0_key != last_line_keys[0]) {
            last_line_keys[0] = line0_key;
            fillRect(0, line0_y, MATRIX_WIDTH, 8, COLOR_BLACK);
            drawCenteredText(line0_y, "IN A CALL", status_color);
        }

        // y=8-15: Camera and Mic status with labels
        const String line1_key = String("call_av|")
            + (data.camera_on ? "1" : "0")
            + (data.mic_muted ? "1" : "0");
        if (line1_key != last_line_keys[1]) {
            last_line_keys[1] = line1_key;
            fillRect(0, line1_y, MATRIX_WIDTH, 8, COLOR_BLACK);
            
            // Calculate positions dynamically based on display width
            const int camera_icon_x = 2;
            const int camera_text_x = camera_icon_x + 8 + 2; // Icon (8px) + gap (2px)
            const int camera_text_width = (data.camera_on ? 2 : 3) * 6; // "ON"=12px, "OFF"=18px
            
            // Mic icon positioned from right side
            const int mic_text_width = (data.mic_muted ? 3 : 2) * 6; // "OFF"=18px, "ON"=12px
            const int mic_icon_x = MATRIX_WIDTH - mic_text_width - 5 - 2; // Text width + icon (5px) + gap (2px)
            const int mic_text_x = mic_icon_x + 5 + 2; // Icon (5px) + gap (2px)
            
            // Ensure mic icon doesn't overlap with camera section
            const int min_mic_x = camera_text_x + camera_text_width + 4; // Camera end + gap
            int final_mic_icon_x = mic_icon_x;
            int final_mic_text_x = mic_text_x;
            
            if (mic_icon_x < min_mic_x) {
                // Not enough space, adjust mic position to avoid overlap
                final_mic_icon_x = min_mic_x;
                final_mic_text_x = final_mic_icon_x + 5 + 2;
            }
            
            // Draw left to right: Camera icon and text first
            drawCameraIcon(camera_icon_x, line1_y, data.camera_on);
            drawSmallText(camera_text_x, line1_y, data.camera_on ? "ON" : "OFF", data.camera_on ? COLOR_GREEN : COLOR_RED);
            
            // Then mic icon and text on the right
            drawMicIcon(final_mic_icon_x, line1_y, data.mic_muted);
            // Only draw mic text if it fits on screen
            if (final_mic_text_x + mic_text_width <= MATRIX_WIDTH) {
                drawSmallText(final_mic_text_x, line1_y, data.mic_muted ? "OFF" : "ON", data.mic_muted ? COLOR_RED : COLOR_GREEN);
            }
        }

        // y=16-23: Date/Time in status color
        // Don't include status in key - only redraw when time/date actually changes
        String line2_key = "call_time|";
        if (data.time_valid) {
            line2_key += String(data.month);
            line2_key += '/';
            line2_key += String(data.day);
            line2_key += '|';
            line2_key += String(data.hour);
            line2_key += ':';
            line2_key += String(data.minute);
            line2_key += '|';
            line2_key += data.use_24h ? '1' : '0';
            line2_key += '|';
            line2_key += String(data.date_format);
        } else {
            line2_key += "none";
        }
        // Only redraw if time/date changed OR status color changed (for color update)
        String line2_key_with_color = line2_key + "|" + String(status_color);
        if (line2_key_with_color != last_line_keys[2]) {
            last_line_keys[2] = line2_key_with_color;
            fillRect(0, line2_y, MATRIX_WIDTH, 8, COLOR_BLACK);
            if (data.time_valid) {
                drawDateTimeLine(line2_y, data, status_color);
            }
        }

        // y=24-31: Sensor data
        String line3_key = "call_sensors|";
        if (data.show_sensors) {
            line3_key += data.right_metric;
            line3_key += '|';
            line3_key += String((int)data.temperature);
            line3_key += '/';
            line3_key += String((int)data.humidity);
            line3_key += '/';
            line3_key += String((int)data.air_quality_index);
            line3_key += '/';
            line3_key += String((int)data.tvoc);
            line3_key += '/';
            line3_key += String((int)data.co2_ppm);
            line3_key += '/';
            line3_key += String((int)data.pm2_5);
            line3_key += '/';
            line3_key += String((int)data.ambient_noise);
        } else {
            line3_key += "none";
        }
        if (line3_key != last_line_keys[3]) {
            last_line_keys[3] = line3_key;
            fillRect(0, line3_y, MATRIX_WIDTH, 8, COLOR_BLACK);
            if (data.show_sensors) {
                drawSensorBar(data, line3_y);
            }
        }
    } else {
        // === NORMAL STATUS LAYOUT (32 pixel height) ===
        const int line0_y = getTextLineY(0, 8);
        const int line1_y = getTextLineY(1, 8);
        const int line2_y = getTextLineY(2, 8);
        const int line3_y = getTextLineY(3, 8);

        // y=0-7: Status circle centered (8x8)
        const String line0_key = String("status_icon|") + data.webex_status;
        if (line0_key != last_line_keys[0]) {
            last_line_keys[0] = line0_key;
            fillRect(0, line0_y, MATRIX_WIDTH, 8, COLOR_BLACK);
            drawStatusIcon(MATRIX_WIDTH / 2 - 4, line0_y, data.webex_status);
        }

        // y=8-15: Status text centered
        const String line1_key = String("status_text|") + data.webex_status;
        if (line1_key != last_line_keys[1]) {
            last_line_keys[1] = line1_key;
            fillRect(0, line1_y, MATRIX_WIDTH, 8, COLOR_BLACK);
            drawCenteredText(line1_y, getStatusText(data.webex_status), status_color);
        }

        // y=16-23: Date and Time in status color
        // Don't include status in key - only redraw when time/date actually changes
        String line2_key = "status_time|";
        if (data.time_valid) {
            line2_key += String(data.month);
            line2_key += '/';
            line2_key += String(data.day);
            line2_key += '|';
            line2_key += String(data.hour);
            line2_key += ':';
            line2_key += String(data.minute);
            line2_key += '|';
            line2_key += data.use_24h ? '1' : '0';
            line2_key += '|';
            line2_key += String(data.date_format);
        } else {
            line2_key += "none";
        }
        // Only redraw if time/date changed OR status color changed (for color update)
        String line2_key_with_color = line2_key + "|" + String(status_color);
        if (line2_key_with_color != last_line_keys[2]) {
            last_line_keys[2] = line2_key_with_color;
            fillRect(0, line2_y, MATRIX_WIDTH, 8, COLOR_BLACK);
            if (data.time_valid) {
                drawDateTimeLine(line2_y, data, status_color);
            }
        }

        // y=24-31: Sensor data
        String line3_key = "status_sensors|";
        if (data.show_sensors) {
            line3_key += data.right_metric;
            line3_key += '|';
            line3_key += String((int)data.temperature);
            line3_key += '/';
            line3_key += String((int)data.humidity);
            line3_key += '/';
            line3_key += String((int)data.air_quality_index);
            line3_key += '/';
            line3_key += String((int)data.tvoc);
            line3_key += '/';
            line3_key += String((int)data.co2_ppm);
            line3_key += '/';
            line3_key += String((int)data.pm2_5);
            line3_key += '/';
            line3_key += String((int)data.ambient_noise);
        } else {
            line3_key += "none";
        }
        if (line3_key != last_line_keys[3]) {
            last_line_keys[3] = line3_key;
            fillRect(0, line3_y, MATRIX_WIDTH, 8, COLOR_BLACK);
            if (data.show_sensors) {
                drawSensorBar(data, line3_y);
            }
        }
    }
}
