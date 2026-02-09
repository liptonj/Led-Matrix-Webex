/**
 * @file mqtt_client.cpp
 * @brief Meraki MT Sensor MQTT Client Implementation
 */

#include "mqtt_client.h"
#include "../debug/log_system.h"
#include <ArduinoJson.h>
#include <cctype>

static const char* TAG = "MQTT";

namespace {
String normalizeSensorId(const String& input) {
    String out;
    out.reserve(input.length());
    for (size_t i = 0; i < input.length(); i++) {
        char c = input[i];
        if (std::isalnum(static_cast<unsigned char>(c))) {
            out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        }
    }
    return out;
}

String extractSensorFromTopic(const String& topic) {
    const int ble_index = topic.indexOf("/ble/");
    if (ble_index == -1) {
        return "";
    }
    const int start = ble_index + 5;
    const int end = topic.indexOf('/', start);
    if (end == -1 || end <= start) {
        return "";
    }
    return topic.substring(start, end);
}

bool isAllowedSensor(const String& sensor_id, const String& allowed_list) {
    if (allowed_list.isEmpty()) {
        return true;
    }
    const String target = normalizeSensorId(sensor_id);
    if (target.isEmpty()) {
        return false;
    }

    String token;
    for (size_t i = 0; i <= allowed_list.length(); i++) {
        char c = (i < allowed_list.length()) ? allowed_list[i] : ',';
        if (c == ',' || c == ';' || c == '\n') {
            if (!token.isEmpty()) {
                if (normalizeSensorId(token) == target) {
                    return true;
                }
                token = "";
            }
            continue;
        }
        if (c == ' ' || c == '\t' || c == '\r') {
            continue;
        }
        token += c;
    }
    return false;
}

} // namespace

// Global instance for callback
MerakiMQTTClient* g_mqtt_instance = nullptr;

MerakiMQTTClient::MerakiMQTTClient()
    : mqtt_client(wifi_client), config_manager(nullptr), update_pending(false), last_reconnect(0), using_tls(false) {
    sensor_data.valid = false;
    sensor_data.temperature = 0;
    sensor_data.humidity = 0;
    sensor_data.tvoc = 0;
    sensor_data.air_quality_index = 0;
    sensor_data.co2_ppm = 0;
    sensor_data.pm2_5 = 0;
    sensor_data.ambient_noise = 0;
}

MerakiMQTTClient::~MerakiMQTTClient() {
    disconnect();
}

