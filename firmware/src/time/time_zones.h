#ifndef TIME_ZONES_H
#define TIME_ZONES_H

#include <Arduino.h>

struct TimeZoneEntry {
    const char* id;
    const char* posix;
};

static const TimeZoneEntry TIME_ZONES[] = {
    {"UTC", "UTC0"},
    {"America/New_York", "EST5EDT,M3.2.0,M11.1.0"},
    {"America/Chicago", "CST6CDT,M3.2.0,M11.1.0"},
    {"America/Denver", "MST7MDT,M3.2.0,M11.1.0"},
    {"America/Los_Angeles", "PST8PDT,M3.2.0,M11.1.0"},
    {"America/Phoenix", "MST7"},
    {"America/Anchorage", "AKST9AKDT,M3.2.0,M11.1.0"},
    {"America/Honolulu", "HST10"},
    {"Europe/London", "GMT0BST,M3.5.0/1,M10.5.0"},
    {"Europe/Berlin", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Paris", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Madrid", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Rome", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Amsterdam", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Zurich", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Moscow", "MSK-3"},
    {"Asia/Tokyo", "JST-9"},
    {"Asia/Shanghai", "CST-8"},
    {"Asia/Hong_Kong", "HKT-8"},
    {"Asia/Singapore", "SGT-8"},
    {"Asia/Kolkata", "IST-5:30"},
    {"Australia/Sydney", "AEST-10AEDT,M10.1.0,M4.1.0/3"},
    {"Australia/Perth", "AWST-8"},
    {"Pacific/Auckland", "NZST-12NZDT,M9.5.0,M4.1.0/3"}
};

inline const char* resolvePosixTimeZone(const String& time_zone_id) {
    if (time_zone_id.isEmpty()) {
        return "UTC0";
    }
    for (const auto& entry : TIME_ZONES) {
        if (time_zone_id.equalsIgnoreCase(entry.id)) {
            return entry.posix;
        }
    }
    return nullptr;
}

#endif // TIME_ZONES_H
