/**
 * @file app_state.h
 * @brief Shared application state structure
 *
 * Defines the AppState struct used across the application.
 */

#ifndef APP_STATE_H
#define APP_STATE_H

#include <Arduino.h>
#include <string.h>

/**
 * @brief Helper function to safely copy a String to a fixed-size buffer
 * @param dest Destination buffer
 * @param size Size of destination buffer (including null terminator)
 * @param src Source String
 * @return true if copied successfully, false if truncated
 */
inline bool safeStrCopy(char* dest, size_t size, const String& src) {
    if (size == 0) return false;
    const char* src_str = src.c_str();
    if (src_str == nullptr) {
        dest[0] = '\0';
        return true;
    }
    size_t len = strlen(src_str);
    if (len >= size) {
        len = size - 1;
    }
    memcpy(dest, src_str, len);
    dest[len] = '\0';
    return len == strlen(src_str);
}

/**
 * @brief Helper function to safely copy a const char* to a fixed-size buffer
 * @param dest Destination buffer
 * @param size Size of destination buffer (including null terminator)
 * @param src Source const char*
 * @return true if copied successfully, false if truncated
 */
inline bool safeStrCopy(char* dest, size_t size, const char* src) {
    if (size == 0) return false;
    if (src == nullptr) {
        dest[0] = '\0';
        return true;
    }
    size_t len = strlen(src);
    if (len >= size) {
        len = size - 1;
    }
    memcpy(dest, src, len);
    dest[len] = '\0';
    return len == strlen(src);
}

/**
 * @brief Helper function to safely copy a string literal to a fixed-size buffer
 */
inline void safeStrCopyLiteral(char* dest, size_t size, const char* src) {
    if (size == 0) return;
    if (src == nullptr) {
        dest[0] = '\0';
        return;
    }
    size_t len = strlen(src);
    if (len >= size) {
        len = size - 1;
    }
    memcpy(dest, src, len);
    dest[len] = '\0';
}

/**
 * @brief Application state structure
 *
 * Holds the current state of all monitored systems.
 */
struct AppState {
    bool wifi_connected = false;
    bool webex_authenticated = false;
    bool embedded_app_connected = false;
    bool xapi_connected = false;
    bool mqtt_connected = false;
    char webex_status[16] = "unknown";  // Values: "active", "call", "meeting", "presenting", "dnd", "quiet", "inactive", "ooo", "pending", "unknown"
    bool webex_status_received = false;  // Set true after first status payload is received
    char webex_status_source[16] = "unknown";  // embedded_app | cloud | local | unknown
    char embedded_app_display_name[65] = "";  // Display name from embedded app user (max 64 chars)
    bool camera_on = false;
    bool mic_muted = false;
    bool in_call = false;
    float temperature = 0.0f;
    float humidity = 0.0f;
    char door_status[8] = "";  // Values: "open", "closed", ""
    int air_quality_index = 0;      // Air quality as numeric index (0-500)
    float tvoc = 0.0f;              // TVOC in ppb
    float co2_ppm = 0.0f;
    float pm2_5 = 0.0f;
    float ambient_noise = 0.0f;
    char sensor_mac[18] = "";  // MAC address format: "AA:BB:CC:DD:EE:FF" (17 chars + null)
    bool sensor_data_valid = false;
    unsigned long last_sensor_update = 0;
    unsigned long last_poll_time = 0;
    unsigned long last_ota_check = 0;
    // Supabase state sync (Phase A)
    bool supabase_connected = false;           // Successfully authenticated with Supabase
    bool supabase_app_connected = false;       // App connected via Supabase (redundant with embedded_app_connected but explicit)
    bool supabase_approval_pending = false;    // Provisioning awaiting admin approval
    bool provisioning_timeout = false;         // Provisioning timeout flag
    bool supabase_disabled = false;            // Disabled by admin
    bool supabase_blacklisted = false;         // Permanently blocked
    bool supabase_deleted = false;             // Server deleted device record
    unsigned long last_supabase_sync = 0;      // Last successful state sync with Supabase
    bool supabase_realtime_resubscribe = false; // Trigger realtime resubscribe on pairing change
    String realtime_error = "";
    String realtime_devices_error = "";
    unsigned long last_realtime_error = 0;
    unsigned long last_realtime_devices_error = 0;
    unsigned long realtime_defer_until = 0;
    // Time tracking
    bool time_synced = false;
};

#endif // APP_STATE_H
