/**
 * @file AsyncTCP.h
 * @brief Mock AsyncTCP for native simulation
 * 
 * Minimal stubs to satisfy ESPAsyncWebServer dependencies.
 */

#ifndef ASYNCTCP_H
#define ASYNCTCP_H

#include "Arduino.h"
#include <functional>

class AsyncClient {
public:
    AsyncClient() : _connected(false) {}
    
    bool connect(const char* host, uint16_t port) { return true; }
    void close() { _connected = false; }
    bool connected() { return _connected; }
    
    size_t write(const char* data) { return strlen(data); }
    size_t write(const char* data, size_t len) { return len; }
    
    void onConnect(std::function<void(void*, AsyncClient*)> cb, void* arg = nullptr) {}
    void onDisconnect(std::function<void(void*, AsyncClient*)> cb, void* arg = nullptr) {}
    void onData(std::function<void(void*, AsyncClient*, void*, size_t)> cb, void* arg = nullptr) {}
    void onError(std::function<void(void*, AsyncClient*, int8_t)> cb, void* arg = nullptr) {}
    void onTimeout(std::function<void(void*, AsyncClient*, uint32_t)> cb, void* arg = nullptr) {}
    
    void setAckTimeout(uint32_t timeout) {}
    void setRxTimeout(uint32_t timeout) {}
    void setNoDelay(bool nodelay) {}
    
    IPAddress remoteIP() { return IPAddress(127, 0, 0, 1); }
    uint16_t remotePort() { return 0; }
    IPAddress localIP() { return IPAddress(127, 0, 0, 1); }
    uint16_t localPort() { return 0; }
    
private:
    bool _connected;
};

class AsyncServer {
public:
    AsyncServer(uint16_t port) : _port(port) {}
    
    void begin() {}
    void end() {}
    
    void onClient(std::function<void(void*, AsyncClient*)> cb, void* arg = nullptr) {}
    
private:
    uint16_t _port;
};

#endif // ASYNCTCP_H
