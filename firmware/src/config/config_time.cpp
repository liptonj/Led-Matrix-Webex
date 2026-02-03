/**
 * @file config_time.cpp
 * @brief Time Configuration Domain Implementation
 */

#include "config_manager.h"
#include "config_macros.h"
#include "common/lookup_tables.h"

// Time Configuration

CONFIG_CACHED_STRING_GETTER(TimeZone, "time_zone", cached_time_zone, "UTC")
CONFIG_CACHED_STRING_SETTER(TimeZone, "time_zone", cached_time_zone)

CONFIG_CACHED_STRING_GETTER(NtpServer, "ntp_server", cached_ntp_server, "pool.ntp.org")
CONFIG_CACHED_STRING_SETTER(NtpServer, "ntp_server", cached_ntp_server)

CONFIG_CACHED_STRING_GETTER(TimeFormat, "time_format", cached_time_format, "24h")
CONFIG_CACHED_STRING_SETTER(TimeFormat, "time_format", cached_time_format)

bool ConfigManager::use24HourTime() const {
    String format = getTimeFormat();
    format.toLowerCase();
    format.trim();
    // Use lookup table to check for 12-hour format
    return !TimeFormatLookup::is12HourFormat(format.c_str());
}

CONFIG_CACHED_STRING_GETTER(DateFormat, "date_format", cached_date_format, "mdy")
CONFIG_CACHED_STRING_SETTER(DateFormat, "date_format", cached_date_format)

uint8_t ConfigManager::getDateFormatCode() const {
    String format = getDateFormat();
    format.toLowerCase();
    format.trim();
    // Use lookup table for date format code
    return DateFormatLookup::getFormatCode(format.c_str());
}
