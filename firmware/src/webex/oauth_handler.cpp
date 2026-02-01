/**
 * @file oauth_handler.cpp
 * @brief Webex OAuth2 Handler Implementation
 */

#include "oauth_handler.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <esp_random.h>
#include "../common/ca_certs.h"
#include "../common/secure_client_config.h"
#include "../common/url_utils.h"

OAuthHandler::OAuthHandler()
    : config_manager(nullptr), token_expiry(0) {
}

OAuthHandler::~OAuthHandler() {
}

void OAuthHandler::begin(ConfigManager* config) {
    config_manager = config;
    
    // Load existing tokens from config
    if (config_manager->hasWebexTokens()) {
        access_token = config_manager->getWebexAccessToken();
        refresh_token = config_manager->getWebexRefreshToken();
        token_expiry = config_manager->getWebexTokenExpiry();
        
        Serial.println("[OAUTH] Loaded existing tokens from storage");
    }
}

String OAuthHandler::buildAuthUrl(const String& redirect_uri) {
    String client_id = config_manager->getWebexClientId();
    
    if (client_id.isEmpty()) {
        Serial.println("[OAUTH] Client ID not configured!");
        return "";
    }
    
    // Generate cryptographically secure state for CSRF protection
    // Use esp_random() for better entropy
    char state_chars[13];  // 12 hex chars + null terminator
    for (int i = 0; i < 6; i++) {
        uint32_t rand = esp_random();
        snprintf(&state_chars[i * 2], 3, "%02x", (rand >> 16) & 0xFF);
    }
    String state = String(state_chars);
    
    // Store state for validation (in production, this should be session-based)
    oauth_state = state;
    
    String url = WEBEX_AUTH_URL;
    url += "?client_id=" + urlEncode(client_id);
    url += "&response_type=code";
    url += "&redirect_uri=" + urlEncode(redirect_uri);
    url += "&scope=" + urlEncode(String(WEBEX_SCOPE_PEOPLE) + " " + String(WEBEX_SCOPE_XAPI));
    url += "&state=" + state;
    
    return url;
}

bool OAuthHandler::validateState(const String& state) const {
    if (oauth_state.isEmpty()) {
        Serial.println("[OAUTH] No stored state - possible CSRF attack");
        return false;
    }
    
    if (state != oauth_state) {
        Serial.println("[OAUTH] State mismatch - possible CSRF attack");
        return false;
    }
    
    return true;
}

bool OAuthHandler::exchangeCode(const String& code, const String& redirect_uri) {
    String client_id = config_manager->getWebexClientId();
    String client_secret = config_manager->getWebexClientSecret();
    
    if (client_id.isEmpty() || client_secret.isEmpty()) {
        Serial.println("[OAUTH] Credentials not configured!");
        return false;
    }
    
    WiFiClientSecure client;
    configureSecureClientWithTls(client, CA_CERT_BUNDLE_WEBEX, config_manager->getTlsVerify());
    
    HTTPClient http;
    http.begin(client, WEBEX_TOKEN_URL);
    http.addHeader("Content-Type", "application/x-www-form-urlencoded");
    
    String body = "grant_type=authorization_code";
    body += "&client_id=" + urlEncode(client_id);
    body += "&client_secret=" + urlEncode(client_secret);
    body += "&code=" + urlEncode(code);
    body += "&redirect_uri=" + urlEncode(redirect_uri);
    
    Serial.println("[OAUTH] Exchanging authorization code for tokens...");
    
    int httpCode = http.POST(body);
    
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OAUTH] Token exchange failed with code: %d\n", httpCode);
        Serial.println(http.getString());
        http.end();
        return false;
    }
    
    String response = http.getString();
    http.end();
    
    if (!parseTokenResponse(response)) {
        return false;
    }
    
    // Save tokens to config
    config_manager->setWebexTokens(access_token, refresh_token, token_expiry);
    
    Serial.println("[OAUTH] Token exchange successful!");
    return true;
}

bool OAuthHandler::refreshAccessToken() {
    if (refresh_token.isEmpty()) {
        // Try to load from config
        refresh_token = config_manager->getWebexRefreshToken();
        if (refresh_token.isEmpty()) {
            Serial.println("[OAUTH] No refresh token available!");
            return false;
        }
    }
    
    String client_id = config_manager->getWebexClientId();
    String client_secret = config_manager->getWebexClientSecret();
    
    if (client_id.isEmpty() || client_secret.isEmpty()) {
        Serial.println("[OAUTH] Credentials not configured!");
        return false;
    }
    
    WiFiClientSecure client;
    configureSecureClientWithTls(client, CA_CERT_BUNDLE_WEBEX, config_manager->getTlsVerify());
    
    HTTPClient http;
    http.begin(client, WEBEX_TOKEN_URL);
    http.addHeader("Content-Type", "application/x-www-form-urlencoded");
    
    String body = "grant_type=refresh_token";
    body += "&client_id=" + urlEncode(client_id);
    body += "&client_secret=" + urlEncode(client_secret);
    body += "&refresh_token=" + urlEncode(refresh_token);
    
    Serial.println("[OAUTH] Refreshing access token...");
    
    int httpCode = http.POST(body);
    
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OAUTH] Token refresh failed with code: %d\n", httpCode);
        
        if (httpCode == 400 || httpCode == 401) {
            // Refresh token may be invalid/expired
            Serial.println("[OAUTH] Refresh token may be expired. Re-authorization required.");
            clearTokens();
        }
        
        http.end();
        return false;
    }
    
    String response = http.getString();
    http.end();
    
    if (!parseTokenResponse(response)) {
        return false;
    }
    
    // Save updated tokens to config
    config_manager->setWebexTokens(access_token, refresh_token, token_expiry);
    
    Serial.println("[OAUTH] Token refresh successful!");
    return true;
}

String OAuthHandler::getAccessToken() const {
    return access_token;
}

bool OAuthHandler::hasValidTokens() const {
    return !access_token.isEmpty() && !refresh_token.isEmpty();
}

bool OAuthHandler::needsRefresh() const {
    if (access_token.isEmpty()) {
        return true;
    }
    
    // Refresh if token expires in less than 5 minutes
    unsigned long now = millis() / 1000;
    return (token_expiry > 0 && now >= (token_expiry - 300));
}

void OAuthHandler::clearTokens() {
    access_token = "";
    refresh_token = "";
    token_expiry = 0;
    
    if (config_manager) {
        config_manager->clearWebexTokens();
    }
    
    Serial.println("[OAUTH] Tokens cleared");
}

bool OAuthHandler::parseTokenResponse(const String& response) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    
    if (error) {
        Serial.printf("[OAUTH] Failed to parse token response: %s\n", error.c_str());
        return false;
    }
    
    if (!doc["access_token"].is<String>()) {
        Serial.println("[OAUTH] No access token in response!");
        return false;
    }
    
    access_token = doc["access_token"].as<String>();
    
    if (doc["refresh_token"].is<String>()) {
        refresh_token = doc["refresh_token"].as<String>();
    }
    
    // Calculate expiry time
    int expires_in = doc["expires_in"] | 3600;
    token_expiry = (millis() / 1000) + expires_in;
    
    Serial.printf("[OAUTH] Token received, expires in %d seconds\n", expires_in);
    return true;
}

// Note: urlEncode() implementation moved to common/url_utils.h
// This eliminates duplication across oauth_handler.cpp, api_webex.cpp, and supabase_realtime.cpp
