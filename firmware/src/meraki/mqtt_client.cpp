/**
 * @file mqtt_client.cpp
 * @brief Meraki MT Sensor MQTT Client Implementation
 */

#include "mqtt_client.h"
#include <ArduinoJson.h>

// Global instance for callback
MerakiMQTTClient* g_mqtt_instance = nullptr;

MerakiMQTTClient::MerakiMQTTClient()
    : mqtt_client(wifi_client), config_manager(nullptr), update_pending(false), last_reconnect(0) {
    sensor_data.valid = false;
    sensor_data.temperature = 0;
    sensor_data.humidity = 0;
    sensor_data.tvoc = 0;
    sensor_data.iaq = 0;
    sensor_data.air_quality_index = 0;
}

MerakiMQTTClient::~MerakiMQTTClient() {
    disconnect();
}

void MerakiMQTTClient::begin(ConfigManager* config) {
    config_manager = config;
    g_mqtt_instance = this;

    String broker = config_manager->getMQTTBroker();
    uint16_t port = config_manager->getMQTTPort();

    if (broker.isEmpty()) {
        Serial.println("[MQTT] No broker configured");
        return;
    }

    Serial.printf("[MQTT] Connecting to %s:%d\n", broker.c_str(), port);

    mqtt_client.setServer(broker.c_str(), port);
    mqtt_client.setCallback([](char* topic, byte* payload, unsigned int length) {
        if (g_mqtt_instance) {
            g_mqtt_instance->onMessage(topic, payload, length);
        }
    });

    reconnect();
}

void MerakiMQTTClient::loop() {
    if (!config_manager->hasMQTTConfig()) {
        return;
    }

    if (!mqtt_client.connected()) {
        if (millis() - last_reconnect > 30000) {
            last_reconnect = millis();
            reconnect();
        }
        return;
    }

    mqtt_client.loop();
}

bool MerakiMQTTClient::isConnected() {
    return mqtt_client.connected();
}

MerakiSensorData MerakiMQTTClient::getLatestData() {
    update_pending = false;
    return sensor_data;
}

void MerakiMQTTClient::reconnect() {
    if (mqtt_client.connected()) {
        return;
    }

    String client_id = "webex-display-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    String username = config_manager->getMQTTUsername();
    String password = config_manager->getMQTTPassword();

    Serial.println("[MQTT] Attempting connection...");

    bool connected = false;
    if (username.isEmpty()) {
        connected = mqtt_client.connect(client_id.c_str());
    } else {
        connected = mqtt_client.connect(client_id.c_str(), username.c_str(), password.c_str());
    }

    if (connected) {
        Serial.println("[MQTT] Connected!");

        // Subscribe to Meraki MT topics
        String topic = config_manager->getMQTTTopic();
        mqtt_client.subscribe(topic.c_str());
        Serial.printf("[MQTT] Subscribed to: %s\n", topic.c_str());
    } else {
        Serial.printf("[MQTT] Connection failed, rc=%d\n", mqtt_client.state());
    }
}

void MerakiMQTTClient::disconnect() {
    mqtt_client.disconnect();
}

void MerakiMQTTClient::onMessage(char* topic, byte* payload, unsigned int length) {
    String topicStr = String(topic);
    String payloadStr;

    for (unsigned int i = 0; i < length; i++) {
        payloadStr += (char)payload[i];
    }

    parseMessage(topicStr, payloadStr);
}

void MerakiMQTTClient::parseMessage(const String& topic, const String& payload) {
    // Meraki MT topic format: meraki/v1/mt/{network_id}/ble/{sensor_mac}/{metric}

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
        Serial.printf("[MQTT] Failed to parse message: %s\n", error.c_str());
        return;
    }

    // Extract metric type from topic
    int lastSlash = topic.lastIndexOf('/');
    if (lastSlash == -1) return;

    String metric = topic.substring(lastSlash + 1);

    if (metric == "temperature") {
        // Meraki MT sensors can send temperature in C or F
        // Check for unit field or separate C/F fields
        float temp_value = 0.0f;
        bool is_fahrenheit = false;

        // Check if payload has explicit unit field
        if (doc["unit"].is<const char*>()) {
            const char* unit = doc["unit"];
            temp_value = doc["value"] | 0.0f;
            is_fahrenheit = (strcmp(unit, "fahrenheit") == 0 || strcmp(unit, "F") == 0);
        }
        // Check for separate celsius/fahrenheit fields
        else if (doc["celsius"].is<float>() || doc["temperatureC"].is<float>()) {
            temp_value = doc["celsius"] | doc["temperatureC"] | 0.0f;
            is_fahrenheit = false;
        }
        else if (doc["fahrenheit"].is<float>() || doc["temperatureF"].is<float>()) {
            temp_value = doc["fahrenheit"] | doc["temperatureF"] | 0.0f;
            is_fahrenheit = true;
        }
        // Default: assume value field, try to detect by range
        else {
            temp_value = doc["value"] | 0.0f;
            // Heuristic: if value > 50, likely Fahrenheit (room temp in F is 68-77)
            // Room temp in C is 20-25. Threshold at 50 works for most cases.
            is_fahrenheit = (temp_value > 50.0f);
        }

        // Store internally as Celsius (display converts to F)
        if (is_fahrenheit) {
            sensor_data.temperature = (temp_value - 32.0f) * 5.0f / 9.0f;
            Serial.printf("[MQTT] Temperature: %.1f°F (stored as %.1f°C)\n", temp_value, sensor_data.temperature);
        } else {
            sensor_data.temperature = temp_value;
            Serial.printf("[MQTT] Temperature: %.1f°C\n", sensor_data.temperature);
        }
        update_pending = true;

    } else if (metric == "humidity") {
        sensor_data.humidity = doc["value"] | 0.0f;
        update_pending = true;
        Serial.printf("[MQTT] Humidity: %.1f%%\n", sensor_data.humidity);

    } else if (metric == "door") {
        bool open = doc["value"] | false;
        sensor_data.door_status = open ? "open" : "closed";
        update_pending = true;
        Serial.printf("[MQTT] Door: %s\n", sensor_data.door_status.c_str());

    } else if (metric == "water") {
        bool wet = doc["value"] | false;
        sensor_data.water_status = wet ? "wet" : "dry";
        update_pending = true;
        Serial.printf("[MQTT] Water: %s\n", sensor_data.water_status.c_str());

    } else if (metric == "tvoc") {
        sensor_data.tvoc = doc["value"] | 0.0f;
        update_pending = true;
        Serial.printf("[MQTT] TVOC: %.1f ppb\n", sensor_data.tvoc);

    } else if (metric == "iaq") {
        sensor_data.iaq = doc["value"] | 0;
        sensor_data.air_quality_index = sensor_data.iaq;
        update_pending = true;
        Serial.printf("[MQTT] IAQ: %d\n", sensor_data.iaq);
    }

    if (update_pending) {
        sensor_data.timestamp = millis();
        sensor_data.valid = true;
    }
}

