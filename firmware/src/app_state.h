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
    bool bridge_connected = false;
    bool embedded_app_connected = false;
    bool xapi_connected = false;
    bool mqtt_connected = false;
    bool bridge_config_changed = false;  // Flag to trigger bridge reconnection
    String webex_status = "unknown";
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
    unsigned long last_poll_time = 0;
    unsigned long last_ota_check = 0;
    unsigned long last_bridge_status_time = 0;  // Track when last status received from bridge
    // Time tracking
    bool time_synced = false;
};

#endif // APP_STATE_H
