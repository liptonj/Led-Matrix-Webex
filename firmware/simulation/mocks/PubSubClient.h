/**
 * @file PubSubClient.h
 * @brief Mock MQTT PubSubClient for native simulation
 */

#ifndef PUBSUBCLIENT_H
#define PUBSUBCLIENT_H

#include "Arduino.h"
#include <functional>

// MQTT connection states
#define MQTT_CONNECTION_TIMEOUT     -4
#define MQTT_CONNECTION_LOST        -3
#define MQTT_CONNECT_FAILED         -2
#define MQTT_DISCONNECTED           -1
#define MQTT_CONNECTED               0
#define MQTT_CONNECT_BAD_PROTOCOL    1
#define MQTT_CONNECT_BAD_CLIENT_ID   2
#define MQTT_CONNECT_UNAVAILABLE     3
#define MQTT_CONNECT_BAD_CREDENTIALS 4
#define MQTT_CONNECT_UNAUTHORIZED    5

// Callback type
typedef std::function<void(char*, uint8_t*, unsigned int)> MQTT_CALLBACK_SIGNATURE;

// Mock Client class (minimal)
class Client {
public:
    virtual int connect(const char* host, uint16_t port) { return 1; }
    virtual size_t write(uint8_t) { return 1; }
    virtual size_t write(const uint8_t* buf, size_t size) { return size; }
    virtual int available() { return 0; }
    virtual int read() { return -1; }
    virtual void stop() {}
    virtual uint8_t connected() { return 1; }
    virtual operator bool() { return true; }
};

class PubSubClient {
public:
    PubSubClient() : _connected(false), _state(MQTT_DISCONNECTED) {}
    
    PubSubClient(Client& client) : _connected(false), _state(MQTT_DISCONNECTED) {}
    
    PubSubClient& setServer(const char* domain, uint16_t port) {
        _server = domain;
        _port = port;
        printf("[MQTT] Server set to %s:%d\n", domain, port);
        return *this;
    }
    
    PubSubClient& setServer(IPAddress ip, uint16_t port) {
        _server = ip.toString();
        _port = port;
        printf("[MQTT] Server set to %s:%d\n", _server.c_str(), port);
        return *this;
    }
    
    PubSubClient& setCallback(MQTT_CALLBACK_SIGNATURE callback) {
        _callback = callback;
        printf("[MQTT] Callback registered\n");
        return *this;
    }
    
    PubSubClient& setClient(Client& client) {
        return *this;
    }
    
    PubSubClient& setKeepAlive(uint16_t keepAlive) {
        return *this;
    }
    
    PubSubClient& setSocketTimeout(uint16_t timeout) {
        return *this;
    }
    
    bool connect(const char* id) {
        printf("[MQTT] Connecting as '%s'... (simulated success)\n", id);
        _connected = true;
        _state = MQTT_CONNECTED;
        return true;
    }
    
    bool connect(const char* id, const char* user, const char* pass) {
        printf("[MQTT] Connecting as '%s' with credentials... (simulated success)\n", id);
        _connected = true;
        _state = MQTT_CONNECTED;
        return true;
    }
    
    bool connect(const char* id, const char* willTopic, uint8_t willQos, 
                 bool willRetain, const char* willMessage) {
        return connect(id);
    }
    
    void disconnect() {
        printf("[MQTT] Disconnected\n");
        _connected = false;
        _state = MQTT_DISCONNECTED;
    }
    
    bool connected() {
        return _connected;
    }
    
    int state() {
        return _state;
    }
    
    bool subscribe(const char* topic) {
        printf("[MQTT] Subscribed to: %s\n", topic);
        return true;
    }
    
    bool subscribe(const char* topic, uint8_t qos) {
        return subscribe(topic);
    }
    
    bool unsubscribe(const char* topic) {
        printf("[MQTT] Unsubscribed from: %s\n", topic);
        return true;
    }
    
    bool publish(const char* topic, const char* payload) {
        printf("[MQTT] Published to %s: %s\n", topic, payload);
        return true;
    }
    
    bool publish(const char* topic, const char* payload, bool retained) {
        return publish(topic, payload);
    }
    
    bool publish(const char* topic, const uint8_t* payload, unsigned int plength) {
        printf("[MQTT] Published %u bytes to %s\n", plength, topic);
        return true;
    }
    
    bool publish(const char* topic, const uint8_t* payload, unsigned int plength, bool retained) {
        return publish(topic, payload, plength);
    }
    
    bool loop() {
        // In a real simulation, you might trigger callbacks here
        return _connected;
    }
    
    // For testing: simulate receiving a message
    void simulateMessage(const char* topic, const char* payload) {
        if (_callback && _connected) {
            printf("[MQTT] Simulating message on %s: %s\n", topic, payload);
            _callback(const_cast<char*>(topic), 
                     reinterpret_cast<uint8_t*>(const_cast<char*>(payload)), 
                     strlen(payload));
        }
    }

private:
    bool _connected;
    int _state;
    String _server;
    uint16_t _port;
    MQTT_CALLBACK_SIGNATURE _callback;
};

#endif // PUBSUBCLIENT_H
