/**
 * @file display_cache.cpp
 * @brief Cache Key Builders and Cache Management
 *
 * Builds cache keys for date/time and sensor data,
 * and provides cache clearing functions.
 */

#include "matrix_display.h"

/**
 * @brief Build a cache key for date/time line
 */
String MatrixDisplay::buildDateTimeKey(const DisplayData& data, uint16_t date_color, uint16_t time_color) {
    char buffer[64];
    if (data.time_valid) {
        snprintf(buffer, sizeof(buffer), "time|%d/%d|%d:%d|%s|%d|%d|%d",
                 data.month, data.day, data.hour, data.minute,
                 data.use_24h ? "24" : "12",
                 data.date_format, date_color, time_color);
    } else {
        snprintf(buffer, sizeof(buffer), "time|none|%d|%d", date_color, time_color);
    }
    return String(buffer);
}

/**
 * @brief Build a cache key for sensor bar
 */
String MatrixDisplay::buildSensorKey(const DisplayData& data, const String& prefix) {
    char buffer[128];
    if (data.show_sensors) {
        snprintf(buffer, sizeof(buffer), "%s|%d/%d/%d/%s|%d",
                 prefix.c_str(), (int)data.temperature, (int)data.humidity,
                 (int)data.tvoc, data.right_metric.c_str(), data.metric_color);
    } else {
        snprintf(buffer, sizeof(buffer), "%s|none|%d", prefix.c_str(), data.metric_color);
    }
    return String(buffer);
}

/**
 * @brief Clear page cache (line keys)
 */
void MatrixDisplay::clearPageCache() {
    for (int i = 0; i < 4; i++) {
        last_line_keys[i].clear();
    }
}

/**
 * @brief Clear scroll states
 */
void MatrixDisplay::clearScrollStates() {
    status_scroll.text.clear();
    for (int i = 0; i < MAX_SCROLL_STATES; i++) {
        if (scroll_states[i].active) {
            scroll_states[i].state.text.clear();
        }
    }
}

/**
 * @brief Clear all caches (page cache, scroll states, border cache)
 */
void MatrixDisplay::clearAllCaches() {
    clearPageCache();
    clearScrollStates();
    clearBorderCache();
}
