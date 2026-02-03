/**
 * @file WiFiClient.h
 * @brief Mock WiFiClient for native simulation
 */

#ifndef WIFICLIENT_H
#define WIFICLIENT_H

#include "Arduino.h"

/**
 * @brief Mock Stream class for native simulation
 * 
 * Provides a base interface for stream-like classes.
 */
#ifndef STREAM_H_DEFINED
#define STREAM_H_DEFINED
class Stream {
public:
    virtual ~Stream() = default;
    virtual int available() { return 0; }
    virtual int read() { return -1; }
    virtual int peek() { return -1; }
    virtual size_t write(uint8_t) { return 1; }
    virtual size_t write(const uint8_t* buffer, size_t size) { return size; }
    virtual void flush() {}
    
    // Read methods
    size_t readBytes(char* buffer, size_t length) {
        size_t count = 0;
        while (count < length) {
            int c = read();
            if (c < 0) break;
            *buffer++ = (char)c;
            count++;
        }
        return count;
    }
    
    size_t readBytes(uint8_t* buffer, size_t length) {
        return readBytes((char*)buffer, length);
    }
    
    String readString() {
        String ret;
        int c;
        while ((c = read()) >= 0) {
            ret += (char)c;
        }
        return ret;
    }
    
    String readStringUntil(char terminator) {
        String ret;
        int c;
        while ((c = read()) >= 0 && c != terminator) {
            ret += (char)c;
        }
        return ret;
    }
    
    void setTimeout(unsigned long timeout) { _timeout = timeout; }
    unsigned long getTimeout() const { return _timeout; }
    
protected:
    unsigned long _timeout = 1000;
};
#endif // STREAM_H_DEFINED

/**
 * @brief Mock WiFiClient for native simulation
 */
class WiFiClient : public Stream {
public:
    WiFiClient() : _connected(true), _available(0), _timeout(5000) {}
    virtual ~WiFiClient() = default;
    
    bool connect(const char* host, uint16_t port) { return _connected; }
    bool connected() { return _connected; }
    void stop() { _connected = false; }
    
    // Stream interface
    int available() override { return _available; }
    int read() override { 
        if (_readPos < _readBuffer.length()) {
            return _readBuffer[_readPos++];
        }
        return -1; 
    }
    int peek() override { 
        if (_readPos < _readBuffer.length()) {
            return _readBuffer[_readPos];
        }
        return -1; 
    }
    size_t write(uint8_t c) override { return 1; }
    size_t write(const uint8_t* buf, size_t size) override { return size; }
    void flush() override {}
    
    void setTimeout(uint16_t timeout) { _timeout = timeout; }
    
    // For testing
    void setConnected(bool connected) { _connected = connected; }
    void setAvailable(int available) { _available = available; }
    void setReadBuffer(const String& data) { 
        _readBuffer = data; 
        _readPos = 0;
        _available = data.length();
    }
    
    operator bool() { return _connected; }
    
protected:
    bool _connected;
    int _available;
    uint16_t _timeout;
    String _readBuffer;
    size_t _readPos = 0;
};

#endif // WIFICLIENT_H
