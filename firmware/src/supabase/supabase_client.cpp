/**
 * @file supabase_client.cpp
 * @brief Supabase Edge Function Client Implementation
 */

#include "supabase_client.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include "../auth/device_credentials.h"
#include "../common/ca_certs.h"
#include "../config/config_manager.h"

extern ConfigManager config_manager;

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
#endif

// Global instance
SupabaseClient supabaseClient;

SupabaseClient::SupabaseClient()
    : _tokenExpiresAt(0), _appConnected(false), _commandHandler(nullptr) {
    _lastAppState.valid = false;
}

SupabaseClient::~SupabaseClient() {
    // Nothing to clean up
}

void SupabaseClient::begin(const String& supabase_url, const String& pairing_code) {
    _supabaseUrl = supabase_url;
    
    // Remove trailing slash if present
    if (_supabaseUrl.endsWith("/")) {
        _supabaseUrl.remove(_supabaseUrl.length() - 1);
    }
    
    _pairingCode = pairing_code;
    _pairingCode.toUpperCase();
    
    Serial.printf("[SUPABASE] Initialized with URL: %s\n", _supabaseUrl.c_str());
    Serial.printf("[SUPABASE] Pairing code: %s\n", _pairingCode.c_str());
}

void SupabaseClient::setPairingCode(const String& code) {
    _pairingCode = code;
    _pairingCode.toUpperCase();
    
    // Invalidate token when pairing code changes
    invalidateToken();
}

bool SupabaseClient::isAuthenticated() const {
    if (_token.isEmpty()) {
        return false;
    }
    
    // Check if token is expired (with margin for refresh)
    time_t now;
    time(&now);
    
    return (unsigned long)now < (_tokenExpiresAt - SUPABASE_TOKEN_REFRESH_MARGIN);
}

bool SupabaseClient::ensureAuthenticated() {
    if (isAuthenticated()) {
        return true;
    }
    
    // Need to authenticate or refresh
    return authenticate();
}

bool SupabaseClient::authenticate() {
    if (!deviceCredentials.isProvisioned()) {
        Serial.println("[SUPABASE] Cannot authenticate - device not provisioned");
        return false;
    }
    
    if (_supabaseUrl.isEmpty()) {
        Serial.println("[SUPABASE] Cannot authenticate - URL not configured");
        return false;
    }
    
    Serial.println("[SUPABASE] Authenticating with device-auth...");
    
    // Build empty body for device-auth (POST with no body)
    String body = "";
    String response;
    
    int httpCode = makeRequest("device-auth", "POST", body, response, true);
    
    if (httpCode != 200) {
        Serial.printf("[SUPABASE] Auth failed: HTTP %d\n", httpCode);
        if (!response.isEmpty()) {
            Serial.printf("[SUPABASE] Response: %s\n", response.c_str());
        }
        return false;
    }
    
    // Parse auth response
    SupabaseAuthResult result = parseAuthResponse(response);
    
    if (!result.success) {
        Serial.println("[SUPABASE] Auth response parsing failed");
        return false;
    }
    
    _token = result.token;
    _tokenExpiresAt = result.expires_at;
    _pairingCode = result.pairing_code;
    _targetFirmwareVersion = result.target_firmware_version;
    _remoteDebugEnabled = result.debug_enabled;
    _supabaseAnonKey = result.anon_key;
    
    Serial.printf("[SUPABASE] Authenticated successfully (expires in %lu seconds)\n",
                  _tokenExpiresAt - (unsigned long)(time(nullptr)));
    
    if (!_targetFirmwareVersion.isEmpty()) {
        Serial.printf("[SUPABASE] Target firmware version: %s\n", 
                      _targetFirmwareVersion.c_str());
    }

    if (_remoteDebugEnabled) {
        Serial.println("[SUPABASE] Remote debug logging enabled by server");
    }
    
    return true;
}

SupabaseAuthResult SupabaseClient::parseAuthResponse(const String& json) {
    SupabaseAuthResult result;
    result.success = false;
    result.expires_at = 0;
    result.debug_enabled = false;
    result.anon_key = "";
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);
    
    if (error) {
        Serial.printf("[SUPABASE] JSON parse error: %s\n", error.c_str());
        return result;
    }
    
    if (!doc["success"].as<bool>()) {
        String errMsg = doc["error"] | "Unknown error";
        Serial.printf("[SUPABASE] Auth error: %s\n", errMsg.c_str());
        return result;
    }
    
    result.success = true;
    result.token = doc["token"].as<String>();
    result.pairing_code = doc["pairing_code"].as<String>();
    result.device_id = doc["device_id"].as<String>();
    result.target_firmware_version = doc["target_firmware_version"] | "";
    result.debug_enabled = doc["debug_enabled"] | false;
    result.anon_key = doc["anon_key"] | "";
    
    // Parse expires_at ISO string to Unix timestamp
    String expiresAtStr = doc["expires_at"] | "";
    if (!expiresAtStr.isEmpty()) {
        // Parse ISO 8601 format (e.g., "2026-01-28T13:00:00Z")
        struct tm tm_expires = {};
        if (strptime(expiresAtStr.c_str(), "%Y-%m-%dT%H:%M:%S", &tm_expires) != nullptr) {
            result.expires_at = mktime(&tm_expires);
        } else {
            // If parsing fails, set to 24 hours from now
            result.expires_at = (unsigned long)time(nullptr) + 86400;
        }
    } else {
        // Default to 24 hours if not provided
        result.expires_at = (unsigned long)time(nullptr) + 86400;
    }
    
    return result;
}

