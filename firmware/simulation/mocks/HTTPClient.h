/**
 * @file HTTPClient.h
 * @brief Mock HTTP Client for native simulation
 */

#ifndef HTTPCLIENT_H
#define HTTPCLIENT_H

#include "Arduino.h"
#include "WiFi.h"

// HTTP codes
#define HTTP_CODE_OK 200
#define HTTP_CODE_CREATED 201
#define HTTP_CODE_NO_CONTENT 204
#define HTTP_CODE_BAD_REQUEST 400
#define HTTP_CODE_UNAUTHORIZED 401
#define HTTP_CODE_FORBIDDEN 403
#define HTTP_CODE_NOT_FOUND 404
#define HTTP_CODE_INTERNAL_SERVER_ERROR 500

class WiFiClient {
public:
    bool connect(const char* host, uint16_t port) { return true; }
    bool connected() { return true; }
    void stop() {}
    int available() { return 0; }
    int read() { return -1; }
    size_t write(uint8_t) { return 1; }
    size_t write(const uint8_t* buf, size_t size) { return size; }
    void setTimeout(uint16_t timeout) {}
};

class WiFiClientSecure : public WiFiClient {
public:
    void setInsecure() {
        printf("[HTTPClient] SSL certificate verification disabled\n");
    }
    
    void setCACert(const char* rootCA) {
        printf("[HTTPClient] CA certificate set\n");
    }
    
    void setCertificate(const char* clientCert) {}
    void setPrivateKey(const char* privateKey) {}
};

class HTTPClient {
public:
    HTTPClient() : _httpCode(0) {}
    
    void begin(const String& url) {
        _url = url;
        printf("[HTTP] Begin: %s\n", url.c_str());
    }
    
    void begin(const char* url) {
        begin(String(url));
    }
    
    void begin(WiFiClient& client, const String& url) {
        begin(url);
    }
    
    void begin(WiFiClientSecure& client, const String& url) {
        begin(url);
    }
    
    void end() {
        printf("[HTTP] End\n");
    }
    
    void addHeader(const String& name, const String& value) {
        printf("[HTTP] Header: %s: %s\n", name.c_str(), value.c_str());
    }
    
    void addHeader(const char* name, const char* value) {
        addHeader(String(name), String(value));
    }
    
    void setAuthorization(const char* user, const char* password) {
        printf("[HTTP] Basic auth set for user: %s\n", user);
    }
    
    void setAuthorization(const char* auth) {
        printf("[HTTP] Authorization set\n");
    }
    
    void setTimeout(uint16_t timeout) {
        _timeout = timeout;
    }
    
    void setConnectTimeout(uint16_t timeout) {
        _connectTimeout = timeout;
    }
    
    void setFollowRedirects(int follow) {}
    void setRedirectLimit(int limit) {}
    
    int GET() {
        printf("[HTTP] GET %s (simulated 200)\n", _url.c_str());
        _httpCode = HTTP_CODE_OK;
        _payload = _simulatedResponse;
        return _httpCode;
    }
    
    int POST(const String& payload) {
        printf("[HTTP] POST %s: %s (simulated 200)\n", _url.c_str(), payload.substring(0, 100).c_str());
        _httpCode = HTTP_CODE_OK;
        _payload = _simulatedResponse;
        return _httpCode;
    }
    
    int POST(const char* payload) {
        return POST(String(payload));
    }
    
    int PUT(const String& payload) {
        printf("[HTTP] PUT %s: %s (simulated 200)\n", _url.c_str(), payload.substring(0, 100).c_str());
        _httpCode = HTTP_CODE_OK;
        _payload = _simulatedResponse;
        return _httpCode;
    }
    
    int PATCH(const String& payload) {
        printf("[HTTP] PATCH %s: %s (simulated 200)\n", _url.c_str(), payload.substring(0, 100).c_str());
        _httpCode = HTTP_CODE_OK;
        _payload = _simulatedResponse;
        return _httpCode;
    }
    
    int sendRequest(const char* method, const String& payload = "") {
        printf("[HTTP] %s %s (simulated 200)\n", method, _url.c_str());
        _httpCode = HTTP_CODE_OK;
        _payload = _simulatedResponse;
        return _httpCode;
    }
    
    String getString() {
        return _payload;
    }
    
    int getSize() {
        return _payload.length();
    }
    
    int getStreamSize() {
        return _payload.length();
    }
    
    String header(const char* name) {
        return "";
    }
    
    bool hasHeader(const char* name) {
        return false;
    }
    
    int headers() {
        return 0;
    }
    
    String headerName(int i) {
        return "";
    }
    
    String headerValue(int i) {
        return "";
    }
    
    String errorToString(int error) {
        if (error >= 0) return "OK";
        switch (error) {
            case -1: return "Connection refused";
            case -2: return "Send header failed";
            case -3: return "Send payload failed";
            case -4: return "Not connected";
            case -5: return "Connection lost";
            case -6: return "No stream";
            case -7: return "No HTTP server";
            case -8: return "Too less RAM";
            case -9: return "Encoding";
            case -10: return "Stream write";
            case -11: return "Read timeout";
            default: return "Unknown error";
        }
    }
    
    // For testing: set simulated response
    void setSimulatedResponse(const String& response, int code = HTTP_CODE_OK) {
        _simulatedResponse = response;
        _httpCode = code;
    }

private:
    String _url;
    int _httpCode;
    String _payload;
    String _simulatedResponse = "{}";
    uint16_t _timeout = 5000;
    uint16_t _connectTimeout = 5000;
};

#endif // HTTPCLIENT_H
