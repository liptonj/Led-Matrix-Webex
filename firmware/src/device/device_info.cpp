/**
 * @file device_info.cpp
 * @brief Device Information Implementation
 */

#include "device_info.h"
#include "../app_state.h"
#include "../config/config_manager.h"
#include "../auth/device_credentials.h"
#include "../common/pairing_manager.h"
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_ota_ops.h>

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

extern AppState app_state;
extern ConfigManager config_manager;
extern DeviceCredentials deviceCredentials;
extern PairingManager pairing_manager;

String DeviceInfo::buildStatusJson() {
    JsonDocument doc;

    doc["wifi_connected"] = app_state.wifi_connected;
    doc["webex_authenticated"] = app_state.webex_authenticated;
    doc["webex_status"] = app_state.webex_status;
    doc["webex_status_source"] = app_state.webex_status_source;
    doc["supabase_approval_pending"] = app_state.supabase_approval_pending;
    doc["supabase_disabled"] = app_state.supabase_disabled;
    doc["supabase_blacklisted"] = app_state.supabase_blacklisted;
    doc["supabase_deleted"] = app_state.supabase_deleted;
    doc["camera_on"] = app_state.camera_on;
    doc["mic_muted"] = app_state.mic_muted;
    doc["in_call"] = app_state.in_call;
    doc["pairing_code"] = pairing_manager.getCode();
    doc["serial_number"] = deviceCredentials.getSerialNumber();
    doc["ip_address"] = WiFi.localIP().toString();
    doc["mac_address"] = WiFi.macAddress();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["rssi"] = WiFi.RSSI();

    // Sensor data
    doc["temperature"] = app_state.temperature;
    doc["humidity"] = app_state.humidity;
    doc["door_status"] = app_state.door_status;
    doc["air_quality"] = app_state.air_quality_index;
    doc["tvoc"] = app_state.tvoc;

    String result;
    result.reserve(1024);
    serializeJson(doc, result);
    return result;
}

String DeviceInfo::buildTelemetryJson() {
    JsonDocument doc;

    doc["rssi"] = WiFi.RSSI();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["temperature"] = app_state.temperature;
    doc["ssid"] = WiFi.SSID();

    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        doc["ota_partition"] = running->label;
    }

    String result;
    result.reserve(384);
    serializeJson(doc, result);
    return result;
}

String DeviceInfo::buildConfigJson() {
    JsonDocument doc;

    doc["device_name"] = config_manager.getDeviceName();
    doc["display_name"] = config_manager.getDisplayName();
    doc["brightness"] = config_manager.getBrightness();
    doc["scroll_speed_ms"] = config_manager.getScrollSpeedMs();
    doc["page_interval_ms"] = config_manager.getPageIntervalMs();
    doc["sensor_page_enabled"] = config_manager.getSensorPageEnabled();
    doc["display_pages"] = config_manager.getDisplayPages();
    doc["status_layout"] = config_manager.getStatusLayout();
    doc["date_color"] = config_manager.getDateColor();
    doc["time_color"] = config_manager.getTimeColor();
    doc["name_color"] = config_manager.getNameColor();
    doc["metric_color"] = config_manager.getMetricColor();
    doc["poll_interval"] = config_manager.getWebexPollInterval();
    doc["time_zone"] = config_manager.getTimeZone();
    doc["time_format"] = config_manager.getTimeFormat();
    doc["date_format"] = config_manager.getDateFormat();
    doc["ntp_server"] = config_manager.getNtpServer();
    doc["has_webex_credentials"] = config_manager.hasWebexCredentials();
    doc["has_webex_tokens"] = config_manager.hasWebexTokens();
    doc["ota_url"] = config_manager.getOTAUrl();
    doc["auto_update"] = config_manager.getAutoUpdate();
    doc["pairing_code"] = pairing_manager.getCode();
    doc["tls_verify"] = config_manager.getTlsVerify();

    // MQTT settings
    if (config_manager.hasMQTTConfig()) {
        doc["mqtt_broker"] = config_manager.getMQTTBroker();
        doc["mqtt_port"] = config_manager.getMQTTPort();
        doc["mqtt_username"] = config_manager.getMQTTUsername();
        doc["has_mqtt_password"] = !config_manager.getMQTTPassword().isEmpty();
        doc["mqtt_topic"] = config_manager.getMQTTTopic();
    }

    // Sensor settings
    doc["display_sensor_mac"] = config_manager.getDisplaySensorMac();
    doc["display_metric"] = config_manager.getDisplayMetric();
    doc["sensor_macs"] = config_manager.getSensorMacs();
    doc["sensor_serial"] = config_manager.getSensorSerial();

    // Supabase settings
    doc["supabase_url"] = config_manager.getSupabaseUrl();
    doc["has_supabase_anon_key"] = !config_manager.getSupabaseAnonKey().isEmpty();

    String result;
    result.reserve(1536);
    serializeJson(doc, result);
    return result;
}

void DeviceInfo::applyAppState(const SupabaseAppState& appState) {
    if (!appState.valid) {
        return;
    }

    app_state.last_supabase_sync = millis();
    app_state.supabase_connected = true;
    app_state.supabase_app_connected = appState.app_connected;
    app_state.embedded_app_connected = appState.app_connected;

    // If Supabase reports app connected, use it as source of truth
    if (appState.app_connected) {
        app_state.webex_status = appState.webex_status;
        app_state.webex_status_received = true;
        app_state.webex_status_source = "embedded_app";

        if (!appState.display_name.isEmpty()) {
            app_state.embedded_app_display_name = appState.display_name;
        }

        // Only update camera/mic/call state if not using xAPI
        if (!app_state.xapi_connected) {
            app_state.camera_on = appState.camera_on;
            app_state.mic_muted = appState.mic_muted;
            app_state.in_call = appState.in_call;

            // Fallback: derive in_call from status if not explicitly set
            if (!appState.in_call && (appState.webex_status == "meeting" ||
                                       appState.webex_status == "busy" ||
                                       appState.webex_status == "call" ||
                                       appState.webex_status == "presenting")) {
                app_state.in_call = true;
            }
        }
    }
}