void MerakiMQTTClient::begin(ConfigManager* config) {
    config_manager = config;
    g_mqtt_instance = this;

    // Cache broker and topic as member variables - PubSubClient stores pointers, not copies
    cached_broker = config_manager->getMQTTBroker();
    cached_topic = config_manager->getMQTTTopic();
    uint16_t port = config_manager->getMQTTPort();
    bool use_tls = config_manager->getMQTTUseTLS();

    if (cached_broker.isEmpty()) {
        ESP_LOGD(TAG, "No broker configured - MQTT module disabled");
        return;
    }

    ESP_LOGI(TAG, "Connecting to %s:%d (TLS: %s)",
             cached_broker.c_str(), port, use_tls ? "enabled" : "disabled");

    // Configure TLS client if needed
    if (use_tls) {
        // SECURITY NOTE: Using setInsecure() skips certificate verification.
        // This is a known limitation documented in SECURITY_FIXES_APPLIED.md.
        // 
        // Justification:
        // - MQTT broker is user-configured with varying certificate chains
        // - No universal CA bundle can cover all possible MQTT brokers
        // - TLS still provides encryption (confidentiality) even without cert verification
        // - Data transmitted is low-sensitivity sensor readings (temperature, humidity)
        // - MQTT is optional and disabled by default
        //
        // Future improvement: Add user-configurable CA certificate field for strict verification.
        wifi_client_secure.setInsecure();
        ESP_LOGW(TAG, "MQTT TLS enabled without certificate verification (setInsecure)");
        mqtt_client.setClient(wifi_client_secure);
        using_tls = true;
    } else {
        mqtt_client.setClient(wifi_client);
        using_tls = false;
    }

    mqtt_client.setServer(cached_broker.c_str(), port);
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

    bool currently_connected = mqtt_client.connected();

    // Detect disconnection and log it
    if (last_connected_state && !currently_connected) {
        ESP_LOGW(TAG, "Disconnected (state=%d)", mqtt_client.state());
        last_connected_state = false;
    } else if (!last_connected_state && currently_connected) {
        last_connected_state = true;
    }

    if (!currently_connected) {
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

bool MerakiMQTTClient::getSensorData(const String& sensor_id, MerakiSensorData& out) const {
    const String target = normalizeSensorId(sensor_id);
    for (uint8_t i = 0; i < sensor_count; i++) {
        if (normalizeSensorId(sensors[i].id) == target) {
            out = sensors[i].data;
            return out.valid;
        }
    }
    return false;
}

void MerakiMQTTClient::reconnect() {
    if (mqtt_client.connected()) {
        return;
    }

    // Only refresh from config if our cache is empty (first call or config was cleared)
    if (cached_broker.isEmpty()) {
        cached_broker = config_manager->getMQTTBroker();
        cached_topic = config_manager->getMQTTTopic();
        cached_port = config_manager->getMQTTPort();
        bool use_tls = config_manager->getMQTTUseTLS();
        
        if (cached_broker.isEmpty()) {
            return;  // Still no broker configured
        }
        
        // Update TLS setting if needed
        if (use_tls != using_tls) {
            if (use_tls) {
                wifi_client_secure.setInsecure();
                mqtt_client.setClient(wifi_client_secure);
                using_tls = true;
            } else {
                mqtt_client.setClient(wifi_client);
                using_tls = false;
            }
        }
        
        // Set server once when we get a valid broker
        mqtt_client.setServer(cached_broker.c_str(), cached_port);
    }

    String client_id = "webex-display-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    String username = config_manager->getMQTTUsername();
    String password = config_manager->getMQTTPassword();

    ESP_LOGI(TAG, "Attempting connection to %s:%d (TLS: %s)...",
             cached_broker.c_str(), cached_port, using_tls ? "enabled" : "disabled");

    bool connected = false;
    if (username.isEmpty()) {
        connected = mqtt_client.connect(client_id.c_str());
    } else {
        connected = mqtt_client.connect(client_id.c_str(), username.c_str(), password.c_str());
    }

    if (connected) {
        ESP_LOGI(TAG, "Connected to %s:%d", cached_broker.c_str(), cached_port);

        // Subscribe to Meraki MT topics using cached topic
        mqtt_client.subscribe(cached_topic.c_str());
        ESP_LOGI(TAG, "Subscribed to: %s", cached_topic.c_str());
    } else {
        ESP_LOGW(TAG, "Connection failed, rc=%d", mqtt_client.state());
    }
}

void MerakiMQTTClient::disconnect() {
    mqtt_client.disconnect();
}

void MerakiMQTTClient::invalidateConfig() {
    disconnect();
    cached_broker = "";
    cached_topic = "";
    cached_port = 1883;
    ESP_LOGI(TAG, "Config invalidated - will reload on next reconnect");
}

void MerakiMQTTClient::onMessage(char* topic, byte* payload, unsigned int length) {
    String topicStr = String(topic);
    String payloadStr;
    payloadStr.reserve(length);

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
        ESP_LOGW(TAG, "Failed to parse message: %s", error.c_str());
        return;
    }

    const String topic_sensor = extractSensorFromTopic(topic);
    const String configured_macs = config_manager ? config_manager->getSensorMacs() : "";
    if (!isAllowedSensor(topic_sensor, configured_macs)) {
        return;
    }

    SensorEntry* entry = getOrCreateSensor(topic_sensor);
    if (!entry) {
        ESP_LOGW(TAG, "Sensor list full - ignoring update for %s", topic_sensor.c_str());
        return;
    }
    MerakiSensorData& sensor = entry->data;
    sensor.sensor_mac = topic_sensor;

    // Extract metric type from topic
    int lastSlash = topic.lastIndexOf('/');
    if (lastSlash == -1) return;

    String metric = topic.substring(lastSlash + 1);

    if (metric == "temperature") {
        // Meraki MT sensors can send temperature in C or F
        // Check for unit field or separate C/F fields
        float temp_value = 0.0f;
        bool is_fahrenheit = false;

        // Check for explicit unit field with value
        if (doc["unit"].is<const char*>() && doc["value"].is<float>()) {
            const char* unit = doc["unit"];
            temp_value = doc["value"] | 0.0f;
            is_fahrenheit = (strcmp(unit, "fahrenheit") == 0 || strcmp(unit, "F") == 0);
        }
        // Meraki MT15 format: explicit celsius/fahrenheit fields
        else if (doc["celsius"].is<float>()) {
            temp_value = doc["celsius"] | 0.0f;
            is_fahrenheit = false;
        }
        else if (doc["fahrenheit"].is<float>()) {
            temp_value = doc["fahrenheit"] | 0.0f;
            is_fahrenheit = true;
        }
        // Legacy fields
        else if (doc["temperatureC"].is<float>()) {
            temp_value = doc["temperatureC"] | 0.0f;
            is_fahrenheit = false;
        }
        else if (doc["temperatureF"].is<float>()) {
            temp_value = doc["temperatureF"] | 0.0f;
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
            sensor.temperature = (temp_value - 32.0f) * 5.0f / 9.0f;
            ESP_LOGD(TAG, "Temperature: %.1f°F (stored as %.1f°C)", temp_value, sensor.temperature);
        } else {
            sensor.temperature = temp_value;
            ESP_LOGD(TAG, "Temperature: %.1f°C", sensor.temperature);
        }
        update_pending = true;

    } else if (metric == "humidity") {
        if (doc["humidity"].is<float>()) {
            sensor.humidity = doc["humidity"] | 0.0f;
        } else {
            sensor.humidity = doc["value"] | 0.0f;
        }
        update_pending = true;
        ESP_LOGD(TAG, "Humidity: %.1f%%", sensor.humidity);

    } else if (metric == "door") {
        bool open = doc["value"] | false;
        sensor.door_status = open ? "open" : "closed";
        update_pending = true;
        ESP_LOGD(TAG, "Door: %s", sensor.door_status.c_str());

    } else if (metric == "tvoc") {
        if (doc["tvoc"].is<float>()) {
            sensor.tvoc = doc["tvoc"] | 0.0f;
        } else {
            sensor.tvoc = doc["value"] | 0.0f;
        }
        update_pending = true;
        ESP_LOGD(TAG, "TVOC: %.1f", sensor.tvoc);

    } else if (metric == "iaqIndex") {
        sensor.air_quality_index = doc["iaqIndex"] | doc["value"] | 0;
        update_pending = true;
        ESP_LOGD(TAG, "IAQ Index: %d", sensor.air_quality_index);

    } else if (metric == "CO2") {
        sensor.co2_ppm = doc["CO2"] | doc["value"] | 0.0f;
        update_pending = true;
        ESP_LOGD(TAG, "CO2: %.1f ppm", sensor.co2_ppm);
    } else if (metric == "PM2_5MassConcentration") {
        sensor.pm2_5 = doc["PM2_5MassConcentration"] | doc["value"] | 0.0f;
        update_pending = true;
        ESP_LOGD(TAG, "PM2.5: %.1f", sensor.pm2_5);
    } else if (metric == "ambientNoise") {
        sensor.ambient_noise = doc["ambientNoise"] | doc["value"] | 0.0f;
        update_pending = true;
        ESP_LOGD(TAG, "Noise: %.1f", sensor.ambient_noise);
    }

    if (update_pending) {
        sensor.timestamp = millis();
        sensor.valid = true;
        sensor_data = sensor;
        latest_sensor_id = topic_sensor;
        ESP_LOGD(TAG, "Sensor %s updated: temp=%.1f hum=%.1f",
                 topic_sensor.c_str(), sensor.temperature, sensor.humidity);
    }
}

MerakiMQTTClient::SensorEntry* MerakiMQTTClient::getOrCreateSensor(const String& sensor_id) {
    for (uint8_t i = 0; i < sensor_count; i++) {
        if (sensors[i].id == sensor_id) {
            return &sensors[i];
        }
    }
    if (sensor_count >= MAX_SENSORS) {
        return nullptr;
    }
    sensors[sensor_count].id = sensor_id;
    sensors[sensor_count].data.valid = false;
    sensors[sensor_count].data.temperature = 0.0f;
    sensors[sensor_count].data.humidity = 0.0f;
    sensors[sensor_count].data.tvoc = 0.0f;
    sensors[sensor_count].data.air_quality_index = 0;
    sensors[sensor_count].data.co2_ppm = 0.0f;
    sensors[sensor_count].data.pm2_5 = 0.0f;
    sensors[sensor_count].data.ambient_noise = 0.0f;
    sensors[sensor_count].data.sensor_mac = sensor_id;
    sensor_count++;
    return &sensors[sensor_count - 1];
}
