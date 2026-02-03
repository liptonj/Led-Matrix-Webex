/**
 * @file http_utils.h
 * @brief Shared HTTP Client Utilities
 * 
 * Consolidates common HTTP client setup patterns to eliminate duplication
 * across 15+ files in the firmware codebase.
 */

#ifndef HTTP_UTILS_H
#define HTTP_UTILS_H

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "secure_client_config.h"

#ifdef ESP32
#include <ArduinoJson.h>
#else
// Native test builds - minimal includes
#include <ArduinoJson.h>
#endif

/**
 * @brief Builder class for configuring HTTP clients with TLS and headers
 * 
 * Provides a fluent API for setting up HTTPClient and WiFiClientSecure
 * with common configurations like TLS certificates, timeouts, and headers.
 * 
 * Example usage:
 * @code
 * HttpClientBuilder builder;
 * builder.withTls(CA_CERT_BUNDLE, true, url)
 *        .withTimeout(15000)
 *        .withJsonContentType()
 *        .withAuthHeader(token);
 * 
 * if (builder.begin(url)) {
 *     int code = builder.getHttpClient().GET();
 *     if (handleHttpError(builder.getHttpClient(), code, "my request")) {
 *         String response = getResponseString(builder.getHttpClient());
 *     }
 *     builder.end();
 * }
 * @endcode
 */
class HttpClientBuilder {
public:
    /**
     * @brief Construct a new HttpClientBuilder
     */
    HttpClientBuilder();

    /**
     * @brief Configure TLS using existing configureSecureClientWithTls
     * 
     * @param caCert CA certificate bundle (nullptr to skip)
     * @param verify Whether to verify TLS certificates
     * @param url URL being accessed (for logging/context)
     * @return Reference to this builder for method chaining
     */
    HttpClientBuilder& withTls(const char* caCert, bool verify, const char* url);

    /**
     * @brief Set HTTP client timeout
     * 
     * @param timeoutMs Timeout in milliseconds (default 15000)
     * @return Reference to this builder for method chaining
     */
    HttpClientBuilder& withTimeout(int timeoutMs);

    /**
     * @brief Add a custom header
     * 
     * @param name Header name
     * @param value Header value
     * @return Reference to this builder for method chaining
     */
    HttpClientBuilder& withHeader(const char* name, const char* value);

    /**
     * @brief Add Content-Type: application/json header
     * 
     * @return Reference to this builder for method chaining
     */
    HttpClientBuilder& withJsonContentType();

    /**
     * @brief Add Authorization: Bearer {token} header
     * 
     * @param token JWT or bearer token
     * @return Reference to this builder for method chaining
     */
    HttpClientBuilder& withAuthHeader(const char* token);

    /**
     * @brief Get the configured WiFiClientSecure instance
     * 
     * @return Reference to the secure client
     */
    WiFiClientSecure& getSecureClient() { return _secureClient; }

    /**
     * @brief Get the configured HTTPClient instance
     * 
     * @return Reference to the HTTP client
     */
    HTTPClient& getHttpClient() { return _httpClient; }

    /**
     * @brief Begin HTTP request with the configured URL
     * 
     * @param url Full URL to request
     * @return true if begin() succeeded, false on error
     */
    bool begin(const char* url);

    /**
     * @brief Clean up HTTP client resources
     * 
     * Call this after completing the request.
     */
    void end();

private:
    WiFiClientSecure _secureClient;
    HTTPClient _httpClient;
    int _timeout;
    bool _tlsConfigured;
};

/**
 * @brief Consolidated error handling for HTTP responses
 * 
 * Logs errors and returns false on HTTP error codes.
 * Returns true for successful HTTP codes (200-299).
 * 
 * @param http HTTPClient instance
 * @param httpCode HTTP response code
 * @param context Context string for error logging (e.g., "fetch manifest")
 * @return true if HTTP code indicates success (200-299), false otherwise
 */
bool handleHttpError(HTTPClient& http, int httpCode, const char* context);

/**
 * @brief Parse JSON response with error handling
 * 
 * Reads response from HTTPClient and parses it into a JsonDocument.
 * Logs errors on failure.
 * 
 * @param http HTTPClient instance (must have completed request)
 * @param doc JsonDocument to parse into
 * @param context Context string for error logging
 * @return true if parsing succeeded, false on error
 */
bool parseJsonResponse(HTTPClient& http, JsonDocument& doc, const char* context);

/**
 * @brief Get response as string safely
 * 
 * Reads the full response body from HTTPClient as a String.
 * 
 * @param http HTTPClient instance (must have completed request)
 * @return Response body as String
 */
String getResponseString(HTTPClient& http);

#endif // HTTP_UTILS_H
