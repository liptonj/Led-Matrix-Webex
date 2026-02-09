/**
 * @file supabase_client.cpp
 * @brief Supabase Edge Function Client Core Implementation
 * 
 * Core HTTP client functionality, request handling, and public API methods.
 */

#include "supabase_client.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_ota_ops.h>
#include <time.h>
#include "../auth/device_credentials.h"
#include "../common/ca_certs.h"
#include "../common/secure_client_config.h"
#include "../config/config_manager.h"
#include "../debug/log_system.h"
#include "../core/dependencies.h"
#include "../supabase/supabase_realtime.h"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
#endif

static const char* TAG = "SUPABASE";

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
    
    ESP_LOGI(TAG, "Initialized with URL: %s", _supabaseUrl.c_str());
    ESP_LOGI(TAG, "Pairing code configured");
}

void SupabaseClient::setPairingCode(const String& code) {
    _pairingCode = code;
    _pairingCode.toUpperCase();
    
    // Invalidate token when pairing code changes
    invalidateToken();
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
        ESP_LOGW(TAG, "Cannot post state - not authenticated");
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
    doc["ssid"] = WiFi.SSID();
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        doc["ota_partition"] = running->label;
    }
    
    String body;
    serializeJson(doc, body);
    
    String response;
    int httpCode = makeRequestWithRetry("post-device-state", "POST", body, response);
    
    if (httpCode != 200) {
        ESP_LOGW(TAG, "Post state failed: HTTP %d", httpCode);
        return state;
    }
    
    // Parse response
    JsonDocument respDoc;
    DeserializationError error = deserializeJson(respDoc, response);
    
    if (error) {
        ESP_LOGE(TAG, "Response parse error: %s", error.c_str());
        return state;
    }
    
    if (!respDoc["success"].as<bool>()) {
        String errMsg = respDoc["error"] | "Unknown error";
        ESP_LOGE(TAG, "Post state error: %s", errMsg.c_str());
        return state;
    }

    // Mark request as successful; app state is handled via realtime/commands.
    state.valid = true;

    if (respDoc["debug_enabled"].is<bool>()) {
        _remoteDebugEnabled = respDoc["debug_enabled"] | false;
    }

    if (respDoc["app_connected"].is<bool>()) {
        state.app_connected = respDoc["app_connected"] | false;
        state.webex_status = respDoc["webex_status"] | "offline";
        state.display_name = respDoc["display_name"] | "";
        state.camera_on = respDoc["camera_on"] | false;
        state.mic_muted = respDoc["mic_muted"] | false;
        state.in_call = respDoc["in_call"] | false;

        // Update cached state only when app fields are present
        _appConnected = state.app_connected;
        _lastAppState = state;
    }

    // Check for user_uuid assignment (device may get user after approval)
    String newUserUuid = respDoc["user_uuid"] | "";
    if (!newUserUuid.isEmpty()) {
        auto& deps = getDependencies();
        String currentUserUuid = deps.config.getUserUuid();
        if (currentUserUuid.isEmpty() || currentUserUuid != newUserUuid) {
            deps.config.setUserUuid(newUserUuid);
            ESP_LOGI(TAG, "User UUID updated from post-device-state: %s",
                     newUserUuid.substring(0, 8).c_str());
            deps.realtime.disconnect(); // Reconnect to user channel with new user_uuid
        }
    }
    
    return state;
}

