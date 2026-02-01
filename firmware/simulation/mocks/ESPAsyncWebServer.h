/**
 * @file ESPAsyncWebServer.h
 * @brief Enhanced mock Async Web Server for native simulation with test support
 */

#ifndef ESP_ASYNC_WEB_SERVER_H
#define ESP_ASYNC_WEB_SERVER_H

#include "Arduino.h"
#include <functional>
#include <vector>
#include <map>

// Forward declarations
class AsyncWebServerRequest;
class AsyncWebServerResponse;
class AsyncWebServer;
class AsyncWebHandler;
class AsyncCallbackWebHandler;

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
 * @brief Enhanced parameter class
 */
class AsyncWebParameter {
public:
    AsyncWebParameter(const String& name, const String& value, bool post = false, bool file = false)
        : _name(name), _value(value), _post(post), _file(file) {}
    
    const String& name() const { return _name; }
    const String& value() const { return _value; }
    bool isPost() const { return _post; }
    bool isFile() const { return _file; }
    
private:
    String _name;
    String _value;
    bool _post;
    bool _file;
};

/**
 * @brief Enhanced request class with body handling
 */
class AsyncWebServerRequest {
public:
    AsyncWebServerRequest() : _method(HTTP_GET), _responded(false), _bodyLength(0) {}
    
    WebRequestMethod method() const { return _method; }
    String url() const { return _url; }
    String host() const { return _host; }
    String contentType() const { return _contentType; }
    size_t contentLength() const { return _bodyLength; }
    
    bool hasParam(const String& name, bool post = false, bool file = false) const {
        for (const auto& p : _params) {
            if (p.name() == name && (p.isPost() == post || !post) && (p.isFile() == file || !file)) {
                return true;
            }
        }
        return false;
    }
    
    AsyncWebParameter* getParam(const String& name, bool post = false, bool file = false) {
        for (auto& p : _params) {
            if (p.name() == name && (p.isPost() == post || !post) && (p.isFile() == file || !file)) {
                return &p;
            }
        }
        return nullptr;
    }
    
    AsyncWebParameter* getParam(size_t num) {
        if (num < _params.size()) return &_params[num];
        return nullptr;
    }
    
    size_t params() const { return _params.size(); }
    
    bool hasHeader(const String& name) const {
        return _headers.find(name.c_str()) != _headers.end();
    }
    
    String header(const String& name) const {
        auto it = _headers.find(name.c_str());
        if (it != _headers.end()) {
            return String(it->second.c_str());
        }
        return "";
    }
    
    void send(int code, const String& contentType = "", const String& content = "") {
        _responseCode = code;
        _responseContentType = contentType;
        _responseContent = content;
        printf("[WebServer] Response %d: %s\n", code, content.substring(0, 100).c_str());
        _responded = true;
    }
    
    void send(int code, const char* contentType, const char* content) {
        send(code, String(contentType), String(content));
    }
    
    void send(AsyncWebServerResponse* response) {
        if (response) {
            printf("[WebServer] Sending prepared response\n");
            _responded = true;
        }
    }
    
    AsyncWebServerResponse* beginResponse(int code, const String& contentType, const String& content) {
        printf("[WebServer] Response %d prepared\n", code);
        _responseCode = code;
        _responseContentType = contentType;
        _responseContent = content;
        return nullptr;  // Simplified for mock
    }
    
    AsyncWebServerResponse* beginResponse(int code) {
        return beginResponse(code, "text/plain", "");
    }
    
    void redirect(const String& url) {
        printf("[WebServer] Redirect to: %s\n", url.c_str());
        _redirectUrl = url;
        _responded = true;
    }
    
    bool hasArg(const String& name) const {
        return hasParam(name, false);
    }
    
    String arg(const String& name) const {
        for (const auto& p : _params) {
            if (p.name() == name) return p.value();
        }
        return "";
    }
    
    String pathArg(size_t i) const {
        if (i < _pathArgs.size()) return _pathArgs[i];
        return "";
    }
    
    // For testing
    void setUrl(const String& url) { _url = url; }
    void setMethod(WebRequestMethod method) { _method = method; }
    void setContentType(const String& type) { _contentType = type; }
    void setHost(const String& host) { _host = host; }
    void addParam(const String& name, const String& value, bool post = false, bool file = false) {
        _params.emplace_back(name, value, post, file);
    }
    void addHeader(const String& name, const String& value) {
        _headers[name.c_str()] = value.c_str();
    }
    void setBody(const String& body) {
        _body = body;
        _bodyLength = body.length();
    }
    void addPathArg(const String& arg) {
        _pathArgs.push_back(arg);
    }
    
    // Getters for testing
    bool hasResponded() const { return _responded; }
    int getResponseCode() const { return _responseCode; }
    const String& getResponseContent() const { return _responseContent; }
    const String& getBody() const { return _body; }
    
private:
    WebRequestMethod _method;
    String _url;
    String _host = "localhost";
    String _contentType = "text/html";
    String _body;
    size_t _bodyLength;
    std::vector<AsyncWebParameter> _params;
    std::map<std::string, std::string> _headers;
    std::vector<String> _pathArgs;
    bool _responded;
    int _responseCode = 200;
    String _responseContentType;
    String _responseContent;
    String _redirectUrl;
};

/**
 * @brief Enhanced response class
 */
class AsyncWebServerResponse {
public:
    AsyncWebServerResponse() {}
    
    void addHeader(const String& name, const String& value) {
        _headers[name.c_str()] = value.c_str();
    }
    
