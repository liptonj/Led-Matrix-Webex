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
#include <functional>
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

// ==================== EXTENDED JSON RESPONSE HELPERS ====================

/**
 * @brief Send a JSON success response with custom builder function
 * 
 * Allows building custom JSON responses using a builder lambda/function.
 * Usage: sendJsonSuccess(request, [](JsonDocument& doc) { doc["status"] = "ok"; });
 * 
 * @param request The incoming HTTP request
 * @param builder Function that populates the JsonDocument
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
template<typename F>
void sendJsonSuccess(AsyncWebServerRequest* request, F builder, 
                     std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    JsonDocument doc;
    builder(doc);
    
    String response;
    serializeJson(doc, response);
    
    AsyncWebServerResponse* resp = request->beginResponse(200, "application/json", response);
    if (corsCallback) corsCallback(resp);
    request->send(resp);
}

/**
 * @brief Send a JSON error response
 * 
 * Sends: {"error":"...", "message":"..."} (message is optional)
 * 
 * @param request The incoming HTTP request
 * @param statusCode HTTP status code (e.g., 400, 404, 500)
 * @param error Error code/identifier
 * @param message Optional detailed error message
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
inline void sendJsonError(AsyncWebServerRequest* request, int statusCode, 
                          const String& error, const String& message = "",
                          std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    JsonDocument doc;
    doc["error"] = error;
    if (message.length() > 0) {
        doc["message"] = message;
    }
    
    String response;
    serializeJson(doc, response);
    
    AsyncWebServerResponse* resp = request->beginResponse(statusCode, "application/json", response);
    if (corsCallback) corsCallback(resp);
    request->send(resp);
}

/**
 * @brief Convenience overload: Send JSON success with message
 * 
 * Sends: {"success":true, "message":"..."}
 * 
 * @param request The incoming HTTP request
 * @param message Success message
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
inline void sendJsonSuccess(AsyncWebServerRequest* request, const String& message,
                            std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    sendJsonSuccess(request, [&message](JsonDocument& doc) {
        doc["success"] = true;
        doc["message"] = message;
    }, corsCallback);
}

/**
 * @brief Send a pre-built JSON document
 * 
 * Serializes and sends an existing JsonDocument.
 * 
 * @param request The incoming HTTP request
 * @param doc JsonDocument to serialize and send
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
inline void sendJson(AsyncWebServerRequest* request, const JsonDocument& doc,
                     std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    String response;
    serializeJson(doc, response);
    
    AsyncWebServerResponse* resp = request->beginResponse(200, "application/json", response);
    if (corsCallback) corsCallback(resp);
    request->send(resp);
}

/**
 * @brief Send empty success response
 * 
 * Sends: {"success":true}
 * 
 * @param request The incoming HTTP request
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
inline void sendOk(AsyncWebServerRequest* request,
                   std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    JsonDocument doc;
    doc["success"] = true;
    
    String response;
    serializeJson(doc, response);
    
    AsyncWebServerResponse* resp = request->beginResponse(200, "application/json", response);
    if (corsCallback) corsCallback(resp);
    request->send(resp);
}

/**
 * @brief Send 404 Not Found error response
 * 
 * Sends: {"error":"not_found", "message":"Resource not found"}
 * 
 * @param request The incoming HTTP request
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
inline void sendNotFound(AsyncWebServerRequest* request,
                         std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    sendJsonError(request, 404, "not_found", "Resource not found", corsCallback);
}

/**
 * @brief Send 400 Bad Request error response
 * 
 * Sends: {"error":"bad_request", "message":"..."}
 * 
 * @param request The incoming HTTP request
 * @param message Error message describing what was wrong
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
inline void sendBadRequest(AsyncWebServerRequest* request, const String& message,
                           std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    sendJsonError(request, 400, "bad_request", message, corsCallback);
}

/**
 * @brief Send 500 Internal Server Error response
 * 
 * Sends: {"error":"server_error", "message":"..."}
 * 
 * @param request The incoming HTTP request
 * @param message Error message describing the server error
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
inline void sendServerError(AsyncWebServerRequest* request, const String& message,
                            std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    sendJsonError(request, 500, "server_error", message, corsCallback);
}

/**
 * @brief Send 401 Unauthorized error response
 * 
 * Sends: {"error":"unauthorized", "message":"Authentication required"}
 * 
 * @param request The incoming HTTP request
 * @param corsCallback Optional callback to add CORS headers (can be nullptr)
 */
inline void sendUnauthorized(AsyncWebServerRequest* request,
                             std::function<void(AsyncWebServerResponse*)> corsCallback = nullptr) {
    sendJsonError(request, 401, "unauthorized", "Authentication required", corsCallback);
}

#endif // WEB_HELPERS_H
