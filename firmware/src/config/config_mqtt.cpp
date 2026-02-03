/**
 * @file config_mqtt.cpp
 * @brief MQTT Configuration Domain Implementation
 */

#include "config_manager.h"
#include "config_macros.h"

// MQTT Configuration

CONFIG_LAZY_CACHED_STRING_GETTER(MQTTBroker, cached_mqtt_broker)
CONFIG_LAZY_CACHED_UINT16_GETTER(MQTTPort, cached_mqtt_port)
CONFIG_LAZY_CACHED_STRING_GETTER(MQTTUsername, cached_mqtt_username)
CONFIG_LAZY_CACHED_STRING_GETTER(MQTTPassword, cached_mqtt_password)

String ConfigManager::getMQTTTopic() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_mqtt_topic.isEmpty() ? "meraki/v1/mt/#" : cached_mqtt_topic;
}

CONFIG_LAZY_CACHED_BOOL_GETTER(MQTTUseTLS, cached_mqtt_use_tls)

void ConfigManager::setMQTTConfig(const String& broker, uint16_t port,
                                  const String& username, const String& password,
                                  const String& topic, bool use_tls) {
    saveString("mqtt_broker", broker);
    saveUInt("mqtt_port", port);
    saveString("mqtt_user", username);
    saveString("mqtt_pass", password);
    saveString("mqtt_topic", topic);
    saveBool("mqtt_tls", use_tls);
    cached_mqtt_broker = broker;
    cached_mqtt_port = port;
    cached_mqtt_username = username;
    cached_mqtt_password = password;
    cached_mqtt_topic = topic;
    cached_mqtt_use_tls = use_tls;
    Serial.printf("[CONFIG] MQTT config saved: %s:%d (TLS: %s)\n", broker.c_str(), port, use_tls ? "enabled" : "disabled");
}

void ConfigManager::updateMQTTConfig(const String& broker, uint16_t port,
                                     const String& username, const String& password,
                                     bool updatePassword, const String& topic, bool use_tls) {
    // Always update broker (required field)
    saveString("mqtt_broker", broker);
    cached_mqtt_broker = broker;
    
    // Update port (always provided, even if same)
    saveUInt("mqtt_port", port);
    cached_mqtt_port = port;
    
    // Update username (always provided, even if empty to clear it)
    saveString("mqtt_user", username);
    cached_mqtt_username = username;
    
    // Only update password if explicitly provided
    if (updatePassword) {
        saveString("mqtt_pass", password);
        cached_mqtt_password = password;
    }
    // else: password remains unchanged
    
    // Update topic (always provided)
    saveString("mqtt_topic", topic);
    cached_mqtt_topic = topic;
    
    // Update TLS setting
    saveBool("mqtt_tls", use_tls);
    cached_mqtt_use_tls = use_tls;
    
    Serial.printf("[CONFIG] MQTT config updated: %s:%d (TLS: %s, password %s)\n", 
                  cached_mqtt_broker.c_str(), cached_mqtt_port,
                  use_tls ? "enabled" : "disabled",
                  updatePassword ? "updated" : "unchanged");
}

void ConfigManager::setMQTTUseTLS(bool use_tls) {
    saveBool("mqtt_tls", use_tls);
    cached_mqtt_use_tls = use_tls;
    Serial.printf("[CONFIG] MQTT TLS %s\n", use_tls ? "enabled" : "disabled");
}

bool ConfigManager::hasMQTTConfig() const {
    return !getMQTTBroker().isEmpty();
}

CONFIG_UNCACHED_STRING_GETTER(SensorSerial, "sensor_serial", "")

void ConfigManager::setSensorSerial(const String& serial) {
    saveString("sensor_serial", serial);
    Serial.printf("[CONFIG] Sensor serial saved: %s\n", serial.c_str());
}

String ConfigManager::getSensorMacs() const {
    if (!cache_loaded) {
        loadCache();
    }
    if (!cached_sensor_macs.isEmpty()) {
        return cached_sensor_macs;
    }
    return getSensorSerial();
}

String ConfigManager::getSensorMacsRaw() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_sensor_macs;
}

String ConfigManager::getDisplaySensorMac() const {
    if (!cache_loaded) {
        loadCache();
    }
    return cached_display_sensor_mac;
}

String ConfigManager::getDisplayMetric() const {
    if (!cache_loaded) {
        loadCache();
    }
    if (!cached_display_metric.isEmpty()) {
        return cached_display_metric;
    }
    return "tvoc";
}

void ConfigManager::setSensorMacs(const String& macs) {
    saveString("sensor_macs", macs);
    cached_sensor_macs = macs;
    if (!macs.isEmpty()) {
        saveString("sensor_serial", "");
    }
    Serial.printf("[CONFIG] Sensor MACs saved: %s\n", macs.c_str());
}

void ConfigManager::setDisplaySensorMac(const String& mac) {
    saveString("display_sensor_mac", mac);
    cached_display_sensor_mac = mac;
    Serial.printf("[CONFIG] Display sensor MAC saved: %s\n", mac.c_str());
}

void ConfigManager::setDisplayMetric(const String& metric) {
    saveString("display_metric", metric);
    cached_display_metric = metric;
    Serial.printf("[CONFIG] Display metric saved: %s\n", metric.c_str());
}
