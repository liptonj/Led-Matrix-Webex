/**
 * @file supabase_client.cpp
 * @brief Supabase Edge Function Client Implementation
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
#include "../debug.h"
#include "../debug/remote_logger.h"

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
    Serial.println("[SUPABASE] Pairing code configured");
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
    _lastAuthError = SupabaseAuthError::None;
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
    
    int httpCode = makeRequest("device-auth", "POST", body, response, true, true);
    if (httpCode == -2) {
        return false;
    }
    
    if (httpCode != 200) {
        RLOG_ERROR("supabase", "Auth failed: HTTP %d", httpCode);
        if (!response.isEmpty()) {
            Serial.printf("[SUPABASE] Response: %s\n", response.c_str());
            if (response.indexOf("Invalid signature") >= 0) {
                _lastAuthError = SupabaseAuthError::InvalidSignature;
            } else if (response.indexOf("approval_required") >= 0) {
                _lastAuthError = SupabaseAuthError::ApprovalRequired;
            } else if (response.indexOf("device_disabled") >= 0) {
                _lastAuthError = SupabaseAuthError::Disabled;
            } else if (response.indexOf("device_blacklisted") >= 0) {
                _lastAuthError = SupabaseAuthError::Blacklisted;
            } else if (response.indexOf("device_deleted") >= 0) {
                _lastAuthError = SupabaseAuthError::Deleted;
            } else {
                _lastAuthError = SupabaseAuthError::Other;
            }
        } else {
            _lastAuthError = SupabaseAuthError::Other;
        }
        return false;
    }
    
    // Parse auth response
    SupabaseAuthResult result = parseAuthResponse(response);
    
    if (!result.success) {
        RLOG_ERROR("supabase", "Auth response parsing failed");
        _lastAuthError = SupabaseAuthError::Other;
        return false;
    }
    
    _token = result.token;
    _tokenExpiresAt = result.expires_at;
    _pairingCode = result.pairing_code;
    _targetFirmwareVersion = result.target_firmware_version;
    _remoteDebugEnabled = result.debug_enabled;
    _supabaseAnonKey = result.anon_key;

    // Debug: log auth response summary without secrets
#if SUPABASE_AUTH_DEBUG
    Serial.printf("[SUPABASE] Auth response summary: pairing=%s device_id=%s expires_at=%lu debug=%d\n",
                  result.pairing_code.isEmpty() ? "(none)" : "***",
                  result.device_id.c_str(),
                  result.expires_at,
                  result.debug_enabled ? 1 : 0);
    if (!result.target_firmware_version.isEmpty()) {
        Serial.printf("[SUPABASE] Auth response target firmware: %s\n",
                      result.target_firmware_version.c_str());
    }
#endif
    
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

bool SupabaseClient::addHmacHeaders(HTTPClient& http, const String& body) {
    if (!deviceCredentials.isProvisioned()) {
        Serial.println("[SUPABASE] Cannot add HMAC headers - not provisioned");
        return false;
    }
    
    uint32_t timestamp = DeviceCredentials::getTimestamp();
    String signature = deviceCredentials.signRequest(timestamp, body);
    
    http.addHeader("X-Device-Serial", deviceCredentials.getSerialNumber());
    http.addHeader("X-Timestamp", String(timestamp));
    http.addHeader("X-Signature", signature);
    
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
        RLOG_ERROR("supabase", "JSON parse error: %s", error.c_str());
        return result;
    }
    
    if (!doc["success"].as<bool>()) {
        String errMsg = doc["error"] | "Unknown error";
        RLOG_ERROR("supabase", "Auth error: %s", errMsg.c_str());
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
        // Remove 'Z' suffix if present (strptime doesn't handle it)
        String parseStr = expiresAtStr;
        if (parseStr.endsWith("Z")) {
            parseStr = parseStr.substring(0, parseStr.length() - 1);
        }
        
        struct tm tm_expires = {};
        if (strptime(parseStr.c_str(), "%Y-%m-%dT%H:%M:%S", &tm_expires) != nullptr) {
            // FIXED: Use timegm() instead of mktime() for UTC timestamps
            // timegm() interprets tm as UTC, mktime() interprets as local time
            // ISO 8601 with 'Z' suffix is always UTC
            #ifdef ESP_PLATFORM
                // ESP32: Use mktime() but ensure UTC (time() on ESP32 is already UTC)
                result.expires_at = mktime(&tm_expires);
            #else
                // Other platforms: Use timegm() for proper UTC handling
                result.expires_at = timegm(&tm_expires);
            #endif
        } else {
            // If parsing fails, set to 24 hours from now
            Serial.printf("[SUPABASE] Failed to parse expires_at: %s\n", expiresAtStr.c_str());
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
        RLOG_WARN("supabase", "Post state failed: HTTP %d", httpCode);
        return state;
    }
    
    // Parse response
    JsonDocument respDoc;
    DeserializationError error = deserializeJson(respDoc, response);
    
    if (error) {
        RLOG_ERROR("supabase", "Response parse error: %s", error.c_str());
        return state;
    }
    
    if (!respDoc["success"].as<bool>()) {
        String errMsg = respDoc["error"] | "Unknown error";
        RLOG_ERROR("supabase", "Post state error: %s", errMsg.c_str());
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
    
    return state;
}

int SupabaseClient::pollCommands(SupabaseCommand commands[], int maxCommands) {
    if (!ensureAuthenticated()) {
        Serial.println("[SUPABASE] Cannot poll commands - not authenticated");
        return 0;
    }
    
    String response;
    int httpCode = makeRequestWithRetry("poll-commands", "GET", "", response);
    
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
    int skipped = 0;
    
    for (JsonVariant cmdVal : cmdArray) {
        if (count >= maxCommands) break;
        
        // REGRESSION FIX: Validate command ID before processing
        String cmdId = cmdVal["id"].as<String>();
        cmdId.trim();  // Remove any whitespace
        
        if (cmdId.isEmpty()) {
            skipped++;
            Serial.println("[SUPABASE] Skipping command with empty ID");
            continue;
        }
        
        // Validate ID format (should be UUID-like: at least 8 chars, alphanumeric with dashes)
        if (cmdId.length() < 8) {
            skipped++;
            Serial.printf("[SUPABASE] Skipping command with invalid ID (too short): %s\n", cmdId.c_str());
            continue;
        }
        
        String cmdName = cmdVal["command"].as<String>();
        if (cmdName.isEmpty()) {
            skipped++;
            Serial.printf("[SUPABASE] Skipping command %s with empty command name\n", cmdId.c_str());
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
        Serial.printf("[SUPABASE] Received %d commands (skipped %d invalid)\n", count, skipped);
    }
    
    return count;
}

bool SupabaseClient::ackCommand(const String& commandId, bool success, 
                                 const String& responseData, const String& error) {
    // REGRESSION FIX: Validate command ID before attempting ack
    String trimmedId = commandId;
    trimmedId.trim();
    
    if (trimmedId.isEmpty()) {
        Serial.println("[SUPABASE] Cannot ack command - empty command ID");
        return false;
    }
    
    if (trimmedId.length() < 8) {
        Serial.printf("[SUPABASE] Cannot ack command - invalid ID (too short): %s\n", trimmedId.c_str());
        return false;
    }
    
    if (!ensureAuthenticated()) {
        Serial.println("[SUPABASE] Cannot ack command - not authenticated");
        return false;
    }
    
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
        RLOG_WARN("supabase", "Ack command failed: HTTP %d", httpCode);
        return false;
    }
    
    Serial.printf("[SUPABASE] Command %s acknowledged (success=%d)\n", 
                  trimmedId.c_str(), success);
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
            Serial.printf("[SUPABASE] insert-device-log failed: HTTP %d\n", httpCode);
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
            Serial.printf("[SUPABASE] webex-status failed (%d): %s\n", httpCode, response.c_str());
        } else {
            Serial.printf("[SUPABASE] webex-status failed (%d)\n", httpCode);
        }
        return false;
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, response);
    if (err) {
        RLOG_ERROR("supabase", "webex-status parse error: %s", err.c_str());
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
    configureSecureClientWithTls(_client, CA_CERT_BUNDLE_SUPABASE, 
                                 config_manager.getTlsVerify(), 2048, 2048);
    
    HTTPClient http;
    http.begin(_client, url);
    http.setTimeout(15000);  // 15 second timeout
    
    // Set headers
    http.addHeader("Content-Type", "application/json");
    uint32_t hmacTimestamp = 0;
    bool hmacUsed = false;
    
    if (useHmac) {
        // Add HMAC authentication headers using helper
        if (!addHmacHeaders(http, body)) {
            http.end();
            return 0;
        }
        hmacUsed = true;
        hmacTimestamp = DeviceCredentials::getTimestamp(); // For debug logging
    } else {
        // Add Bearer token
        if (!_token.isEmpty()) {
            http.addHeader("Authorization", "Bearer " + _token);
        }
    }

#if SUPABASE_AUTH_DEBUG
    if (endpoint == "device-auth") {
        Serial.printf("[SUPABASE] Request debug: %s %s\n", method.c_str(), url.c_str());
        Serial.println("[SUPABASE] Request headers: Content-Type=application/json");
        if (hmacUsed) {
            Serial.printf("[SUPABASE] Request headers: X-Device-Serial=%s\n",
                          deviceCredentials.getSerialNumber().c_str());
            Serial.printf("[SUPABASE] Request headers: X-Timestamp=%lu\n",
                          (unsigned long)hmacTimestamp);
            Serial.println("[SUPABASE] Request headers: X-Signature=<redacted>");
        } else if (!_token.isEmpty()) {
            Serial.println("[SUPABASE] Request headers: Authorization=Bearer <redacted>");
        }
        if (body.isEmpty()) {
            Serial.println("[SUPABASE] Request payload: (empty)");
        } else {
            Serial.printf("[SUPABASE] Request payload: %s\n", body.c_str());
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
        Serial.printf("[SUPABASE] Unsupported method: %s\n", method.c_str());
        http.end();
        _requestInFlight = false;
        return 0;
    }
    
    if (httpCode > 0) {
        response = http.getString();
    } else {
        RLOG_ERROR("supabase", "Request failed: %s", http.errorToString(httpCode).c_str());
        Serial.printf("[SUPABASE] TLS context: url=%s time=%lu heap=%lu\n",
                      url.c_str(), (unsigned long)time(nullptr), ESP.getFreeHeap());
        response = "";
    }
    
    http.end();
    _requestInFlight = false;
    return httpCode;
}

int SupabaseClient::makeRequestWithRetry(const String& endpoint, const String& method,
                                         const String& body, String& response) {
    // REGRESSION FIX: Implement proper retry with exponential backoff for TLS/network errors
    // Uses SUPABASE_MAX_RETRIES and SUPABASE_RETRY_DELAY_MS from header
    
    // Minimum heap required for TLS operations (internal RAM needed for DMA)
    constexpr uint32_t MIN_HEAP_FOR_TLS = 50000;
    constexpr uint32_t MIN_BLOCK_FOR_TLS = 30000;
    
    int httpCode = 0;
    int retryCount = 0;
    unsigned long retryDelayMs = SUPABASE_RETRY_DELAY_MS;
    
    while (retryCount < SUPABASE_MAX_RETRIES) {
        // Check heap before attempting request (except first try)
        if (retryCount > 0) {
            uint32_t freeHeap = ESP.getFreeHeap();
            uint32_t maxBlock = ESP.getMaxAllocHeap();
            
            if (freeHeap < MIN_HEAP_FOR_TLS || maxBlock < MIN_BLOCK_FOR_TLS) {
                Serial.printf("[SUPABASE] Retry %d/%d skipped - low heap: %lu free, %lu block\n",
                             retryCount + 1, SUPABASE_MAX_RETRIES, 
                             (unsigned long)freeHeap, (unsigned long)maxBlock);
                // Wait and let memory stabilize
                delay(retryDelayMs);
                retryDelayMs = min(retryDelayMs * 2, 10000UL);  // Cap at 10 seconds
                retryCount++;
                continue;
            }
            
            Serial.printf("[SUPABASE] Retry %d/%d after %lums delay (heap=%lu)\n",
                         retryCount + 1, SUPABASE_MAX_RETRIES, 
                         retryDelayMs, (unsigned long)freeHeap);
        }
        
        httpCode = makeRequest(endpoint, method, body, response, false);
        
        // Rate limited - don't retry
        if (httpCode == -2) {
            return httpCode;
        }
        
        // Success or non-retryable server error
        if (httpCode >= 200 && httpCode < 500 && httpCode != 401) {
            return httpCode;
        }
        
        // Handle 401 by re-authenticating
        if (httpCode == 401) {
            Serial.println("[SUPABASE] Token expired, re-authenticating...");
            invalidateToken();
            if (ensureAuthenticated()) {
                // Retry with new token
                httpCode = makeRequest(endpoint, method, body, response, false);
                if (httpCode >= 200 && httpCode < 500) {
                    return httpCode;
                }
            }
        }
        
        // Handle TLS/network errors (negative HTTP codes)
        // -11 = HTTPC_ERROR_READ_TIMEOUT (the main issue we're fixing)
        // -1 to -10 = Other connection errors
        if (httpCode < 0) {
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
            }
            
            Serial.printf("[SUPABASE] %s failed: HTTP %d (%s) on attempt %d/%d\n",
                         endpoint.c_str(), httpCode, errorDesc, 
                         retryCount + 1, SUPABASE_MAX_RETRIES);
            
            // For low RAM error, wait longer
            if (httpCode == -8) {
                retryDelayMs = max(retryDelayMs, 5000UL);
            }
            
            // Wait before retry with exponential backoff
            if (retryCount + 1 < SUPABASE_MAX_RETRIES) {
                delay(retryDelayMs);
                retryDelayMs = min(retryDelayMs * 2, 10000UL);  // Cap at 10 seconds
            }
        }
        
        // Handle 5xx server errors with retry
        if (httpCode >= 500) {
            Serial.printf("[SUPABASE] %s server error: HTTP %d on attempt %d/%d\n",
                         endpoint.c_str(), httpCode, retryCount + 1, SUPABASE_MAX_RETRIES);
            
            if (retryCount + 1 < SUPABASE_MAX_RETRIES) {
                delay(retryDelayMs);
                retryDelayMs = min(retryDelayMs * 2, 10000UL);
            }
        }
        
        retryCount++;
    }
    
    // All retries exhausted
    if (httpCode < 0 || httpCode >= 500) {
        Serial.printf("[SUPABASE] %s failed after %d retries: HTTP %d\n",
                     endpoint.c_str(), SUPABASE_MAX_RETRIES, httpCode);
    }
    
    return httpCode;
}