    void setContentLength(size_t len) {
        _contentLength = len;
    }
    
    void setCode(int code) {
        _code = code;
    }
    
    void setContentType(const String& type) {
        _contentType = type;
    }
    
    // For testing
    const std::map<std::string, std::string>& getHeaders() const { return _headers; }
    
private:
    int _code = 200;
    size_t _contentLength = 0;
    String _contentType;
    std::map<std::string, std::string> _headers;
};

/**
 * @brief Enhanced handler base
 */
class AsyncWebHandler {
public:
    virtual ~AsyncWebHandler() {}
    virtual bool canHandle(AsyncWebServerRequest* request) { return false; }
    virtual void handleRequest(AsyncWebServerRequest* request) {}
    virtual void handleBody(AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {}
    virtual void handleUpload(AsyncWebServerRequest* request, const String& filename, size_t index, uint8_t* data, size_t len, bool final) {}
    virtual bool isRequestHandlerTrivial() { return true; }
};

/**
 * @brief Callback-based handler
 */
class AsyncCallbackWebHandler : public AsyncWebHandler {
public:
    AsyncCallbackWebHandler() {}
    
    void setUri(const String& uri) { _uri = uri; }
    void setMethod(WebRequestMethod method) { _method = method; }
    void onRequest(ArRequestHandlerFunction fn) { _onRequest = fn; }
    void onBody(ArBodyHandlerFunction fn) { _onBody = fn; }
    void onUpload(ArUploadHandlerFunction fn) { _onUpload = fn; }
    
    bool canHandle(AsyncWebServerRequest* request) override {
        return (request->method() & _method) && request->url() == _uri;
    }
    
    void handleRequest(AsyncWebServerRequest* request) override {
        if (_onRequest) {
            _onRequest(request);
        }
    }
    
    void handleBody(AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) override {
        if (_onBody) {
            _onBody(request, data, len, index, total);
        }
    }
    
    void handleUpload(AsyncWebServerRequest* request, const String& filename, size_t index, uint8_t* data, size_t len, bool final) override {
        if (_onUpload) {
            _onUpload(request, filename, index, data, len, final);
        }
    }
    
private:
    String _uri;
    WebRequestMethod _method = HTTP_ANY;
    ArRequestHandlerFunction _onRequest;
    ArBodyHandlerFunction _onBody;
    ArUploadHandlerFunction _onUpload;
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
    
    AsyncStaticWebHandler& setCacheControl(const char* cache) {
        _cacheControl = cache;
        return *this;
    }
    
private:
    String _defaultFile;
    String _cacheControl;
};

/**
 * @brief Enhanced web server class
 */
class AsyncWebServer {
public:
    AsyncWebServer(uint16_t port) : _port(port) {
        printf("[WebServer] Created on port %d\n", port);
    }
    
    ~AsyncWebServer() {}
    
    void begin() {
        printf("[WebServer] Started on port %d (simulation - no actual HTTP)\n", _port);
        _running = true;
    }
    
    void end() {
        printf("[WebServer] Stopped\n");
        _running = false;
    }
    
    AsyncCallbackWebHandler& on(const char* uri, WebRequestMethod method, ArRequestHandlerFunction handler) {
        printf("[WebServer] Route registered: %s (method: %d)\n", uri, method);
        AsyncCallbackWebHandler* h = new AsyncCallbackWebHandler();
        h->setUri(uri);
        h->setMethod(method);
        h->onRequest(handler);
        _handlers.push_back(h);
        return *h;
    }
    
    AsyncCallbackWebHandler& on(const char* uri, ArRequestHandlerFunction handler) {
        return on(uri, HTTP_ANY, handler);
    }
    
    AsyncCallbackWebHandler& on(const char* uri, WebRequestMethod method,
            ArRequestHandlerFunction onRequest,
            ArUploadHandlerFunction onUpload,
            ArBodyHandlerFunction onBody) {
        printf("[WebServer] Route registered (with body): %s\n", uri);
        AsyncCallbackWebHandler* h = new AsyncCallbackWebHandler();
        h->setUri(uri);
        h->setMethod(method);
        h->onRequest(onRequest);
        h->onBody(onBody);
        h->onUpload(onUpload);
        _handlers.push_back(h);
        return *h;
    }
    
    AsyncStaticWebHandler& serveStatic(const char* uri, fs::FS& fs, const char* path) {
        printf("[WebServer] Static route: %s -> %s\n", uri, path);
        return _staticHandler;
    }
    
    void onNotFound(ArRequestHandlerFunction handler) {
        printf("[WebServer] 404 handler registered\n");
        _notFoundHandler = handler;
    }
    
    void addHandler(AsyncWebHandler* handler) {
        _handlers.push_back(handler);
    }
    
    void reset() {
        for (auto h : _handlers) {
            delete h;
        }
        _handlers.clear();
    }
    
    // For testing: simulate incoming request
    void simulateRequest(AsyncWebServerRequest* request) {
        for (auto h : _handlers) {
            if (h->canHandle(request)) {
                h->handleRequest(request);
                return;
            }
        }
        // Not found
        if (_notFoundHandler) {
            _notFoundHandler(request);
        } else {
            request->send(404, "text/plain", "Not Found");
        }
    }

private:
    uint16_t _port;
    bool _running = false;
    std::vector<AsyncWebHandler*> _handlers;
    AsyncStaticWebHandler _staticHandler;
    ArRequestHandlerFunction _notFoundHandler;
};

#endif // ESP_ASYNC_WEB_SERVER_H
