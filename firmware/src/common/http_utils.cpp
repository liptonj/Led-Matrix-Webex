/**
 * @file http_utils.cpp
 * @brief Shared HTTP Client Utilities Implementation
 */

#include <Arduino.h>
#include "http_utils.h"
#include "../debug/log_system.h"

static const char* TAG = "HTTP";

#ifdef ESP32
#include <esp_heap_caps.h>
#include <time.h>
#endif

HttpClientBuilder::HttpClientBuilder()
    : _timeout(15000), _tlsConfigured(false) {
}

HttpClientBuilder& HttpClientBuilder::withTls(const char* caCert, bool verify, const char* url) {
    // Use existing secure client configuration helper
    configureSecureClientWithTls(_secureClient, caCert, verify);
    _tlsConfigured = true;
    
#ifdef ESP32
    // Log TLS context for debugging (matching ota_helpers.h pattern)
    ESP_LOGD(TAG, "TLS context: url=%s time=%lu heap=%lu verify=%s",
                  url ? url : "(null)", 
                  (unsigned long)time(nullptr), 
                  ESP.getFreeHeap(),
                  verify ? "on" : "off");
#endif
    
    return *this;
}

HttpClientBuilder& HttpClientBuilder::withTimeout(int timeoutMs) {
    _timeout = timeoutMs;
    return *this;
}

HttpClientBuilder& HttpClientBuilder::withHeader(const char* name, const char* value) {
    if (name && value) {
        _httpClient.addHeader(name, value);
    }
    return *this;
}

HttpClientBuilder& HttpClientBuilder::withJsonContentType() {
    _httpClient.addHeader("Content-Type", "application/json");
    return *this;
}

HttpClientBuilder& HttpClientBuilder::withAuthHeader(const char* token) {
    if (token) {
        String authHeader = "Bearer ";
        authHeader += token;
        _httpClient.addHeader("Authorization", authHeader);
    }
    return *this;
}

bool HttpClientBuilder::begin(const char* url) {
    if (!url) {
        ESP_LOGE(TAG, "begin() called with null URL");
        return false;
    }
    
    if (!_tlsConfigured) {
        ESP_LOGE(TAG, "begin() called but TLS not configured - call withTls() first");
        return false;
    }
    
    // Configure timeout before beginning
    _httpClient.setTimeout(_timeout);
    
    // Begin request with secure client
    _httpClient.begin(_secureClient, url);
    
    return true;
}

void HttpClientBuilder::end() {
    _httpClient.end();
    _secureClient.stop();
    _tlsConfigured = false;
}

bool handleHttpError(HTTPClient& http, int httpCode, const char* context) {
    if (httpCode <= 0) {
        // Network/connection error
        const char* errorDesc = "unknown";
        switch (httpCode) {
            case -1: errorDesc = "connection_refused"; break;
            case -2: errorDesc = "send_header_failed"; break;
            case -3: errorDesc = "send_payload_failed"; break;
            case -4: errorDesc = "not_connected"; break;
            case -5: errorDesc = "connection_lost"; break;
            case -6: errorDesc = "no_stream"; break;
            case -7: errorDesc = "no_http_server"; break;
            case -8: errorDesc = "too_less_ram"; break;
            case -9: errorDesc = "encoding"; break;
            case -10: errorDesc = "stream_write"; break;
            case -11: errorDesc = "read_timeout"; break;
            default: break;
        }
        ESP_LOGE(TAG, "%s failed: network error %d (%s)", 
                   context ? context : "request", httpCode, errorDesc);
        return false;
    }
    
    if (httpCode >= 200 && httpCode < 300) {
        // Success
        return true;
    }
    
    // HTTP error (4xx, 5xx)
    String errorPayload;
    if (http.getSize() > 0) {
        errorPayload = http.getString();
        // Reset stream position for caller if they want to read it again
        // Note: HTTPClient doesn't support seeking, so we store it
    }
    
    ESP_LOGE(TAG, "%s failed: HTTP %d", context ? context : "request", httpCode);
    
    if (!errorPayload.isEmpty() && errorPayload.length() < 200) {
        ESP_LOGE(TAG, "Error response: %s", errorPayload.c_str());
    }
    
    return false;
}

bool parseJsonResponse(HTTPClient& http, JsonDocument& doc, const char* context) {
    // Get response string
    String response = getResponseString(http);
    
    if (response.isEmpty()) {
        ESP_LOGE(TAG, "%s: empty response", context ? context : "parse");
        return false;
    }
    
    // Parse JSON
    DeserializationError error = deserializeJson(doc, response);
    
    if (error) {
        ESP_LOGE(TAG, "%s: JSON parse error: %s", 
                   context ? context : "parse", error.c_str());
        if (response.length() < 200) {
            ESP_LOGE(TAG, "Response was: %s", response.c_str());
        }
        return false;
    }
    
    return true;
}

String getResponseString(HTTPClient& http) {
    String response = http.getString();
    return response;
}
