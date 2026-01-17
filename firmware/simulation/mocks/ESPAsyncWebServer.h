/**
 * @file ESPAsyncWebServer.h
 * @brief Mock Async Web Server for native simulation
 * 
 * Provides stub implementations - actual HTTP handling not simulated.
 */

#ifndef ESP_ASYNC_WEB_SERVER_H
#define ESP_ASYNC_WEB_SERVER_H

#include "Arduino.h"
#include <functional>
#include <vector>

// Forward declarations
class AsyncWebServerRequest;
class AsyncWebServerResponse;
class AsyncWebServer;

// HTTP methods
typedef enum {
    HTTP_GET = 0b00000001,
    HTTP_POST = 0b00000010,
    HTTP_DELETE = 0b00000100,
    HTTP_PUT = 0b00001000,
    HTTP_PATCH = 0b00010000,
    HTTP_HEAD = 0b00100000,
    HTTP_OPTIONS = 0b01000000,
    HTTP_ANY = 0b01111111
} WebRequestMethod;

// Request handler types
typedef std::function<void(AsyncWebServerRequest*)> ArRequestHandlerFunction;
typedef std::function<void(AsyncWebServerRequest*, uint8_t*, size_t, size_t, size_t)> ArBodyHandlerFunction;
typedef std::function<void(AsyncWebServerRequest*, const String&, size_t, uint8_t*, size_t, bool)> ArUploadHandlerFunction;

/**
 * @brief Mock parameter class
 */
class AsyncWebParameter {
public:
    AsyncWebParameter(const String& name, const String& value, bool post = false)
        : _name(name), _value(value), _post(post) {}
    
    const String& name() const { return _name; }
    const String& value() const { return _value; }
    bool isPost() const { return _post; }
    bool isFile() const { return false; }
    
private:
    String _name;
    String _value;
    bool _post;
};

/**
 * @brief Mock request class
 */
class AsyncWebServerRequest {
public:
    AsyncWebServerRequest() : _method(HTTP_GET), _responded(false) {}
    
    WebRequestMethod method() const { return _method; }
    String url() const { return _url; }
    String host() const { return "localhost"; }
    String contentType() const { return "text/html"; }
    size_t contentLength() const { return 0; }
    
    bool hasParam(const String& name, bool post = false, bool file = false) const {
        for (const auto& p : _params) {
            if (p.name() == name) return true;
        }
        return false;
    }
    
    AsyncWebParameter* getParam(const String& name, bool post = false, bool file = false) {
        for (auto& p : _params) {
            if (p.name() == name) return &p;
        }
        return nullptr;
    }
    
    AsyncWebParameter* getParam(size_t num) {
        if (num < _params.size()) return &_params[num];
        return nullptr;
    }
    
    size_t params() const { return _params.size(); }
    
    bool hasHeader(const String& name) const { return false; }
    String header(const String& name) const { return ""; }
    
    void send(int code, const String& contentType = "", const String& content = "") {
        printf("[WebServer] Response %d: %s\n", code, content.substring(0, 100).c_str());
        _responded = true;
    }
    
    void send(int code, const char* contentType, const char* content) {
        send(code, String(contentType), String(content));
    }
    
    AsyncWebServerResponse* beginResponse(int code, const String& contentType, const String& content) {
        printf("[WebServer] Response %d prepared\n", code);
        return nullptr;
    }
    
    void redirect(const String& url) {
        printf("[WebServer] Redirect to: %s\n", url.c_str());
        _responded = true;
    }
    
    bool hasArg(const String& name) const {
        return hasParam(name, true);
    }
    
    String arg(const String& name) const {
        for (const auto& p : _params) {
            if (p.name() == name) return p.value();
        }
        return "";
    }
    
    // For testing
    void setUrl(const String& url) { _url = url; }
    void setMethod(WebRequestMethod method) { _method = method; }
    void addParam(const String& name, const String& value, bool post = false) {
        _params.emplace_back(name, value, post);
    }
    
private:
    WebRequestMethod _method;
    String _url;
    std::vector<AsyncWebParameter> _params;
    bool _responded;
};

/**
 * @brief Mock response class
 */
class AsyncWebServerResponse {
public:
    void addHeader(const String& name, const String& value) {}
    void setContentLength(size_t len) {}
};

/**
 * @brief Mock handler base
 */
class AsyncWebHandler {
public:
    virtual ~AsyncWebHandler() {}
    virtual bool canHandle(AsyncWebServerRequest* request) { return false; }
    virtual void handleRequest(AsyncWebServerRequest* request) {}
};

/**
 * @brief Static file handler (mock)
 */
class AsyncStaticWebHandler : public AsyncWebHandler {
public:
    AsyncStaticWebHandler& setDefaultFile(const char* filename) { 
        _defaultFile = filename;
        return *this;
    }
    
private:
    String _defaultFile;
};

/**
 * @brief Mock web server class
 */
class AsyncWebServer {
public:
    AsyncWebServer(uint16_t port) : _port(port) {
        printf("[WebServer] Created on port %d\n", port);
    }
    
    ~AsyncWebServer() {}
    
    void begin() {
        printf("[WebServer] Started on port %d (simulation - no actual HTTP)\n", _port);
    }
    
    void end() {
        printf("[WebServer] Stopped\n");
    }
    
    void on(const char* uri, WebRequestMethod method, ArRequestHandlerFunction handler) {
        printf("[WebServer] Route registered: %s\n", uri);
    }
    
    void on(const char* uri, WebRequestMethod method, 
            ArRequestHandlerFunction onRequest,
            ArUploadHandlerFunction onUpload,
            ArBodyHandlerFunction onBody) {
        printf("[WebServer] Route registered (with body): %s\n", uri);
    }
    
    void on(const char* uri, ArRequestHandlerFunction handler) {
        on(uri, HTTP_ANY, handler);
    }
    
    AsyncStaticWebHandler& serveStatic(const char* uri, fs::FS& fs, const char* path) {
        printf("[WebServer] Static route: %s -> %s\n", uri, path);
        return _staticHandler;
    }
    
    void onNotFound(ArRequestHandlerFunction handler) {
        printf("[WebServer] 404 handler registered\n");
    }
    
    void addHandler(AsyncWebHandler* handler) {}

private:
    uint16_t _port;
    AsyncStaticWebHandler _staticHandler;
};

#endif // ESP_ASYNC_WEB_SERVER_H
