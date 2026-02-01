/**
 * @file web_helpers.h
 * @brief Web Server Helper Functions
 * 
 * Common utilities for web API handlers to reduce duplication:
 * - JSON response helpers
 * - CORS header management
 * - Error response creation
 * - Request body parsing
 */

#ifndef WEB_HELPERS_H
#define WEB_HELPERS_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include "../common/url_utils.h"

// ==================== REQUEST PARSING HELPERS ====================

/**
 * @brief Parse JSON body from request data
 * 
 * Helper to convert uint8_t* data to String and parse as JSON.
 * Handles common edge cases like empty bodies and invalid JSON.
 * 
 * @param data Request body data
 * @param len Length of data
 * @param doc JsonDocument to populate
 * @return DeserializationError (use .code() == DeserializationError::Ok to check success)
 */
inline DeserializationError parseJsonBody(const uint8_t* data, size_t len, JsonDocument& doc) {
    if (len == 0) {
        return DeserializationError::EmptyInput;
    }
    
    String body;
    body.reserve(len);
    for (size_t i = 0; i < len; i++) {
        body += static_cast<char>(data[i]);
    }
    
    return deserializeJson(doc, body);
}

/**
 * @brief Validate string is printable ASCII
 * 
 * Checks if string contains only printable ASCII characters (32-126).
 * Useful for validating user inputs like device names.
 * 
 * @param str String to validate
 * @return true if all characters are printable ASCII
 */
inline bool isPrintableAscii(const String& str) {
    for (size_t i = 0; i < str.length(); i++) {
        char c = str.charAt(i);
        if (c < 32 || c > 126) {
            return false;
        }
    }
    return true;
}

// ==================== JSON RESPONSE HELPERS ====================

/**
 * @brief Send a JSON response with CORS headers
 * 
 * Creates an AsyncWebServerResponse with JSON content type and adds CORS headers.
 * This helper consolidates the common pattern:
 *   String responseStr;
 *   serializeJson(doc, responseStr);
 *   AsyncWebServerResponse* response = request->beginResponse(200, "application/json", responseStr);
 *   addCors(response);
 *   request->send(response);
 * 
 * @param request The incoming HTTP request
 * @param statusCode HTTP status code (e.g., 200, 400, 500)
 * @param doc JsonDocument to serialize and send
 * @param addCors Function or lambda to add CORS headers to the response
 */
template<typename AddCorsFunc>
inline void sendJsonResponse(AsyncWebServerRequest* request, int statusCode, 
                             const JsonDocument& doc,
                             AddCorsFunc addCors) {
    String responseStr;
    serializeJson(doc, responseStr);
    
    AsyncWebServerResponse* response = request->beginResponse(statusCode, "application/json", responseStr);
    addCors(response);
    request->send(response);
}

/**
 * @brief Send a plain JSON string response with CORS headers
 * 
 * Use when you already have a JSON string (e.g., error messages).
 * 
 * @param request The incoming HTTP request
 * @param statusCode HTTP status code
 * @param jsonString Pre-formatted JSON string
 * @param addCors Function or lambda to add CORS headers to the response
 */
template<typename AddCorsFunc>
inline void sendJsonResponse(AsyncWebServerRequest* request, int statusCode, 
                             const String& jsonString,
                             AddCorsFunc addCors) {
    AsyncWebServerResponse* response = request->beginResponse(statusCode, "application/json", jsonString);
    addCors(response);
    request->send(response);
}

/**
 * @brief Send a simple success JSON response
 * 
 * Sends: {"success":true}
 * 
 * @param request The incoming HTTP request
 * @param addCors Function or lambda to add CORS headers
 */
template<typename AddCorsFunc>
inline void sendSuccessResponse(AsyncWebServerRequest* request,
                                AddCorsFunc addCors) {
    sendJsonResponse(request, 200, "{\"success\":true}", addCors);
}

/**
 * @brief Send a success response with a message
 * 
 * Sends: {"success":true,"message":"..."}
 * 
 * @param request The incoming HTTP request
 * @param message Success message
 * @param addCors Function or lambda to add CORS headers
 */
template<typename AddCorsFunc>
inline void sendSuccessResponse(AsyncWebServerRequest* request, 
                                const String& message,
                                AddCorsFunc addCors) {
    JsonDocument doc;
    doc["success"] = true;
    doc["message"] = message;
    sendJsonResponse(request, 200, doc, addCors);
}

/**
 * @brief Send an error JSON response
 * 
 * Sends: {"error":"..."}
 * 
 * @param request The incoming HTTP request
 * @param statusCode HTTP error status code (e.g., 400, 404, 500)
 * @param errorMessage Error message
 * @param addCors Function or lambda to add CORS headers
 */
template<typename AddCorsFunc>
inline void sendErrorResponse(AsyncWebServerRequest* request, int statusCode,
                              const String& errorMessage,
                              AddCorsFunc addCors) {
    JsonDocument doc;
    doc["error"] = errorMessage;
    sendJsonResponse(request, statusCode, doc, addCors);
}

#endif // WEB_HELPERS_H
