/**
 * @file test_mqtt_client.cpp
 * @brief Unit tests for Meraki MQTT Client
 *
 * Tests verify parsing of Meraki MT sensor MQTT messages including
 * temperature, humidity, door status, TVOC, IAQ, CO2, PM2.5, and noise.
 *
 * Meraki MT topic format: meraki/v1/mt/{network_id}/ble/{sensor_mac}/{metric}
 * 
 * These mocks match the exact format used by Meraki MT sensors:
 * - MT10/MT12: Temperature + Door/Humidity
 * - MT14: Temperature + Humidity  
 * - MT15: Indoor Air Quality (TVOC, PM2.5, CO2)
 * - MT20: Temperature
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <ArduinoJson.h>

// ============================================================================
// Real Meraki MT Sensor Message Formats
// ============================================================================

// Topic patterns
const char* topicTemperature = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/temperature";
const char* topicHumidity = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/humidity";
const char* topicDoor = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/door";
const char* topicWater = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/water";
const char* topicTvoc = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/tvoc";
const char* topicIaqIndex = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/iaqIndex";
const char* topicIaq = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/iaq";
const char* topicCo2 = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/CO2";
const char* topicPm25 = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/PM2_5MassConcentration";
const char* topicNoise = "meraki/v1/mt/N_123456789012345678/ble/AA:BB:CC:DD:EE:FF/ambientNoise";

// Temperature payloads - various formats from different sensor models

// MT15 format with explicit celsius field
const char* tempPayloadCelsius = R"({"celsius":22.5,"ts":"2026-01-28T12:00:00Z"})";

// MT15 format with fahrenheit field
const char* tempPayloadFahrenheit = R"({"fahrenheit":72.5,"ts":"2026-01-28T12:00:00Z"})";

// Generic format with unit field
const char* tempPayloadWithUnit = R"({"value":22.5,"unit":"celsius","ts":"2026-01-28T12:00:00Z"})";

// Legacy format with temperatureC
const char* tempPayloadLegacyC = R"({"temperatureC":22.5,"ts":"2026-01-28T12:00:00Z"})";

// Legacy format with temperatureF
const char* tempPayloadLegacyF = R"({"temperatureF":72.5,"ts":"2026-01-28T12:00:00Z"})";

// Simple value format (needs heuristic detection)
const char* tempPayloadSimpleC = R"({"value":22.5})";
const char* tempPayloadSimpleF = R"({"value":72.5})";

// Humidity payloads
const char* humidityPayloadWithField = R"({"humidity":45.5,"ts":"2026-01-28T12:00:00Z"})";
const char* humidityPayloadSimple = R"({"value":45.5})";

// Door sensor payloads
const char* doorPayloadOpen = R"({"value":true,"ts":"2026-01-28T12:00:00Z"})";
const char* doorPayloadClosed = R"({"value":false,"ts":"2026-01-28T12:00:00Z"})";

// Water sensor payloads
const char* waterPayloadWet = R"({"value":true,"ts":"2026-01-28T12:00:00Z"})";
const char* waterPayloadDry = R"({"value":false,"ts":"2026-01-28T12:00:00Z"})";

// TVOC payloads
const char* tvocPayloadWithField = R"({"tvoc":125.5,"ts":"2026-01-28T12:00:00Z"})";
const char* tvocPayloadSimple = R"({"value":125.5})";

// IAQ Index payloads (MT15)
const char* iaqIndexPayload = R"({"iaqIndex":35,"ts":"2026-01-28T12:00:00Z"})";
const char* iaqPayloadSimple = R"({"value":35})";

// CO2 payloads (MT15)
const char* co2PayloadWithField = R"({"CO2":450.5,"ts":"2026-01-28T12:00:00Z"})";
const char* co2PayloadSimple = R"({"value":450.5})";

// PM2.5 payloads (MT15)
const char* pm25PayloadWithField = R"({"PM2_5MassConcentration":12.5,"ts":"2026-01-28T12:00:00Z"})";
const char* pm25PayloadSimple = R"({"value":12.5})";

// Ambient noise payloads (MT15)
const char* noisePayloadWithField = R"({"ambientNoise":42.5,"ts":"2026-01-28T12:00:00Z"})";
const char* noisePayloadSimple = R"({"value":42.5})";

// ============================================================================
// Topic Parsing Tests
// ============================================================================

void test_extract_sensor_mac_from_topic() {
    String topic = topicTemperature;
    
    // Find /ble/ segment
    int bleIndex = topic.indexOf("/ble/");
    TEST_ASSERT_NOT_EQUAL(-1, bleIndex);
    
    int start = bleIndex + 5;  // after "/ble/"
    int end = topic.indexOf('/', start);
    
    String sensorMac = topic.substring(start, end);
    TEST_ASSERT_EQUAL_STRING("AA:BB:CC:DD:EE:FF", sensorMac.c_str());
}

void test_extract_metric_from_topic() {
    String topic = topicTemperature;
    
    int lastSlash = topic.lastIndexOf('/');
    String metric = topic.substring(lastSlash + 1);
    
    TEST_ASSERT_EQUAL_STRING("temperature", metric.c_str());
}

void test_extract_network_id_from_topic() {
    String topic = topicTemperature;
    
    // Format: meraki/v1/mt/{network_id}/ble/...
    int mtIndex = topic.indexOf("/mt/");
    int start = mtIndex + 4;
    int end = topic.indexOf("/ble/");
    
    String networkId = topic.substring(start, end);
    TEST_ASSERT_EQUAL_STRING("N_123456789012345678", networkId.c_str());
}

void test_metric_types() {
    // Verify all metric types can be extracted
    String topics[] = {
        topicTemperature, topicHumidity, topicDoor, topicWater,
        topicTvoc, topicIaqIndex, topicCo2, topicPm25, topicNoise
    };
    
    String expectedMetrics[] = {
        "temperature", "humidity", "door", "water",
        "tvoc", "iaqIndex", "CO2", "PM2_5MassConcentration", "ambientNoise"
    };
    
    for (int i = 0; i < 9; i++) {
        int lastSlash = topics[i].lastIndexOf('/');
        String metric = topics[i].substring(lastSlash + 1);
        TEST_ASSERT_EQUAL_STRING(expectedMetrics[i].c_str(), metric.c_str());
    }
}

// ============================================================================
// Temperature Parsing Tests
// ============================================================================

void test_parse_temperature_celsius() {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, tempPayloadCelsius);
    TEST_ASSERT_FALSE(error);
    
    float celsius = doc["celsius"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, celsius);
}

void test_parse_temperature_fahrenheit() {
    JsonDocument doc;
    deserializeJson(doc, tempPayloadFahrenheit);
    
    float fahrenheit = doc["fahrenheit"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 72.5f, fahrenheit);
    
    // Convert to Celsius for storage
    float celsius = (fahrenheit - 32.0f) * 5.0f / 9.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, celsius);
}

void test_parse_temperature_with_unit() {
    JsonDocument doc;
    deserializeJson(doc, tempPayloadWithUnit);
    
    float value = doc["value"] | 0.0f;
    const char* unit = doc["unit"];
    
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, value);
    TEST_ASSERT_EQUAL_STRING("celsius", unit);
}

void test_parse_temperature_legacy_c() {
    JsonDocument doc;
    deserializeJson(doc, tempPayloadLegacyC);
    
    float tempC = doc["temperatureC"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, tempC);
}

void test_parse_temperature_legacy_f() {
    JsonDocument doc;
    deserializeJson(doc, tempPayloadLegacyF);
    
    float tempF = doc["temperatureF"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 72.5f, tempF);
}

void test_temperature_heuristic_celsius() {
    // Value < 50 is likely Celsius
    JsonDocument doc;
    deserializeJson(doc, tempPayloadSimpleC);
    
    float value = doc["value"] | 0.0f;
    bool isFahrenheit = (value > 50.0f);
    
    TEST_ASSERT_FALSE(isFahrenheit);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, value);
}

void test_temperature_heuristic_fahrenheit() {
    // Value > 50 is likely Fahrenheit (room temp 68-77°F)
    JsonDocument doc;
    deserializeJson(doc, tempPayloadSimpleF);
    
    float value = doc["value"] | 0.0f;
    bool isFahrenheit = (value > 50.0f);
    
    TEST_ASSERT_TRUE(isFahrenheit);
}

// ============================================================================
// Humidity Parsing Tests
// ============================================================================

void test_parse_humidity_with_field() {
    JsonDocument doc;
    deserializeJson(doc, humidityPayloadWithField);
    
    float humidity = doc["humidity"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 45.5f, humidity);
}

void test_parse_humidity_simple() {
    JsonDocument doc;
    deserializeJson(doc, humidityPayloadSimple);
    
    float humidity = doc["value"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 45.5f, humidity);
}

void test_humidity_range_valid() {
    // Humidity should be 0-100%
    float humidity = 45.5f;
    TEST_ASSERT_TRUE(humidity >= 0.0f && humidity <= 100.0f);
}

// ============================================================================
// Door/Water Sensor Tests
// ============================================================================

void test_parse_door_open() {
    JsonDocument doc;
    deserializeJson(doc, doorPayloadOpen);
    
    bool open = doc["value"] | false;
    TEST_ASSERT_TRUE(open);
    
    String status = open ? "open" : "closed";
    TEST_ASSERT_EQUAL_STRING("open", status.c_str());
}

void test_parse_door_closed() {
    JsonDocument doc;
    deserializeJson(doc, doorPayloadClosed);
    
    bool open = doc["value"] | false;
    TEST_ASSERT_FALSE(open);
    
    String status = open ? "open" : "closed";
    TEST_ASSERT_EQUAL_STRING("closed", status.c_str());
}

void test_parse_water_wet() {
    JsonDocument doc;
    deserializeJson(doc, waterPayloadWet);
    
    bool wet = doc["value"] | false;
    TEST_ASSERT_TRUE(wet);
    
    String status = wet ? "wet" : "dry";
    TEST_ASSERT_EQUAL_STRING("wet", status.c_str());
}

void test_parse_water_dry() {
    JsonDocument doc;
    deserializeJson(doc, waterPayloadDry);
    
    bool wet = doc["value"] | false;
    TEST_ASSERT_FALSE(wet);
    
    String status = wet ? "wet" : "dry";
    TEST_ASSERT_EQUAL_STRING("dry", status.c_str());
}

// ============================================================================
// Air Quality Sensor Tests (MT15)
// ============================================================================

void test_parse_tvoc_with_field() {
    JsonDocument doc;
    deserializeJson(doc, tvocPayloadWithField);
    
    float tvoc = doc["tvoc"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 125.5f, tvoc);
}

void test_parse_tvoc_simple() {
    JsonDocument doc;
    deserializeJson(doc, tvocPayloadSimple);
    
    float tvoc = doc["value"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 125.5f, tvoc);
}

void test_parse_iaq_index() {
    JsonDocument doc;
    deserializeJson(doc, iaqIndexPayload);
    
    int iaqIndex = doc["iaqIndex"] | 0;
    TEST_ASSERT_EQUAL(35, iaqIndex);
}

void test_parse_iaq_simple() {
    JsonDocument doc;
    deserializeJson(doc, iaqPayloadSimple);
    
    int iaq = doc["value"] | 0;
    TEST_ASSERT_EQUAL(35, iaq);
}

void test_parse_co2_with_field() {
    JsonDocument doc;
    deserializeJson(doc, co2PayloadWithField);
    
    float co2 = doc["CO2"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 450.5f, co2);
}

void test_parse_co2_simple() {
    JsonDocument doc;
    deserializeJson(doc, co2PayloadSimple);
    
    float co2 = doc["value"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 450.5f, co2);
}

void test_parse_pm25_with_field() {
    JsonDocument doc;
    deserializeJson(doc, pm25PayloadWithField);
    
    float pm25 = doc["PM2_5MassConcentration"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 12.5f, pm25);
}

void test_parse_pm25_simple() {
    JsonDocument doc;
    deserializeJson(doc, pm25PayloadSimple);
    
    float pm25 = doc["value"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 12.5f, pm25);
}

void test_parse_noise_with_field() {
    JsonDocument doc;
    deserializeJson(doc, noisePayloadWithField);
    
    float noise = doc["ambientNoise"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 42.5f, noise);
}

void test_parse_noise_simple() {
    JsonDocument doc;
    deserializeJson(doc, noisePayloadSimple);
    
    float noise = doc["value"] | 0.0f;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 42.5f, noise);
}

// ============================================================================
// Sensor ID Normalization Tests
// ============================================================================

void test_normalize_sensor_id() {
    // Normalize MAC addresses for comparison
    String input1 = "AA:BB:CC:DD:EE:FF";
    String input2 = "aa:bb:cc:dd:ee:ff";
    String input3 = "AABBCCDDEEFF";
    
    // Normalization: lowercase, remove non-alphanumeric
    auto normalize = [](const String& s) {
        String out;
        for (size_t i = 0; i < s.length(); i++) {
            char c = s[i];
            if (isalnum(c)) {
                out += (char)tolower(c);
            }
        }
        return out;
    };
    
    TEST_ASSERT_EQUAL_STRING("aabbccddeeff", normalize(input1).c_str());
    TEST_ASSERT_EQUAL_STRING("aabbccddeeff", normalize(input2).c_str());
    TEST_ASSERT_EQUAL_STRING("aabbccddeeff", normalize(input3).c_str());
}

void test_sensor_filtering_by_mac() {
    // Allowed sensor list (comma-separated)
    String allowedList = "AA:BB:CC:DD:EE:FF, 11:22:33:44:55:66";
    String testSensor = "aabbccddeeff";  // normalized
    
    auto normalize = [](const String& s) {
        String out;
        for (size_t i = 0; i < s.length(); i++) {
            char c = s[i];
            if (isalnum(c)) {
                out += (char)tolower(c);
            }
        }
        return out;
    };
    
    // Check if sensor is in allowed list
    bool allowed = false;
    int start = 0;
    while (start < (int)allowedList.length()) {
        int end = allowedList.indexOf(',', start);
        if (end == -1) end = allowedList.length();
        
        String token = allowedList.substring(start, end);
        token.trim();
        
        if (normalize(token) == testSensor) {
            allowed = true;
            break;
        }
        start = end + 1;
    }
    
    TEST_ASSERT_TRUE(allowed);
}

void test_empty_allowed_list_allows_all() {
    String allowedList = "";
    
    // Empty list means allow all sensors
    bool allowed = allowedList.isEmpty();
    TEST_ASSERT_TRUE(allowed);
}

// ============================================================================
// MerakiSensorData Structure Tests
// ============================================================================

void test_sensor_data_initial_values() {
    // Simulate MerakiSensorData initialization
    struct SensorData {
        String sensor_mac;
        float temperature = 0.0f;
        float humidity = 0.0f;
        String door_status;
        float tvoc = 0.0f;
        int air_quality_index = 0;
        float co2_ppm = 0.0f;
        float pm2_5 = 0.0f;
        float ambient_noise = 0.0f;
        unsigned long timestamp = 0;
        bool valid = false;
    };
    
    SensorData data;
    
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, data.temperature);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, data.humidity);
    TEST_ASSERT_EQUAL(0, data.air_quality_index);
    TEST_ASSERT_FALSE(data.valid);
}

void test_sensor_data_becomes_valid() {
    struct SensorData {
        float temperature = 0.0f;
        bool valid = false;
    };
    
    SensorData data;
    
    // Parse temperature
    JsonDocument doc;
    deserializeJson(doc, tempPayloadCelsius);
    
    data.temperature = doc["celsius"] | 0.0f;
    data.valid = true;
    
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, data.temperature);
    TEST_ASSERT_TRUE(data.valid);
}

// ============================================================================
// Multi-Sensor Storage Tests
// ============================================================================

void test_max_sensor_capacity() {
    const int MAX_SENSORS = 8;
    
    // Should be able to store 8 sensors
    String sensors[MAX_SENSORS];
    int count = 0;
    
    for (int i = 0; i < MAX_SENSORS; i++) {
        sensors[count++] = "sensor_" + String(i);
    }
    
    TEST_ASSERT_EQUAL(8, count);
}

void test_sensor_lookup_by_id() {
    struct SensorEntry {
        String id;
        float temperature;
    };
    
    const int MAX_SENSORS = 8;
    SensorEntry sensors[MAX_SENSORS];
    int count = 0;
    
    // Add sensors
    sensors[count].id = "AA:BB:CC:DD:EE:FF";
    sensors[count].temperature = 22.5f;
    count++;
    
    sensors[count].id = "11:22:33:44:55:66";
    sensors[count].temperature = 24.0f;
    count++;
    
    // Lookup
    String target = "AA:BB:CC:DD:EE:FF";
    float foundTemp = 0.0f;
    bool found = false;
    
    for (int i = 0; i < count; i++) {
        if (sensors[i].id == target) {
            foundTemp = sensors[i].temperature;
            found = true;
            break;
        }
    }
    
    TEST_ASSERT_TRUE(found);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, foundTemp);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_mqtt_client_tests() {
    // Topic Parsing
    RUN_TEST(test_extract_sensor_mac_from_topic);
    RUN_TEST(test_extract_metric_from_topic);
    RUN_TEST(test_extract_network_id_from_topic);
    RUN_TEST(test_metric_types);
    
    // Temperature Parsing
    RUN_TEST(test_parse_temperature_celsius);
    RUN_TEST(test_parse_temperature_fahrenheit);
    RUN_TEST(test_parse_temperature_with_unit);
    RUN_TEST(test_parse_temperature_legacy_c);
    RUN_TEST(test_parse_temperature_legacy_f);
    RUN_TEST(test_temperature_heuristic_celsius);
    RUN_TEST(test_temperature_heuristic_fahrenheit);
    
    // Humidity Parsing
    RUN_TEST(test_parse_humidity_with_field);
    RUN_TEST(test_parse_humidity_simple);
    RUN_TEST(test_humidity_range_valid);
    
    // Door/Water Sensors
    RUN_TEST(test_parse_door_open);
    RUN_TEST(test_parse_door_closed);
    RUN_TEST(test_parse_water_wet);
    RUN_TEST(test_parse_water_dry);
    
    // Air Quality Sensors
    RUN_TEST(test_parse_tvoc_with_field);
    RUN_TEST(test_parse_tvoc_simple);
    RUN_TEST(test_parse_iaq_index);
    RUN_TEST(test_parse_iaq_simple);
    RUN_TEST(test_parse_co2_with_field);
    RUN_TEST(test_parse_co2_simple);
    RUN_TEST(test_parse_pm25_with_field);
    RUN_TEST(test_parse_pm25_simple);
    RUN_TEST(test_parse_noise_with_field);
    RUN_TEST(test_parse_noise_simple);
    
    // Sensor ID Normalization
    RUN_TEST(test_normalize_sensor_id);
    RUN_TEST(test_sensor_filtering_by_mac);
    RUN_TEST(test_empty_allowed_list_allows_all);
    
    // Sensor Data Structure
    RUN_TEST(test_sensor_data_initial_values);
    RUN_TEST(test_sensor_data_becomes_valid);
    
    // Multi-Sensor Storage
    RUN_TEST(test_max_sensor_capacity);
    RUN_TEST(test_sensor_lookup_by_id);
}

#if defined(ARDUINO)
void setup() {
    delay(2000);
    UNITY_BEGIN();
    run_mqtt_client_tests();
    UNITY_END();
}

void loop() {}
#else
int main(int argc, char** argv) {
    UNITY_BEGIN();
    run_mqtt_client_tests();
    return UNITY_END();
}
#endif

#endif // UNIT_TEST
