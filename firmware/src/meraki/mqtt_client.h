/**
 * @file mqtt_client.h
 * @brief Meraki MT Sensor MQTT Client Header
 */

#ifndef MQTT_CLIENT_H
#define MQTT_CLIENT_H

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include "../config/config_manager.h"

/**
 * @brief Meraki Sensor Data structure
 */
struct MerakiSensorData {
    String sensor_mac;
    float temperature;       // Celsius
    float humidity;          // Percentage
    String door_status;      // "open" or "closed"
    float tvoc;              // TVOC in ppb
    int air_quality_index;   // Air quality as numeric index (0-500)
    float co2_ppm;
    float pm2_5;
    float ambient_noise;
    unsigned long timestamp;
    bool valid;
};

/**
 * @brief Meraki MQTT Client Class
 */
class MerakiMQTTClient {
public:
    MerakiMQTTClient();
    ~MerakiMQTTClient();

    /**
     * @brief Initialize the MQTT client
     * @param config Pointer to configuration manager
     */
    void begin(ConfigManager* config);

    /**
     * @brief Process MQTT events
     */
    void loop();

    /**
     * @brief Check if connected to broker
     * @return true if connected
     */
    bool isConnected();

    /**
     * @brief Check if client has been initialized
     * @return true if begin() has been called
     */
    bool isInitialized() const { return config_manager != nullptr; }

    /**
     * @brief Check if there's a pending update
     * @return true if update available
     */
    bool hasUpdate() const { return update_pending; }

    /**
     * @brief Get the latest sensor data
     * @return MerakiSensorData structure
     */
    MerakiSensorData getLatestData();
    String getLatestSensorId() const { return latest_sensor_id; }
    bool getSensorData(const String& sensor_id, MerakiSensorData& out) const;

    /**
     * @brief Reconnect to broker
     */
    void reconnect();

    /**
     * @brief Disconnect from broker
     */
    void disconnect();

    /**
     * @brief Invalidate cached config (call when MQTT settings change via web UI)
     */
    void invalidateConfig();

    /**
     * @brief Enable/disable debug logging to Serial
     * @param enabled true to enable debug output
     */
    void setDebugEnabled(bool enabled) { debug_enabled = enabled; }
    
    /**
     * @brief Check if debug logging is enabled
     * @return true if debug output is enabled
     */
    bool isDebugEnabled() const { return debug_enabled; }

private:
    bool debug_enabled = false;  // MQTT message logging disabled by default
    WiFiClient wifi_client;
    WiFiClientSecure wifi_client_secure;
    PubSubClient mqtt_client;
    ConfigManager* config_manager;
    MerakiSensorData sensor_data;
    bool update_pending;
    unsigned long last_reconnect;
    String latest_sensor_id;
    bool last_connected_state = false;  // Track connection state for disconnect logging
    bool using_tls = false;  // Track which client is in use
    
    // Persistent storage for broker/topic - PubSubClient stores pointers, not copies
    String cached_broker;
    String cached_topic;
    uint16_t cached_port = 1883;

    static constexpr uint8_t MAX_SENSORS = 8;
    struct SensorEntry {
        String id;
        MerakiSensorData data;
    };
    SensorEntry sensors[MAX_SENSORS];
    uint8_t sensor_count = 0;

    void onMessage(char* topic, byte* payload, unsigned int length);
    void parseMessage(const String& topic, const String& payload);
    static void messageCallback(char* topic, byte* payload, unsigned int length);

    SensorEntry* getOrCreateSensor(const String& sensor_id);
};

// Global instance for callback
extern MerakiMQTTClient* g_mqtt_instance;

#endif // MQTT_CLIENT_H
