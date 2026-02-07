/**
 * @file time_manager.cpp
 * @brief Time configuration and NTP sync helpers
 */

#include "time_manager.h"
#include "time_zones.h"
#include "../debug/log_system.h"
#include <time.h>

static const char* TAG = "TIME";

namespace {
bool looksLikePosixTimeZone(const String& value) {
    String trimmed = value;
    trimmed.trim();
    if (trimmed.isEmpty()) {
        return false;
    }
    if (trimmed.indexOf('/') >= 0) {
        return false;
    }
    if (trimmed.indexOf(',') >= 0) {
        return true;
    }
    bool has_digit = false;
    bool has_alpha = false;
    for (size_t i = 0; i < trimmed.length(); i++) {
        char c = trimmed[i];
        if (c >= '0' && c <= '9') {
            has_digit = true;
        } else if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
            has_alpha = true;
        }
    }
    return has_digit && has_alpha;
}
}

bool applyTimeConfig(const ConfigManager& config, AppState* state) {
    String time_zone_id = config.getTimeZone();
    time_zone_id.trim();
    const char* posix_tz = resolvePosixTimeZone(time_zone_id);
    if (!posix_tz) {
        if (looksLikePosixTimeZone(time_zone_id)) {
            // Treat unknown values as a direct POSIX TZ string.
            posix_tz = time_zone_id.c_str();
        } else {
            ESP_LOGW(TAG, "Unknown time zone '%s', falling back to UTC",
                          time_zone_id.c_str());
            posix_tz = "UTC0";
        }
    }

    String ntp_server = config.getNtpServer();
    ntp_server.trim();

    if (ntp_server.isEmpty()) {
        ntp_server = "pool.ntp.org";
    }

    configTzTime(posix_tz, ntp_server.c_str(), "time.nist.gov", "time.google.com");
    return syncTime(state);
}

bool syncTime(AppState* state) {
    if (!state) {
        return false;
    }

    ESP_LOGI(TAG, "Waiting for NTP sync...");
    struct tm timeinfo;
    int attempts = 0;
    while (!getLocalTime(&timeinfo) && attempts < 20) {
        delay(500);
        attempts++;
    }

    if (getLocalTime(&timeinfo)) {
        state->time_synced = true;
        ESP_LOGI(TAG, "Time synced: %02d:%02d:%02d",
                      timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
        return true;
    }

    state->time_synced = false;
    ESP_LOGE(TAG, "Failed to sync time");
    return false;
}
