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

// External debug flags for specific subsystems (set from config in main.cpp)
extern bool g_debug_display;   // Display rendering debug logs
extern bool g_debug_realtime;  // Realtime/WebSocket debug logs

// Compile-time debug toggle for Supabase auth payload logging (dev-only)
#ifndef SUPABASE_AUTH_DEBUG
#define SUPABASE_AUTH_DEBUG 1
#endif

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
 * Display debug logging - only logs when display debugging is enabled
 * Usage: DEBUG_DISPLAY("Rendering status page");
 */
#define DEBUG_DISPLAY(fmt, ...) \
    do { \
        if (g_debug_display) { \
            Serial.printf("[DEBUG][DISPLAY] " fmt "\n", ##__VA_ARGS__); \
        } \
    } while(0)

/**
 * Realtime debug logging - only logs when realtime debugging is enabled
 * Usage: DEBUG_REALTIME("WebSocket message: %s", msg.c_str());
 */
#define DEBUG_REALTIME(fmt, ...) \
    do { \
        if (g_debug_realtime) { \
            Serial.printf("[DEBUG][REALTIME] " fmt "\n", ##__VA_ARGS__); \
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
