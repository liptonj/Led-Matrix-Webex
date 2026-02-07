/**
 * @file config_export.cpp
 * @brief Configuration Export/Import Domain Implementation
 */

#include "config_manager.h"
#include "../debug/log_system.h"
#include <ArduinoJson.h>

static const char* TAG = "CFG_EXPORT";

// Export/Import Configuration

String ConfigManager::exportConfig() const {
    JsonDocument doc;

    doc["device_name"] = getDeviceName();
    doc["display_name"] = getDisplayName();
    doc["brightness"] = getBrightness();
    doc["scroll_speed_ms"] = getScrollSpeedMs();
    doc["page_interval_ms"] = getPageIntervalMs();
    doc["sensor_page_enabled"] = getSensorPageEnabled();
    doc["display_pages"] = getDisplayPages();
    doc["status_layout"] = getStatusLayout();
    doc["border_width"] = getBorderWidth();
    doc["date_color"] = getDateColor();
    doc["time_color"] = getTimeColor();
    doc["name_color"] = getNameColor();
    doc["metric_color"] = getMetricColor();
    doc["poll_interval"] = getWebexPollInterval();
    doc["xapi_poll"] = getXAPIPollInterval();
    doc["mqtt_broker"] = getMQTTBroker();
    doc["mqtt_port"] = getMQTTPort();
    doc["mqtt_topic"] = getMQTTTopic();
    doc["sensor_serial"] = getSensorSerial();
    doc["sensor_macs"] = getSensorMacsRaw();
    doc["display_sensor_mac"] = getDisplaySensorMac();
    doc["display_metric"] = getDisplayMetric();
    doc["ota_url"] = getOTAUrl();
    doc["auto_update"] = getAutoUpdate();
    doc["supabase_url"] = getSupabaseUrl();
    doc["supabase_anon_key"] = getSupabaseAnonKey();
    doc["time_zone"] = getTimeZone();
    doc["ntp_server"] = getNtpServer();
    doc["time_format"] = getTimeFormat();
    doc["date_format"] = getDateFormat();
    doc["pairing_realtime_debug"] = getPairingRealtimeDebug();
    doc["tls_verify"] = getTlsVerify();

    String output;
    serializeJson(doc, output);
    return output;
}

bool ConfigManager::importConfig(const String& json) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json.c_str());

    if (error) {
        ESP_LOGE(TAG, "Failed to parse config JSON: %s", error.c_str());
        return false;
    }

    if (doc["device_name"].is<const char*>()) {
        setDeviceName(doc["device_name"].as<const char*>());
    }
    if (doc["display_name"].is<const char*>()) {
        setDisplayName(doc["display_name"].as<const char*>());
    }
    if (doc["brightness"].is<int>()) {
        setBrightness(doc["brightness"].as<uint8_t>());
    }
    if (doc["scroll_speed_ms"].is<int>()) {
        setScrollSpeedMs(doc["scroll_speed_ms"].as<uint16_t>());
    }
    if (doc["page_interval_ms"].is<int>()) {
        setPageIntervalMs(doc["page_interval_ms"].as<uint16_t>());
    }
    if (doc["sensor_page_enabled"].is<bool>()) {
        setSensorPageEnabled(doc["sensor_page_enabled"].as<bool>());
    }
    if (doc["display_pages"].is<const char*>()) {
        setDisplayPages(doc["display_pages"].as<const char*>());
    }
    if (doc["status_layout"].is<const char*>()) {
        setStatusLayout(doc["status_layout"].as<const char*>());
    }
    if (doc["border_width"].is<int>()) {
        setBorderWidth(doc["border_width"].as<uint8_t>());
    }
    if (doc["date_color"].is<const char*>()) {
        setDateColor(doc["date_color"].as<const char*>());
    }
    if (doc["time_color"].is<const char*>()) {
        setTimeColor(doc["time_color"].as<const char*>());
    }
    if (doc["name_color"].is<const char*>()) {
        setNameColor(doc["name_color"].as<const char*>());
    }
    if (doc["metric_color"].is<const char*>()) {
        setMetricColor(doc["metric_color"].as<const char*>());
    }
    if (doc["poll_interval"].is<int>()) {
        setWebexPollInterval(doc["poll_interval"].as<uint16_t>());
    }
    if (doc["xapi_poll"].is<int>()) {
        setXAPIPollInterval(doc["xapi_poll"].as<uint16_t>());
    }
    if (doc["mqtt_broker"].is<const char*>()) {
        setMQTTConfig(
            doc["mqtt_broker"].as<const char*>(),
            doc["mqtt_port"] | 1883,
            doc["mqtt_username"] | "",
            doc["mqtt_password"] | "",
            doc["mqtt_topic"] | "meraki/v1/mt/#"
        );
    }
    if (doc["sensor_macs"].is<const char*>()) {
        setSensorMacs(doc["sensor_macs"].as<const char*>());
    } else if (doc["sensor_serial"].is<const char*>()) {
        setSensorSerial(doc["sensor_serial"].as<const char*>());
    }
    if (doc["display_sensor_mac"].is<const char*>()) {
        setDisplaySensorMac(doc["display_sensor_mac"].as<const char*>());
    }
    if (doc["display_metric"].is<const char*>()) {
        setDisplayMetric(doc["display_metric"].as<const char*>());
    }
    if (doc["ota_url"].is<const char*>()) {
        setOTAUrl(doc["ota_url"].as<const char*>());
    }
    if (doc["auto_update"].is<bool>()) {
        setAutoUpdate(doc["auto_update"].as<bool>());
    }
    if (doc["supabase_url"].is<const char*>()) {
        setSupabaseUrl(doc["supabase_url"].as<const char*>());
    }
    if (doc["supabase_anon_key"].is<const char*>()) {
        setSupabaseAnonKey(doc["supabase_anon_key"].as<const char*>());
    }
    if (doc["time_zone"].is<const char*>()) {
        setTimeZone(doc["time_zone"].as<const char*>());
    }
    if (doc["ntp_server"].is<const char*>()) {
        setNtpServer(doc["ntp_server"].as<const char*>());
    }
    if (doc["time_format"].is<const char*>()) {
        setTimeFormat(doc["time_format"].as<const char*>());
    }
    if (doc["date_format"].is<const char*>()) {
        setDateFormat(doc["date_format"].as<const char*>());
    }
    if (doc["pairing_realtime_debug"].is<bool>()) {
        setPairingRealtimeDebug(doc["pairing_realtime_debug"].as<bool>());
    }
    if (doc["tls_verify"].is<bool>()) {
        setTlsVerify(doc["tls_verify"].as<bool>());
    }

    ESP_LOGI(TAG, "Configuration imported successfully");
    return true;
}
