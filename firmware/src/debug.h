/**
 * @file debug.h
 * @brief Debug logging utilities
 * 
 * Provides toggleable debug logging that can be enabled/disabled at runtime
 * via the web UI or config API.
 */

#ifndef DEBUG_H
#define DEBUG_H

#include <Arduino.h>

// External reference to debug mode flag (set from config in main.cpp)
extern bool g_debug_mode;

/**
 * Debug logging macro - only logs when debug mode is enabled
 * Usage: DEBUG_LOG("BRIDGE", "Connecting to %s:%d", host.c_str(), port);
 */
#define DEBUG_LOG(tag, fmt, ...) \
    do { \
        if (g_debug_mode) { \
            Serial.printf("[DEBUG][%s] " fmt "\n", tag, ##__VA_ARGS__); \
        } \
    } while(0)

/**
 * Info logging macro - always logs (for important events)
 * Usage: LOG_INFO("WIFI", "Connected to %s", ssid.c_str());
 */
#define LOG_INFO(tag, fmt, ...) \
    Serial.printf("[%s] " fmt "\n", tag, ##__VA_ARGS__)

/**
 * Error logging macro - always logs (for errors)
 * Usage: LOG_ERROR("OTA", "Update failed: %s", error.c_str());
 */
#define LOG_ERROR(tag, fmt, ...) \
    Serial.printf("[ERROR][%s] " fmt "\n", tag, ##__VA_ARGS__)

/**
 * Warning logging macro - always logs (for warnings)
 * Usage: LOG_WARN("CONFIG", "Using default value for %s", key.c_str());
 */
#define LOG_WARN(tag, fmt, ...) \
    Serial.printf("[WARN][%s] " fmt "\n", tag, ##__VA_ARGS__)

#endif // DEBUG_H
