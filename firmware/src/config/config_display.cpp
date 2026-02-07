/**
 * @file config_display.cpp
 * @brief Display Configuration Domain Implementation
 */

#include "config_manager.h"
#include "config_macros.h"
#include "../debug/log_system.h"

static const char* TAG = "CFG_DISP";

// Device Configuration

CONFIG_CACHED_STRING_GETTER(DeviceName, "device_name", cached_device_name, DEFAULT_DEVICE_NAME)

void ConfigManager::setDeviceName(const String& name) {
    saveString("device_name", name);
    cached_device_name = name;
}

CONFIG_CACHED_STRING_GETTER(DisplayName, "display_name", cached_display_name, "")

void ConfigManager::setDisplayName(const String& name) {
    saveString("display_name", name);
    cached_display_name = name;
}

// UUID-based Device Identity (Phase 3)
CONFIG_CACHED_STRING_GETTER(DeviceUuid, "device_uuid", cached_device_uuid, "")

void ConfigManager::setDeviceUuid(const String& uuid) {
    saveString("device_uuid", uuid);
    cached_device_uuid = uuid;
    ESP_LOGI(TAG, "Device UUID set to: %s", uuid.isEmpty() ? "(empty)" : uuid.substring(0, 8).c_str());
}

CONFIG_CACHED_STRING_GETTER(UserUuid, "user_uuid", cached_user_uuid, "")

void ConfigManager::setUserUuid(const String& uuid) {
    saveString("user_uuid", uuid);
    cached_user_uuid = uuid;
    ESP_LOGI(TAG, "User UUID set to: %s", uuid.isEmpty() ? "(empty)" : uuid.substring(0, 8).c_str());
}

CONFIG_CACHED_STRING_GETTER(LastWebexStatus, "lst_webex_st", cached_last_webex_status, "")

void ConfigManager::setLastWebexStatus(const String& status) {
    saveString("lst_webex_st", status);
    cached_last_webex_status = status;
}

CONFIG_CACHED_UINT8_GETTER(Brightness, "brightness", cached_brightness, DEFAULT_BRIGHTNESS)
CONFIG_CACHED_UINT8_SETTER(Brightness, "brightness", cached_brightness)

CONFIG_CACHED_UINT16_GETTER(ScrollSpeedMs, "scroll_speed_ms", cached_scroll_speed_ms, DEFAULT_SCROLL_SPEED_MS)
CONFIG_CACHED_UINT16_SETTER(ScrollSpeedMs, "scroll_speed_ms", cached_scroll_speed_ms)

CONFIG_CACHED_UINT16_GETTER(PageIntervalMs, "page_interval", cached_page_interval_ms, DEFAULT_PAGE_INTERVAL_MS)

void ConfigManager::setPageIntervalMs(uint16_t interval_ms) {
    // Enforce minimum of 3 seconds, maximum of 30 seconds
    if (interval_ms < 3000) {
        interval_ms = 3000;
    }
    if (interval_ms > 30000) {
        interval_ms = 30000;
    }
    saveUInt("page_interval", interval_ms);
    cached_page_interval_ms = interval_ms;
    ESP_LOGI(TAG, "Page interval set to %d ms", interval_ms);
}

CONFIG_CACHED_BOOL_GETTER(SensorPageEnabled, "sensor_page", cached_sensor_page_enabled, true)

void ConfigManager::setSensorPageEnabled(bool enabled) {
    saveBool("sensor_page", enabled);
    cached_sensor_page_enabled = enabled;
    cached_display_pages = enabled ? String("rotate") : String("status");
    saveString("display_pages", cached_display_pages);
    ESP_LOGI(TAG, "Sensor page %s", enabled ? "enabled" : "disabled");
}

String ConfigManager::getDisplayPages() const {
    String mode;
    if (!cache_loaded) {
        mode = loadString("display_pages", "");
    } else {
        mode = cached_display_pages;
    }
    mode.trim();
    mode.toLowerCase();
    if (mode.isEmpty()) {
        const bool sensor_enabled = cache_loaded ? cached_sensor_page_enabled : loadBool("sensor_page", true);
        return sensor_enabled ? String(DEFAULT_DISPLAY_PAGES) : String("status");
    }
    if (mode != "status" && mode != "sensors" && mode != "rotate") {
        mode = DEFAULT_DISPLAY_PAGES;
    }
    return mode;
}

void ConfigManager::setDisplayPages(const String& mode) {
    String normalized = mode;
    normalized.trim();
    normalized.toLowerCase();
    if (normalized != "status" && normalized != "sensors" && normalized != "rotate") {
        normalized = DEFAULT_DISPLAY_PAGES;
    }
    saveString("display_pages", normalized);
    cached_display_pages = normalized;
    cached_sensor_page_enabled = (normalized == "rotate");
    saveBool("sensor_page", cached_sensor_page_enabled);
    ESP_LOGI(TAG, "Display pages set to %s", normalized.c_str());
}

String ConfigManager::getStatusLayout() const {
    String layout;
    if (!cache_loaded) {
        layout = loadString("status_layout", DEFAULT_STATUS_LAYOUT);
    } else {
        layout = cached_status_layout;
    }
    layout.trim();
    layout.toLowerCase();
    if (layout != "name" && layout != "sensors") {
        layout = DEFAULT_STATUS_LAYOUT;
    }
    return layout;
}

void ConfigManager::setStatusLayout(const String& layout) {
    String normalized = layout;
    normalized.trim();
    normalized.toLowerCase();
    if (normalized != "name" && normalized != "sensors") {
        normalized = DEFAULT_STATUS_LAYOUT;
    }
    saveString("status_layout", normalized);
    cached_status_layout = normalized;
    ESP_LOGI(TAG, "Status layout set to %s", normalized.c_str());
}

CONFIG_CACHED_UINT8_GETTER(BorderWidth, "border_width", cached_border_width, DEFAULT_BORDER_WIDTH)

void ConfigManager::setBorderWidth(uint8_t width) {
    // Clamp to valid range: 1-3 pixels
    if (width < 1) width = 1;
    if (width > 3) width = 3;
    saveUInt("border_width", width);
    cached_border_width = width;
    ESP_LOGI(TAG, "Border width set to %d pixels", width);
}

CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(DateColor, "date_color", cached_date_color, DEFAULT_DATE_COLOR)
CONFIG_CACHED_STRING_SETTER(DateColor, "date_color", cached_date_color)

CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(TimeColor, "time_color", cached_time_color, DEFAULT_TIME_COLOR)
CONFIG_CACHED_STRING_SETTER(TimeColor, "time_color", cached_time_color)

CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(NameColor, "name_color", cached_name_color, DEFAULT_NAME_COLOR)
CONFIG_CACHED_STRING_SETTER(NameColor, "name_color", cached_name_color)

CONFIG_CACHED_STRING_GETTER_WITH_DEFAULT(MetricColor, "metric_color", cached_metric_color, DEFAULT_METRIC_COLOR)
CONFIG_CACHED_STRING_SETTER(MetricColor, "metric_color", cached_metric_color)
