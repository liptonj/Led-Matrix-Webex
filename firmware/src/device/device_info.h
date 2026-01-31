/**
 * @file device_info.h
 * @brief Device information and status reporting
 *
 * Builds JSON responses for device status, telemetry, and configuration.
 */

#ifndef DEVICE_INFO_H
#define DEVICE_INFO_H

#include <Arduino.h>
#include "../supabase/supabase_client.h"

/**
 * @brief Device Info - builds status and config JSON responses
 */
class DeviceInfo {
public:
    /**
     * @brief Build status JSON for get_status command
     * @return JSON string with device status
     */
    static String buildStatusJson();

    /**
     * @brief Build telemetry JSON for get_telemetry command
     * @return JSON string with device telemetry
     */
    static String buildTelemetryJson();

    /**
     * @brief Build configuration JSON for get_config command
     * @return JSON string with device configuration
     */
    static String buildConfigJson();

    /**
     * @brief Apply app state received from Supabase
     * @param appState App state from Supabase sync
     */
    static void applyAppState(const SupabaseAppState& appState);
};

#endif // DEVICE_INFO_H
