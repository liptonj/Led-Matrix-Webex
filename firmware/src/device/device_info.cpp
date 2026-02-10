/**
 * @file device_info.cpp
 * @brief Device Information Implementation
 */

#include "device_info.h"
#include "../app_state.h"
#include "../config/config_manager.h"
#include "../auth/device_credentials.h"
#include "../common/pairing_manager.h"
#include "../core/dependencies.h"
#include "../debug/log_system.h"
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_ota_ops.h>

static const char* TAG = "DEVICE";

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

String DeviceInfo::buildStatusJson() {
    auto& deps = getDependencies();
    JsonDocument doc;

    doc["wifi_connected"] = deps.app_state.wifi_connected;
    doc["webex_authenticated"] = deps.app_state.webex_authenticated;
    doc["webex_status"] = deps.app_state.webex_status;
    doc["webex_status_source"] = deps.app_state.webex_status_source;
    doc["supabase_approval_pending"] = deps.app_state.supabase_approval_pending;
    doc["supabase_disabled"] = deps.app_state.supabase_disabled;
    doc["supabase_blacklisted"] = deps.app_state.supabase_blacklisted;
    doc["supabase_deleted"] = deps.app_state.supabase_deleted;
    doc["camera_on"] = deps.app_state.camera_on;
    doc["mic_muted"] = deps.app_state.mic_muted;
    doc["in_call"] = deps.app_state.in_call;
    doc["serial_number"] = deps.credentials.getSerialNumber();
    
    // Include device_uuid if authenticated (UUID identity migration)
    if (deps.supabase.isAuthenticated()) {
        String deviceUuid = deps.config.getDeviceUuid();
        if (!deviceUuid.isEmpty()) {
            doc["device_uuid"] = deviceUuid;
        }
    }
    
    doc["ip_address"] = WiFi.localIP().toString();
    doc["mac_address"] = WiFi.macAddress();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["rssi"] = WiFi.RSSI();

    // Sensor data
    doc["temperature"] = deps.app_state.temperature;
    doc["humidity"] = deps.app_state.humidity;
    doc["door_status"] = deps.app_state.door_status;
    doc["air_quality"] = deps.app_state.air_quality_index;
    doc["tvoc"] = deps.app_state.tvoc;

    String result;
    result.reserve(1024);
    serializeJson(doc, result);
    return result;
}

String DeviceInfo::buildTelemetryJson() {
    auto& deps = getDependencies();
    JsonDocument doc;

    doc["rssi"] = WiFi.RSSI();
    doc["free_heap"] = ESP.getFreeHeap();
    doc["uptime"] = millis() / 1000;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["temperature"] = deps.app_state.temperature;
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
    auto& deps = getDependencies();
    JsonDocument doc;

    doc["device_name"] = deps.config.getDeviceName();
    doc["display_name"] = deps.config.getDisplayName();
    doc["brightness"] = deps.config.getBrightness();
    doc["scroll_speed_ms"] = deps.config.getScrollSpeedMs();
    doc["page_interval_ms"] = deps.config.getPageIntervalMs();
    doc["sensor_page_enabled"] = deps.config.getSensorPageEnabled();
    doc["display_pages"] = deps.config.getDisplayPages();
    doc["status_layout"] = deps.config.getStatusLayout();
    doc["date_color"] = deps.config.getDateColor();
    doc["time_color"] = deps.config.getTimeColor();
    doc["name_color"] = deps.config.getNameColor();
    doc["metric_color"] = deps.config.getMetricColor();
    doc["poll_interval"] = deps.config.getWebexPollInterval();
    doc["time_zone"] = deps.config.getTimeZone();
    doc["time_format"] = deps.config.getTimeFormat();
    doc["date_format"] = deps.config.getDateFormat();
    doc["ntp_server"] = deps.config.getNtpServer();
    doc["has_webex_credentials"] = deps.config.hasWebexCredentials();
    doc["has_webex_tokens"] = deps.config.hasWebexTokens();
    doc["ota_url"] = deps.config.getOTAUrl();
    doc["auto_update"] = deps.config.getAutoUpdate();
    doc["tls_verify"] = deps.config.getTlsVerify();
    
    // Include device_uuid if authenticated (UUID identity migration)
    if (deps.supabase.isAuthenticated()) {
        String deviceUuid = deps.config.getDeviceUuid();
        if (!deviceUuid.isEmpty()) {
            doc["device_uuid"] = deviceUuid;
        }
    }

    // MQTT settings - always include so embedded app can show current state
    doc["mqtt_broker"] = deps.config.getMQTTBroker();
    doc["mqtt_port"] = deps.config.getMQTTPort();
    doc["mqtt_username"] = deps.config.getMQTTUsername();
    doc["has_mqtt_password"] = !deps.config.getMQTTPassword().isEmpty();
    doc["mqtt_topic"] = deps.config.getMQTTTopic();

    // Sensor settings
    doc["display_sensor_mac"] = deps.config.getDisplaySensorMac();
    doc["display_metric"] = deps.config.getDisplayMetric();
    doc["sensor_macs"] = deps.config.getSensorMacs();
    doc["sensor_serial"] = deps.config.getSensorSerial();

    // Supabase settings
    doc["supabase_url"] = deps.config.getSupabaseUrl();
    doc["has_supabase_anon_key"] = !deps.config.getSupabaseAnonKey().isEmpty();

    String result;
    result.reserve(1536);
    serializeJson(doc, result);
    return result;
}

void DeviceInfo::applyAppState(const SupabaseAppState& appState) {
    auto& deps = getDependencies();
    if (!appState.valid) {
        return;
    }

    deps.app_state.last_supabase_sync = millis();
    deps.app_state.supabase_connected = true;
    deps.app_state.supabase_app_connected = appState.app_connected;
    deps.app_state.embedded_app_connected = appState.app_connected;

    // If Supabase reports app connected, use it as source of truth
    if (appState.app_connected) {
        safeStrCopy(deps.app_state.webex_status, sizeof(deps.app_state.webex_status), appState.webex_status);
        deps.app_state.webex_status_received = true;
        safeStrCopyLiteral(deps.app_state.webex_status_source, sizeof(deps.app_state.webex_status_source), "embedded_app");

        if (!appState.display_name.isEmpty()) {
            safeStrCopy(deps.app_state.embedded_app_display_name, sizeof(deps.app_state.embedded_app_display_name), appState.display_name);
        }

        // Only update camera/mic/call state if not using xAPI
        if (!deps.app_state.xapi_connected) {
            deps.app_state.camera_on = appState.camera_on;
            deps.app_state.mic_muted = appState.mic_muted;
            deps.app_state.in_call = appState.in_call;

            // Fallback: derive in_call from status if not explicitly set
            if (!appState.in_call && (strcmp(appState.webex_status.c_str(), "meeting") == 0 ||
                                       strcmp(appState.webex_status.c_str(), "busy") == 0 ||
                                       strcmp(appState.webex_status.c_str(), "call") == 0 ||
                                       strcmp(appState.webex_status.c_str(), "presenting") == 0)) {
                deps.app_state.in_call = true;
            }
        }
    }
}