SupabaseAppState SupabaseClient::postDeviceState(int rssi, uint32_t freeHeap, 
                                                  uint32_t uptime, const String& firmwareVersion,
                                                  float temperature) {
    SupabaseAppState state;
    state.valid = false;
    state.app_connected = false;
    state.webex_status = "offline";
    state.camera_on = false;
    state.mic_muted = false;
    state.in_call = false;
    
    if (!ensureAuthenticated()) {
        Serial.println("[SUPABASE] Cannot post state - not authenticated");
        return state;
    }
    
    // Build request body
    JsonDocument doc;
    doc["rssi"] = rssi;
    doc["free_heap"] = freeHeap;
    doc["uptime"] = uptime;
    if (!firmwareVersion.isEmpty()) {
        doc["firmware_version"] = firmwareVersion;
    }
    if (temperature != 0) {
        doc["temperature"] = temperature;
    }
    
    String body;
    serializeJson(doc, body);
    
    String response;
    int httpCode = makeRequest("post-device-state", "POST", body, response, false);
    
    if (httpCode == 401) {
        // Token expired - re-authenticate and retry
        Serial.println("[SUPABASE] Token expired, re-authenticating...");
        invalidateToken();
        if (ensureAuthenticated()) {
            httpCode = makeRequest("post-device-state", "POST", body, response, false);
        }
    }
    
    if (httpCode != 200) {
        Serial.printf("[SUPABASE] Post state failed: HTTP %d\n", httpCode);
        return state;
    }
    
    // Parse response
    JsonDocument respDoc;
    DeserializationError error = deserializeJson(respDoc, response);
    
    if (error) {
        Serial.printf("[SUPABASE] Response parse error: %s\n", error.c_str());
        return state;
    }
    
    if (!respDoc["success"].as<bool>()) {
        String errMsg = respDoc["error"] | "Unknown error";
        Serial.printf("[SUPABASE] Post state error: %s\n", errMsg.c_str());
        return state;
    }
    
    // Extract app state
    state.valid = true;
    state.app_connected = respDoc["app_connected"] | false;
    state.webex_status = respDoc["webex_status"] | "offline";
    state.display_name = respDoc["display_name"] | "";
    state.camera_on = respDoc["camera_on"] | false;
    state.mic_muted = respDoc["mic_muted"] | false;
    state.in_call = respDoc["in_call"] | false;
    
    // Update cached state
    _appConnected = state.app_connected;
    _lastAppState = state;
    
    return state;
}

int SupabaseClient::pollCommands(SupabaseCommand commands[], int maxCommands) {
    if (!ensureAuthenticated()) {
        Serial.println("[SUPABASE] Cannot poll commands - not authenticated");
        return 0;
    }
    
    String response;
    int httpCode = makeRequest("poll-commands", "GET", "", response, false);
    
    if (httpCode == 401) {
        // Token expired - re-authenticate and retry
        invalidateToken();
        if (ensureAuthenticated()) {
            httpCode = makeRequest("poll-commands", "GET", "", response, false);
        }
    }
    
    if (httpCode != 200) {
        if (httpCode != 0) {  // Don't log connection failures
            Serial.printf("[SUPABASE] Poll commands failed: HTTP %d\n", httpCode);
        }
        return 0;
    }
    
    // Parse response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    
    if (error) {
        Serial.printf("[SUPABASE] Command response parse error: %s\n", error.c_str());
        return 0;
    }
    
    if (!doc["success"].as<bool>()) {
        return 0;
    }
    
    JsonArray cmdArray = doc["commands"].as<JsonArray>();
    int count = 0;
    
    for (JsonVariant cmdVal : cmdArray) {
        if (count >= maxCommands) break;
        
        commands[count].valid = true;
        commands[count].id = cmdVal["id"].as<String>();
        commands[count].command = cmdVal["command"].as<String>();
        commands[count].created_at = cmdVal["created_at"].as<String>();
        
        // Serialize payload back to string
        JsonObject payload = cmdVal["payload"];
        if (!payload.isNull()) {
            serializeJson(payload, commands[count].payload);
        } else {
            commands[count].payload = "{}";
        }
        
        count++;
    }
    
    if (count > 0) {
        Serial.printf("[SUPABASE] Received %d commands\n", count);
    }
    
    return count;
}

