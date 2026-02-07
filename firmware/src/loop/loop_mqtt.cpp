/**
 * @file loop_mqtt.cpp
 * @brief MQTT handler
 *
 * Handles MQTT connection and sensor data processing.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include "meraki/mqtt_client.h"
#include "config/config_manager.h"
#include "display/matrix_display.h"
#include "../core/dependencies.h"
#include "../supabase/supabase_realtime.h"
#include <ArduinoJson.h>
#include <time.h>

// =============================================================================
// MQTT HANDLER
// =============================================================================

void handleMQTT(LoopContext& ctx) {
    auto& deps = getDependencies();
    if (deps.display.isOTALocked()) {
        return;
    }

    if (!ctx.app_state->wifi_connected || !ctx.config_manager->hasMQTTConfig()) {
        ctx.app_state->mqtt_connected = false;
        ctx.app_state->sensor_data_valid = false;
        return;
    }

    if (!ctx.mqtt_client->isInitialized()) {
        ctx.mqtt_client->begin(ctx.config_manager);
    }

    ctx.mqtt_client->loop();
    ctx.app_state->mqtt_connected = ctx.mqtt_client->isConnected();
    if (!ctx.app_state->mqtt_connected) {
        ctx.app_state->sensor_data_valid = false;
    }

    // Check for sensor updates
    static String last_display_sensor;
    const String configured_display_sensor = ctx.config_manager->getDisplaySensorMac();
    const bool update_available = ctx.mqtt_client->hasUpdate();

    if (update_available) {
        MerakiSensorData latest = ctx.mqtt_client->getLatestData();
        if (configured_display_sensor.isEmpty()) {
            ctx.app_state->temperature = latest.temperature;
            ctx.app_state->humidity = latest.humidity;
            ctx.app_state->door_status = latest.door_status;
            ctx.app_state->air_quality_index = latest.air_quality_index;
            ctx.app_state->tvoc = latest.tvoc;
            ctx.app_state->co2_ppm = latest.co2_ppm;
            ctx.app_state->pm2_5 = latest.pm2_5;
            ctx.app_state->ambient_noise = latest.ambient_noise;
            ctx.app_state->sensor_mac = latest.sensor_mac;
            last_display_sensor = latest.sensor_mac;
            ctx.app_state->sensor_data_valid = latest.valid;
            ctx.app_state->last_sensor_update = millis();
            
            // Broadcast sensor data via realtime
            if (deps.realtime.isConnected()) {
                JsonDocument sensorDoc;
                sensorDoc["device_uuid"] = deps.config.getDeviceUuid();
                sensorDoc["temperature"] = latest.temperature;
                sensorDoc["humidity"] = latest.humidity;
                sensorDoc["door_status"] = latest.door_status;
                sensorDoc["air_quality_index"] = latest.air_quality_index;
                sensorDoc["tvoc"] = latest.tvoc;
                sensorDoc["co2_ppm"] = latest.co2_ppm;
                sensorDoc["pm2_5"] = latest.pm2_5;
                sensorDoc["ambient_noise"] = latest.ambient_noise;
                sensorDoc["sensor_mac"] = latest.sensor_mac;
                sensorDoc["timestamp"] = (unsigned long)time(nullptr);
                deps.realtime.sendBroadcast("sensor_data", sensorDoc);
            }
        }
    }

    if (!configured_display_sensor.isEmpty() &&
        (update_available || configured_display_sensor != last_display_sensor)) {
        MerakiSensorData selected;
        if (ctx.mqtt_client->getSensorData(configured_display_sensor, selected)) {
            ctx.app_state->temperature = selected.temperature;
            ctx.app_state->humidity = selected.humidity;
            ctx.app_state->door_status = selected.door_status;
            ctx.app_state->air_quality_index = selected.air_quality_index;
            ctx.app_state->tvoc = selected.tvoc;
            ctx.app_state->co2_ppm = selected.co2_ppm;
            ctx.app_state->pm2_5 = selected.pm2_5;
            ctx.app_state->ambient_noise = selected.ambient_noise;
            ctx.app_state->sensor_mac = configured_display_sensor;
            last_display_sensor = configured_display_sensor;
            ctx.app_state->sensor_data_valid = selected.valid;
            ctx.app_state->last_sensor_update = millis();
            
            // Broadcast sensor data via realtime
            if (deps.realtime.isConnected()) {
                JsonDocument sensorDoc;
                sensorDoc["device_uuid"] = deps.config.getDeviceUuid();
                sensorDoc["temperature"] = selected.temperature;
                sensorDoc["humidity"] = selected.humidity;
                sensorDoc["door_status"] = selected.door_status;
                sensorDoc["air_quality_index"] = selected.air_quality_index;
                sensorDoc["tvoc"] = selected.tvoc;
                sensorDoc["co2_ppm"] = selected.co2_ppm;
                sensorDoc["pm2_5"] = selected.pm2_5;
                sensorDoc["ambient_noise"] = selected.ambient_noise;
                sensorDoc["sensor_mac"] = selected.sensor_mac;
                sensorDoc["timestamp"] = (unsigned long)time(nullptr);
                deps.realtime.sendBroadcast("sensor_data", sensorDoc);
            }
        }
    }
}

#endif // !NATIVE_BUILD
