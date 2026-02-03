/**
 * @file HTTPClient.h
 * @brief Enhanced mock HTTP Client for native simulation with test support
 */

#ifndef HTTPCLIENT_H
#define HTTPCLIENT_H

#include "Arduino.h"
#include "WiFi.h"
#include "WiFiClientSecure.h"
#include <map>
#include <algorithm>

// HTTP codes
#define HTTP_CODE_OK 200
#define HTTP_CODE_CREATED 201
#define HTTP_CODE_NO_CONTENT 204
#define HTTP_CODE_BAD_REQUEST 400
#define HTTP_CODE_UNAUTHORIZED 401
#define HTTP_CODE_FORBIDDEN 403
#define HTTP_CODE_NOT_FOUND 404
#define HTTP_CODE_TOO_MANY_REQUESTS 429
#define HTTP_CODE_INTERNAL_SERVER_ERROR 500

// Error codes
#define HTTPC_ERROR_CONNECTION_REFUSED -1
#define HTTPC_ERROR_SEND_HEADER_FAILED -2
#define HTTPC_ERROR_SEND_PAYLOAD_FAILED -3
#define HTTPC_ERROR_NOT_CONNECTED -4
#define HTTPC_ERROR_CONNECTION_LOST -5
#define HTTPC_ERROR_NO_STREAM -6
#define HTTPC_ERROR_NO_HTTP_SERVER -7
#define HTTPC_ERROR_TOO_LESS_RAM -8
#define HTTPC_ERROR_ENCODING -9
#define HTTPC_ERROR_STREAM_WRITE -10
#define HTTPC_ERROR_READ_TIMEOUT -11

// Redirect settings
#define HTTPC_DISABLE_FOLLOW_REDIRECTS 0
#define HTTPC_STRICT_FOLLOW_REDIRECTS 1
#define HTTPC_FORCE_FOLLOW_REDIRECTS 2

// min/max macros for OTA helpers compatibility
#ifndef min
#define min(a,b) ((a)<(b)?(a):(b))
#endif
#ifndef max
#define max(a,b) ((a)>(b)?(a):(b))
#endif

/**
 * @brief Enhanced HTTP Client mock with test response control
 */
class HTTPClient {
public:
    HTTPClient() : _httpCode(0), _followRedirects(false) {}
    
    void begin(const String& url) {
        _url = url;
        printf("[HTTP] Begin: %s\n", url.c_str());
    }
    
    void begin(const char* url) {
        begin(String(url));
    }
    
    void begin(WiFiClient& client, const String& url) {
        _client = &client;
        begin(url);
    }
    
    void begin(WiFiClientSecure& client, const String& url) {
        _secureClient = &client;
        begin(url);
    }
    
    void end() {
        printf("[HTTP] End\n");
        _headers.clear();
    }
    
    void addHeader(const String& name, const String& value) {
        _headers[name.c_str()] = value.c_str();
        printf("[HTTP] Header: %s: %s\n", name.c_str(), value.c_str());
    }
    
    void addHeader(const char* name, const char* value) {
        addHeader(String(name), String(value));
    }
    
    void setAuthorization(const char* user, const char* password) {
        printf("[HTTP] Basic auth set for user: %s\n", user);
    }
    
    void setAuthorization(const char* auth) {
        _headers["Authorization"] = auth;
        printf("[HTTP] Authorization set\n");
    }
    
    void setTimeout(uint16_t timeout) {
        _timeout = timeout;
    }
    
    void setConnectTimeout(uint16_t timeout) {
        _connectTimeout = timeout;
    }
    
    void setFollowRedirects(int follow) {
        _followRedirects = (follow != 0);
    }
    
    void setRedirectLimit(int limit) {
        _redirectLimit = limit;
    }
    
    void setReuse(bool reuse) {
        _reuse = reuse;
    }
    
    void setUserAgent(const String& userAgent) {
        _headers["User-Agent"] = userAgent.c_str();
    }
    
    int GET() {
        printf("[HTTP] GET %s\n", _url.c_str());
        return executeRequest("GET", "");
    }
    
    int POST(const String& payload) {
        printf("[HTTP] POST %s: %s\n", _url.c_str(), payload.substring(0, 100).c_str());
        return executeRequest("POST", payload);
    }
    
    int POST(const char* payload) {
        return POST(String(payload));
    }
    
    int POST(const uint8_t* payload, size_t size) {
        return POST(String((const char*)payload).substring(0, size));
    }
    
    int PUT(const String& payload) {
        printf("[HTTP] PUT %s: %s\n", _url.c_str(), payload.substring(0, 100).c_str());
        return executeRequest("PUT", payload);
    }
    
    int PATCH(const String& payload) {
        printf("[HTTP] PATCH %s: %s\n", _url.c_str(), payload.substring(0, 100).c_str());
        return executeRequest("PATCH", payload);
    }
    
