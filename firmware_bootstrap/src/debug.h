/**
 * @file debug.h
 * @brief Debug logging macros for bootstrap firmware
 * 
 * Set DEBUG_LEVEL to control verbosity:
 *   0 = Off (no debug output)
 *   1 = Errors only
 *   2 = Warnings + Errors
 *   3 = Info + Warnings + Errors
 *   4 = Debug + Info + Warnings + Errors (verbose)
 *   5 = Trace (everything, very verbose)
 */

#ifndef DEBUG_H
#define DEBUG_H

#include <Arduino.h>

// Default debug level - can be overridden in platformio.ini with -DDEBUG_LEVEL=X
#ifndef DEBUG_LEVEL
#define DEBUG_LEVEL 4  // Default to Debug level
#endif

// Color codes for serial output (optional, looks nice in terminals that support it)
#define ANSI_RED     "\033[31m"
#define ANSI_YELLOW  "\033[33m"
#define ANSI_GREEN   "\033[32m"
#define ANSI_CYAN    "\033[36m"
#define ANSI_MAGENTA "\033[35m"
#define ANSI_RESET   "\033[0m"

// Use colors? Set to 0 to disable
#ifndef DEBUG_USE_COLORS
#define DEBUG_USE_COLORS 0
#endif

#if DEBUG_USE_COLORS
#define COLOR_ERR   ANSI_RED
#define COLOR_WARN  ANSI_YELLOW
#define COLOR_INFO  ANSI_GREEN
#define COLOR_DBG   ANSI_CYAN
#define COLOR_TRACE ANSI_MAGENTA
#define COLOR_RST   ANSI_RESET
#else
#define COLOR_ERR   ""
#define COLOR_WARN  ""
#define COLOR_INFO  ""
#define COLOR_DBG   ""
#define COLOR_TRACE ""
#define COLOR_RST   ""
#endif

// Error level (1) - Critical errors
#if DEBUG_LEVEL >= 1
#define LOG_ERROR(tag, fmt, ...) \
    Serial.printf("%s[ERROR][%s] " fmt "%s\n", COLOR_ERR, tag, ##__VA_ARGS__, COLOR_RST)
#else
#define LOG_ERROR(tag, fmt, ...)
#endif

// Warning level (2)
#if DEBUG_LEVEL >= 2
#define LOG_WARN(tag, fmt, ...) \
    Serial.printf("%s[WARN][%s] " fmt "%s\n", COLOR_WARN, tag, ##__VA_ARGS__, COLOR_RST)
#else
#define LOG_WARN(tag, fmt, ...)
#endif

// Info level (3) - Normal operational messages
#if DEBUG_LEVEL >= 3
#define LOG_INFO(tag, fmt, ...) \
    Serial.printf("%s[INFO][%s] " fmt "%s\n", COLOR_INFO, tag, ##__VA_ARGS__, COLOR_RST)
#else
#define LOG_INFO(tag, fmt, ...)
#endif

// Debug level (4) - Detailed debug information
#if DEBUG_LEVEL >= 4
#define LOG_DEBUG(tag, fmt, ...) \
    Serial.printf("%s[DBG][%s] " fmt "%s\n", COLOR_DBG, tag, ##__VA_ARGS__, COLOR_RST)
#else
#define LOG_DEBUG(tag, fmt, ...)
#endif

// Trace level (5) - Very verbose, function entry/exit, etc.
#if DEBUG_LEVEL >= 5
#define LOG_TRACE(tag, fmt, ...) \
    Serial.printf("%s[TRACE][%s] " fmt "%s\n", COLOR_TRACE, tag, ##__VA_ARGS__, COLOR_RST)
#define LOG_FUNC_ENTRY(tag) \
    Serial.printf("%s[TRACE][%s] --> %s()%s\n", COLOR_TRACE, tag, __FUNCTION__, COLOR_RST)
#define LOG_FUNC_EXIT(tag) \
    Serial.printf("%s[TRACE][%s] <-- %s()%s\n", COLOR_TRACE, tag, __FUNCTION__, COLOR_RST)
#else
#define LOG_TRACE(tag, fmt, ...)
#define LOG_FUNC_ENTRY(tag)
#define LOG_FUNC_EXIT(tag)
#endif

// Hex dump helper for debugging data
#if DEBUG_LEVEL >= 5
inline void LOG_HEX_DUMP(const char* tag, const uint8_t* data, size_t len) {
    Serial.printf("[TRACE][%s] Hex dump (%d bytes):\n", tag, len);
    for (size_t i = 0; i < len; i++) {
        Serial.printf("%02X ", data[i]);
        if ((i + 1) % 16 == 0) Serial.println();
    }
    if (len % 16 != 0) Serial.println();
}
#else
#define LOG_HEX_DUMP(tag, data, len)
#endif

// Convenience macros for common tags
#define BOOT_TAG    "BOOT"
#define WIFI_TAG    "WIFI"
#define WEB_TAG     "WEB"
#define OTA_TAG     "OTA"
#define CONFIG_TAG  "CONFIG"
#define DISPLAY_TAG "DISPLAY"

#endif // DEBUG_H
