/**
 * @file display_sensors.cpp
 * @brief Sensor Bar Rendering Functions
 * 
 * Contains functions for rendering sensor data (temperature, humidity, air quality)
 * in a formatted bar layout.
 */

#include "matrix_display.h"

void MatrixDisplay::drawSensorBar(const DisplayData& data, int y) {
    // Call overloaded version with full width for backward compatibility
    drawSensorBar(data, y, 0, MATRIX_WIDTH);
}

void MatrixDisplay::drawSensorBar(const DisplayData& data, int y, int content_x, int content_width) {
    const int char_width = 6;
    String temp_text, humid_text, right_text;

    int temp_f = (int)((data.temperature * 9.0f / 5.0f) + 32.0f);
    temp_text = String(temp_f) + "F";

    humid_text = String((int)data.humidity) + "%";

    String metric = data.right_metric;
    metric.toLowerCase();
    char right_str[16];
    if (metric == "co2") {
        snprintf(right_str, sizeof(right_str), "C%d", (int)data.co2_ppm);
    } else if (metric == "pm2_5" || metric == "pm2.5") {
        snprintf(right_str, sizeof(right_str), "P%d", (int)data.pm2_5);
    } else if (metric == "noise") {
        int value = (int)data.ambient_noise;
        snprintf(right_str, sizeof(right_str), "N%d", value);
    } else {
        if (data.tvoc >= 1000.0f) {
            int tvoc_k = (int)((data.tvoc + 500.0f) / 1000.0f);
            snprintf(right_str, sizeof(right_str), "T%dk", tvoc_k);
        } else {
            snprintf(right_str, sizeof(right_str), "T%d", (int)data.tvoc);
        }
    }

    right_text = String(right_str);
    int temp_width = temp_text.length() * char_width;
    int humid_width = humid_text.length() * char_width;
    int right_width = right_text.length() * char_width;

    int left_x = content_x;
    int right_x = content_x + content_width - right_width;
    int mid_x = content_x + (content_width - humid_width) / 2;
    int min_mid_x = left_x + temp_width + 2;
    int max_mid_x = right_x - humid_width - 2;
    if (mid_x < min_mid_x) {
        mid_x = min_mid_x;
    }
    if (mid_x > max_mid_x) {
        mid_x = max_mid_x;
    }
    if (mid_x < content_x) {
        mid_x = content_x;
    }

    drawSmallText(left_x, y, temp_text, data.metric_color);
    if (mid_x + humid_width <= content_x + content_width) {
        drawSmallText(mid_x, y, humid_text, data.metric_color);
    }
    if (right_x >= content_x) {
        drawSmallText(right_x, y, right_text, data.metric_color);
    }
}
