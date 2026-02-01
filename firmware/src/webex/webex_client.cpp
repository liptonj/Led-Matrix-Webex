/**
 * @file webex_client.cpp
 * @brief Webex People API Client Implementation
 */

#include "webex_client.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include "../common/ca_certs.h"
#include "../common/secure_client_config.h"

WebexClient::WebexClient()
    : config_manager(nullptr), last_request_time(0), rate_limit_backoff(0) {
}

WebexClient::~WebexClient() {
}

void WebexClient::begin(ConfigManager* config) {
    config_manager = config;
    oauth_handler.begin(config);
    
    Serial.println("[WEBEX] Client initialized");
}

bool WebexClient::refreshToken() {
    if (!oauth_handler.hasValidTokens()) {
        return false;
    }
    
    if (oauth_handler.needsRefresh()) {
        return oauth_handler.refreshAccessToken();
    }
    
    return true;
}

bool WebexClient::getPresence(WebexPresence& presence) {
    presence.valid = false;
    
    // Check rate limit backoff
    if (rate_limit_backoff > 0) {
        unsigned long backoff_ms = rate_limit_backoff * 1000UL;
        unsigned long now = millis();
        // FIXED: Handle millis() wraparound properly
        unsigned long elapsed = now - last_request_time;
        if (elapsed < backoff_ms) {
            Serial.println("[WEBEX] Rate limit backoff active, skipping request");
            return false;
        }
        rate_limit_backoff = 0;
    }
    
    // Ensure we have a valid token
    if (oauth_handler.needsRefresh()) {
        if (!oauth_handler.refreshAccessToken()) {
            Serial.println("[WEBEX] Failed to refresh token");
            return false;
        }
    }
    
    String response = makeApiRequest(WEBEX_PEOPLE_ME);
    
    if (response.isEmpty()) {
        return false;
    }
    
    // Parse response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    
    if (error) {
        Serial.printf("[WEBEX] Failed to parse response: %s\n", error.c_str());
        return false;
    }
    
    // Extract presence information
    presence.status = doc["status"].as<String>();
    presence.display_name = doc["displayName"].as<String>();
    presence.first_name = doc["firstName"].as<String>();
    presence.email = doc["emails"][0].as<String>();
    presence.last_activity = doc["lastActivity"].as<String>();
    presence.valid = true;
    
    Serial.printf("[WEBEX] Presence: %s (%s, first: %s)\n", 
                  presence.status.c_str(), presence.display_name.c_str(),
                  presence.first_name.c_str());
    
    return true;
}

bool WebexClient::isAuthenticated() const {
    return oauth_handler.hasValidTokens();
}

bool WebexClient::handleOAuthCallback(const String& code, const String& redirect_uri) {
    return oauth_handler.exchangeCode(code, redirect_uri);
}

String WebexClient::makeApiRequest(const String& endpoint, bool is_retry) {
    String access_token = oauth_handler.getAccessToken();
    
    if (access_token.isEmpty()) {
        Serial.println("[WEBEX] No access token available!");
        return "";
    }
    
    WiFiClientSecure client;
    configureSecureClientWithTls(client, CA_CERT_BUNDLE_WEBEX, 
                                config_manager && config_manager->getTlsVerify());
    
    HTTPClient http;
    String url = String(WEBEX_API_BASE) + endpoint;
    
    http.begin(client, url);
    http.addHeader("Authorization", "Bearer " + access_token);
    http.addHeader("Content-Type", "application/json");
    
    last_request_time = millis();
    int httpCode = http.GET();
    
    if (httpCode == HTTP_CODE_OK) {
        String response = http.getString();
        http.end();
        return response;
    }
    
    // Handle errors
    handleRateLimit(httpCode);
    
    // Handle 401 Unauthorized - try refresh once (prevent infinite recursion)
    if (httpCode == 401 && !is_retry) {
        Serial.println("[WEBEX] Unauthorized - attempting token refresh");
        http.end();
        
        if (oauth_handler.refreshAccessToken()) {
            Serial.println("[WEBEX] Token refreshed, retrying request");
            // Retry request with new token (pass is_retry=true)
            return makeApiRequest(endpoint, true);
        } else {
            Serial.println("[WEBEX] Token refresh failed - re-authorization required");
            return "";
        }
    }
    
    Serial.printf("[WEBEX] API request failed with code: %d\n", httpCode);
    String errorBody = http.getString();
    if (!errorBody.isEmpty()) {
        Serial.printf("[WEBEX] Error response: %s\n", errorBody.c_str());
    }
    http.end();
    
    return "";
}

void WebexClient::handleRateLimit(int httpCode) {
    if (httpCode == 429) {
        // Rate limited - back off
        rate_limit_backoff = rate_limit_backoff == 0 ? 30 : rate_limit_backoff * 2;
        
        // Cap at 120 seconds
        if (rate_limit_backoff > 120) {
            rate_limit_backoff = 120;
        }
        
        Serial.printf("[WEBEX] Rate limited! Backing off for %d seconds\n", rate_limit_backoff);
    }
}