int SupabaseClient::pollCommands(SupabaseCommand commands[], int maxCommands) {
    if (!ensureAuthenticated()) {
        ESP_LOGW(TAG, "Cannot poll commands - not authenticated");
        return 0;
    }
    
    String response;
    int httpCode = makeRequestWithRetry("poll-commands", "GET", "", response);
    
    if (httpCode != 200) {
        if (httpCode != 0) {  // Don't log connection failures
            ESP_LOGW(TAG, "Poll commands failed: HTTP %d", httpCode);
        }
        return 0;
    }
    
    // Parse response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    
    if (error) {
        ESP_LOGE(TAG, "Command response parse error: %s", error.c_str());
        return 0;
    }
    
    if (!doc["success"].as<bool>()) {
        return 0;
    }
    
    JsonArray cmdArray = doc["commands"].as<JsonArray>();
    int count = 0;
    int skipped = 0;
    
    for (JsonVariant cmdVal : cmdArray) {
        if (count >= maxCommands) break;
        
        // REGRESSION FIX: Validate command ID before processing
        String cmdId = cmdVal["id"].as<String>();
        cmdId.trim();  // Remove any whitespace
        
        if (cmdId.isEmpty()) {
            skipped++;
            ESP_LOGW(TAG, "Skipping command with empty ID");
            continue;
        }
        
        // Validate ID format (should be UUID-like: at least 8 chars, alphanumeric with dashes)
        if (cmdId.length() < 8) {
            skipped++;
            ESP_LOGW(TAG, "Skipping command with invalid ID (too short): %s", cmdId.c_str());
            continue;
        }
        
        String cmdName = cmdVal["command"].as<String>();
        if (cmdName.isEmpty()) {
            skipped++;
            ESP_LOGW(TAG, "Skipping command %s with empty command name", cmdId.c_str());
            continue;
        }
        
        commands[count].valid = true;
        commands[count].id = cmdId;
        commands[count].command = cmdName;
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
    
    if (count > 0 || skipped > 0) {
        ESP_LOGI(TAG, "Received %d commands (skipped %d invalid)", count, skipped);
    }
    
    return count;
}

bool SupabaseClient::ackCommand(const String& commandId, bool success, 
                                 const String& responseData, const String& error) {
    // REGRESSION FIX: Validate command ID before attempting ack
    String trimmedId = commandId;
    trimmedId.trim();
    
    if (trimmedId.isEmpty()) {
        ESP_LOGW(TAG, "Cannot ack command - empty command ID");
        return false;
    }
    
    if (trimmedId.length() < 8) {
        ESP_LOGW(TAG, "Cannot ack command - invalid ID (too short): %s", trimmedId.c_str());
        return false;
    }
    
    if (!ensureAuthenticated()) {
        ESP_LOGW(TAG, "Cannot ack command - not authenticated");
        return false;
    }
    
    // Try broadcasting via realtime first
    auto& deps = getDependencies();
    bool broadcastSent = false;
    if (deps.realtime.isConnected()) {
        JsonDocument broadcastData;
        broadcastData["device_uuid"] = deps.config.getDeviceUuid();
        broadcastData["command_id"] = trimmedId;
        broadcastData["status"] = success ? "acked" : "failed";
        
        time_t now;
        time(&now);
        broadcastData["acknowledged_at"] = (unsigned long)now;
        
        if (!responseData.isEmpty()) {
            JsonDocument respDoc;
            DeserializationError err = deserializeJson(respDoc, responseData);
            if (!err) {
                broadcastData["response"] = respDoc;
            }
        }
        
        if (!error.isEmpty()) {
            broadcastData["error"] = error;
        }
        
        broadcastSent = deps.realtime.sendBroadcast("command_ack", broadcastData);
        if (broadcastSent) {
            ESP_LOGI(TAG, "Command %s broadcast via realtime (success=%d)",
                     trimmedId.c_str(), success);
        }
    }
    
    // Always send HTTP for DB persistence (even if broadcast succeeded)
    // Build request body
    JsonDocument doc;
    doc["command_id"] = trimmedId;
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
    int httpCode = makeRequestWithRetry("ack-command", "POST", body, response);
    
    if (httpCode != 200) {
        ESP_LOGW(TAG, "Ack command failed: HTTP %d", httpCode);
        // Return true if broadcast succeeded even if HTTP failed
        return broadcastSent;
    }
    
    ESP_LOGI(TAG, "Command %s acknowledged (success=%d, broadcast=%d)",
             trimmedId.c_str(), success, broadcastSent);
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
    int httpCode = makeRequestWithRetry("insert-device-log", "POST", body, response);

    if (httpCode != 200) {
        static unsigned long last_log_error = 0;
        unsigned long now = millis();
        // FIXED: Handle millis() wraparound properly
        unsigned long elapsed = now - last_log_error;
        if (elapsed > 10000) {
            last_log_error = now;
            ESP_LOGW(TAG, "insert-device-log failed: HTTP %d", httpCode);
        }
        return false;
    }

    return true;
}

bool SupabaseClient::syncWebexStatus(String& webexStatus, const String& payload) {
    if (!ensureAuthenticated()) {
        return false;
    }

    _webexTokenMissing = false;

    String body = payload;
    if (body.isEmpty()) {
        body = "{}";
    }

    String response;
    int httpCode = makeRequest("webex-status", "POST", body, response, false, true);
    if (httpCode <= 0) {
        return false;
    }

    if (httpCode != 200) {
        if (httpCode == 404 && response.indexOf("Webex token not found") >= 0) {
            _webexTokenMissing = true;
        }
        if (!response.isEmpty()) {
            ESP_LOGW(TAG, "webex-status failed (%d): %s", httpCode, response.c_str());
        } else {
            ESP_LOGW(TAG, "webex-status failed (%d)", httpCode);
        }
        return false;
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, response);
    if (err) {
        ESP_LOGE(TAG, "webex-status parse error: %s", err.c_str());
        return false;
    }

    const char* status = doc["webex_status"];
    if (status) {
        webexStatus = String(status);
        return true;
    }

    return false;
}

bool SupabaseClient::beginRequestSlot(bool allowImmediate) {
    if (_requestInFlight) {
        return false;
    }
    unsigned long now = millis();
    // FIXED: Handle millis() wraparound properly
    unsigned long elapsed = now - _lastRequestMs;
    if (!allowImmediate && elapsed < _minRequestIntervalMs) {
        return false;
    }
    _requestInFlight = true;
    _lastRequestMs = now;
    return true;
}

int SupabaseClient::makeRequest(const String& endpoint, const String& method,
                                 const String& body, String& response, bool useHmac, bool allowImmediate) {
    if (_supabaseUrl.isEmpty()) {
        return 0;
    }
    if (!beginRequestSlot(allowImmediate)) {
        return -2;
    }
    
    // Build full URL
    String url = _supabaseUrl + "/functions/v1/" + endpoint;
    
    _client.stop();
    auto& deps = getDependencies();
    configureSecureClientWithTls(_client, CA_CERT_BUNDLE_SUPABASE, 
                                 deps.config.getTlsVerify(), 2048, 2048);
    
    HTTPClient http;
    http.begin(_client, url);
    http.setTimeout(15000);  // 15 second timeout
    
    // Set headers
    http.addHeader("Content-Type", "application/json");
    uint32_t hmacTimestamp = 0;
    bool hmacUsed = false;
    
    // Always add Bearer token when available
    if (!_token.isEmpty()) {
        http.addHeader("Authorization", "Bearer " + _token);
    }
    
    // Always add HMAC headers when device is provisioned
    if (deviceCredentials.isProvisioned()) {
        if (!addHmacHeaders(http, body)) {
            if (useHmac) {
                // HMAC was explicitly required (e.g., device-auth) - fail
                http.end();
                _requestInFlight = false;
                return 0;
            }
            // HMAC was best-effort - continue without it
            ESP_LOGW(TAG, "HMAC headers failed (best-effort), continuing with JWT only");
        } else {
            hmacUsed = true;
            hmacTimestamp = DeviceCredentials::getTimestamp();
        }
    }

#if SUPABASE_AUTH_DEBUG
    if (endpoint == "device-auth") {
        ESP_LOGD(TAG, "Request debug: %s %s", method.c_str(), url.c_str());
        ESP_LOGD(TAG, "Request headers: Content-Type=application/json");
        if (!_token.isEmpty()) {
            ESP_LOGD(TAG, "Request headers: Authorization=Bearer <redacted>");
        }
        if (hmacUsed) {
            ESP_LOGD(TAG, "Request headers: X-Device-Serial=%s",
                     deviceCredentials.getSerialNumber().c_str());
            ESP_LOGD(TAG, "Request headers: X-Timestamp=%lu",
                     (unsigned long)hmacTimestamp);
            ESP_LOGD(TAG, "Request headers: X-Signature=<redacted>");
        }
        if (body.isEmpty()) {
            ESP_LOGD(TAG, "Request payload: (empty)");
        } else {
            ESP_LOGD(TAG, "Request payload: %s", body.c_str());
        }
    }
#endif
    
    // Make request
    int httpCode;
    if (method == "GET") {
        httpCode = http.GET();
    } else if (method == "POST") {
        httpCode = http.POST(body);
    } else {
        ESP_LOGW(TAG, "Unsupported method: %s", method.c_str());
        http.end();
        _requestInFlight = false;
        return 0;
    }
    
    if (httpCode > 0) {
        response = http.getString();
    } else {
        ESP_LOGE(TAG, "Request failed: %s", http.errorToString(httpCode).c_str());
        ESP_LOGD(TAG, "TLS context: url=%s time=%lu heap=%lu",
                 url.c_str(), (unsigned long)time(nullptr), ESP.getFreeHeap());
        response = "";
    }
    
    http.end();
    _requestInFlight = false;
    return httpCode;
}
