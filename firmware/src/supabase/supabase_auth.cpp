/**
 * @file supabase_auth.cpp
 * @brief Supabase Client Authentication Implementation
 * 
 * Handles HMAC authentication, token management, and authentication state.
 */

#include "supabase_client.h"
#include <time.h>
#include "../auth/device_credentials.h"
#include "../debug/remote_logger.h"

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