    int DELETE() {
        printf("[HTTP] DELETE %s\n", _url.c_str());
        return executeRequest("DELETE", "");
    }
    
    int sendRequest(const char* method, const String& payload = "") {
        printf("[HTTP] %s %s\n", method, _url.c_str());
        return executeRequest(method, payload);
    }
    
    String getString() {
        return _payload;
    }
    
    const String& getString() const {
        return _payload;
    }
    
    int getSize() {
        return _payload.length();
    }
    
    int getStreamSize() {
        return _payload.length();
    }
    
    WiFiClient* getStreamPtr() {
        return _client;
    }
    
    String header(const char* name) {
        auto it = _responseHeaders.find(name);
        if (it != _responseHeaders.end()) {
            return String(it->second.c_str());
        }
        return "";
    }
    
    bool hasHeader(const char* name) {
        return _responseHeaders.find(name) != _responseHeaders.end();
    }
    
    int headers() {
        return _responseHeaders.size();
    }
    
    String headerName(int i) {
        if (i >= 0 && i < (int)_responseHeaders.size()) {
            auto it = _responseHeaders.begin();
            std::advance(it, i);
            return String(it->first.c_str());
        }
        return "";
    }
    
    String headerValue(int i) {
        if (i >= 0 && i < (int)_responseHeaders.size()) {
            auto it = _responseHeaders.begin();
            std::advance(it, i);
            return String(it->second.c_str());
        }
        return "";
    }
    
    void collectHeaders(const char* headers[], const size_t count) {
        _collectHeaders.clear();
        for (size_t i = 0; i < count; i++) {
            _collectHeaders.push_back(headers[i]);
        }
    }
    
    int writeToStream(Stream* stream) {
        if (stream && !_payload.isEmpty()) {
            return stream->write((const uint8_t*)_payload.c_str(), _payload.length());
        }
        return 0;
    }
    
    String errorToString(int error) {
        if (error >= 0) return "OK";
        switch (error) {
            case HTTPC_ERROR_CONNECTION_REFUSED: return "Connection refused";
            case HTTPC_ERROR_SEND_HEADER_FAILED: return "Send header failed";
            case HTTPC_ERROR_SEND_PAYLOAD_FAILED: return "Send payload failed";
            case HTTPC_ERROR_NOT_CONNECTED: return "Not connected";
            case HTTPC_ERROR_CONNECTION_LOST: return "Connection lost";
            case HTTPC_ERROR_NO_STREAM: return "No stream";
            case HTTPC_ERROR_NO_HTTP_SERVER: return "No HTTP server";
            case HTTPC_ERROR_TOO_LESS_RAM: return "Too less RAM";
            case HTTPC_ERROR_ENCODING: return "Encoding";
            case HTTPC_ERROR_STREAM_WRITE: return "Stream write";
            case HTTPC_ERROR_READ_TIMEOUT: return "Read timeout";
            default: return "Unknown error";
        }
    }
    
    // For testing: set simulated response with headers
    void setSimulatedResponse(const String& response, int code = HTTP_CODE_OK) {
        _simulatedResponse = response;
        _httpCode = code;
    }
    
    void setSimulatedResponseHeader(const char* name, const char* value) {
        _responseHeaders[name] = value;
    }
    
    // For testing: simulate connection failure
    void setConnectionFailed(bool failed) {
        _connectionFailed = failed;
    }
    
    // For testing: get last request method and payload
    const String& getLastMethod() const { return _lastMethod; }
    const String& getLastPayload() const { return _lastPayload; }
    const std::map<std::string, std::string>& getHeaders() const { return _headers; }

private:
    int executeRequest(const String& method, const String& payload) {
        _lastMethod = method;
        _lastPayload = payload;
        
        // Simulate connection failure
        if (_connectionFailed) {
            _httpCode = HTTPC_ERROR_CONNECTION_REFUSED;
            return _httpCode;
        }
        
        // Use simulated response if set, otherwise default
        if (!_simulatedResponse.isEmpty() || _httpCode != 0) {
            _payload = _simulatedResponse;
            return _httpCode;
        }
        
        // Default response
        _httpCode = HTTP_CODE_OK;
        _payload = "{}";
        return _httpCode;
    }

    String _url;
    int _httpCode;
    String _payload;
    String _simulatedResponse = "";
    String _lastMethod;
    String _lastPayload;
    uint16_t _timeout = 5000;
    uint16_t _connectTimeout = 5000;
    int _redirectLimit = 10;
    bool _followRedirects = false;
    bool _reuse = true;
    bool _connectionFailed = false;
    
    WiFiClient* _client = nullptr;
    WiFiClientSecure* _secureClient = nullptr;
    
    std::map<std::string, std::string> _headers;
    std::map<std::string, std::string> _responseHeaders;
    std::vector<std::string> _collectHeaders;
};

#endif // HTTPCLIENT_H
