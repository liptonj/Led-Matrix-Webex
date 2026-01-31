/**
 * @file app_state.h
 * @brief Shared application state structure
 *
 * Defines the AppState struct used across the application.
 */

#ifndef APP_STATE_H
#define APP_STATE_H

#include <Arduino.h>

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
    String webex_status = "unknown";
    bool webex_status_received = false;  // Set true after first status payload is received
    String webex_status_source = "unknown";  // embedded_app | cloud | local | unknown
    String embedded_app_display_name = "";  // Display name from embedded app user
    bool camera_on = false;
    bool mic_muted = false;
    bool in_call = false;
    float temperature = 0.0f;
    float humidity = 0.0f;
    String door_status = "";
    int air_quality_index = 0;      // Air quality as numeric index (0-500)
    float tvoc = 0.0f;              // TVOC in ppb
    float co2_ppm = 0.0f;
    float pm2_5 = 0.0f;
    float ambient_noise = 0.0f;
    String sensor_mac = "";
    bool sensor_data_valid = false;
    unsigned long last_sensor_update = 0;
    unsigned long last_poll_time = 0;
    unsigned long last_ota_check = 0;
    // Supabase state sync (Phase A)
    bool supabase_connected = false;           // Successfully authenticated with Supabase
    bool supabase_app_connected = false;       // App connected via Supabase (redundant with embedded_app_connected but explicit)
    bool supabase_approval_pending = false;    // Provisioning awaiting admin approval
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