bool SupabaseClient::ackCommand(const String& commandId, bool success, 
                                 const String& responseData, const String& error) {
    if (!ensureAuthenticated()) {
        Serial.println("[SUPABASE] Cannot ack command - not authenticated");
        return false;
    }
    
    // Build request body
    JsonDocument doc;
    doc["command_id"] = commandId;
    doc["success"] = success;
    
    if (!responseData.isEmpty()) {
        // Parse response string as JSON
        JsonDocument respDoc;
        DeserializationError err = deserializeJson(respDoc, responseData);
        if (!err) {
            doc["response"] = respDoc;
        }
    }
    
    if (!error.isEmpty()) {
        doc["error"] = error;
    }
    
    String body;
    serializeJson(doc, body);
    
    String response;
    int httpCode = makeRequest("ack-command", "POST", body, response, false);
    
    if (httpCode == 401) {
        // Token expired - re-authenticate and retry
        invalidateToken();
        if (ensureAuthenticated()) {
            httpCode = makeRequest("ack-command", "POST", body, response, false);
        }
    }
    
    if (httpCode != 200) {
        Serial.printf("[SUPABASE] Ack command failed: HTTP %d\n", httpCode);
        return false;
    }
    
    Serial.printf("[SUPABASE] Command %s acknowledged (success=%d)\n", 
                  commandId.c_str(), success);
    return true;
}

bool SupabaseClient::insertDeviceLog(const String& level, const String& message, const String& metadataJson) {
    if (!ensureAuthenticated()) {
        return false;
    }

    JsonDocument doc;
    doc["level"] = level;
    doc["message"] = message;

    if (!metadataJson.isEmpty()) {
        JsonDocument metaDoc;
        DeserializationError err = deserializeJson(metaDoc, metadataJson);
        if (!err) {
            doc["metadata"] = metaDoc;
        }
    }

    String body;
    serializeJson(doc, body);

    String response;
    int httpCode = makeRequest("insert-device-log", "POST", body, response, false);

    if (httpCode == 401) {
        invalidateToken();
        if (ensureAuthenticated()) {
            httpCode = makeRequest("insert-device-log", "POST", body, response, false);
        }
    }

    return httpCode == 200;
}

int SupabaseClient::makeRequest(const String& endpoint, const String& method,
                                 const String& body, String& response, bool useHmac) {
    if (_supabaseUrl.isEmpty()) {
        return 0;
    }
    
    // Build full URL
    String url = _supabaseUrl + "/functions/v1/" + endpoint;
    
    WiFiClientSecure client;
    if (config_manager.getTlsVerify()) {
        client.setCACert(CA_CERT_BUNDLE_SUPABASE);
    } else {
        client.setInsecure();
    }
    
    HTTPClient http;
    http.begin(client, url);
    http.setTimeout(15000);  // 15 second timeout
    
    // Set headers
    http.addHeader("Content-Type", "application/json");
    
    if (useHmac) {
        // Add HMAC authentication headers
        if (!deviceCredentials.isProvisioned()) {
            Serial.println("[SUPABASE] Cannot add HMAC headers - not provisioned");
            http.end();
            return 0;
        }
        
        uint32_t timestamp = DeviceCredentials::getTimestamp();
        String signature = deviceCredentials.signRequest(timestamp, body);
        
        http.addHeader("X-Device-Serial", deviceCredentials.getSerialNumber());
        http.addHeader("X-Timestamp", String(timestamp));
        http.addHeader("X-Signature", signature);
    } else {
        // Add Bearer token
        if (!_token.isEmpty()) {
            http.addHeader("Authorization", "Bearer " + _token);
        }
    }
    
    // Make request
    int httpCode;
    if (method == "GET") {
        httpCode = http.GET();
    } else if (method == "POST") {
        httpCode = http.POST(body);
    } else {
        Serial.printf("[SUPABASE] Unsupported method: %s\n", method.c_str());
        http.end();
        return 0;
    }
    
    if (httpCode > 0) {
        response = http.getString();
    } else {
        Serial.printf("[SUPABASE] Request failed: %s\n", http.errorToString(httpCode).c_str());
        Serial.printf("[SUPABASE] TLS context: url=%s time=%lu heap=%lu\n",
                      url.c_str(), (unsigned long)time(nullptr), ESP.getFreeHeap());
        response = "";
    }
    
    http.end();
    return httpCode;
}
