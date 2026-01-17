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
    bool xapi_connected = false;
    bool mqtt_connected = false;
    String webex_status = "unknown";
    bool camera_on = false;
    bool mic_muted = false;
    bool in_call = false;
    float temperature = 0.0f;
    float humidity = 0.0f;
    String door_status = "";
    String air_quality = "";
    unsigned long last_poll_time = 0;
    unsigned long last_ota_check = 0;
};

#endif // APP_STATE_H
