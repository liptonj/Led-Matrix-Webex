/**
 * @file config_webex.cpp
 * @brief Webex Configuration Domain Implementation
 */

#include "config_manager.h"
#include "config_macros.h"

// Webex Configuration

CONFIG_CACHED_STRING_GETTER(WebexClientId, "webex_client", cached_client_id, "")
CONFIG_CACHED_STRING_GETTER(WebexClientSecret, "webex_secret", cached_client_secret, "")

void ConfigManager::setWebexCredentials(const String& client_id, const String& client_secret) {
    saveString("webex_client", client_id);
    saveString("webex_secret", client_secret);
    cached_client_id = client_id;
    cached_client_secret = client_secret;
    Serial.println("[CONFIG] Webex credentials saved");
}

bool ConfigManager::hasWebexCredentials() const {
    return !getWebexClientId().isEmpty() && !getWebexClientSecret().isEmpty();
}

CONFIG_CACHED_STRING_GETTER(WebexAccessToken, "webex_access", cached_access_token, "")
CONFIG_CACHED_STRING_GETTER(WebexRefreshToken, "webex_refresh", cached_refresh_token, "")
CONFIG_CACHED_ULONG_GETTER(WebexTokenExpiry, "webex_expiry", cached_token_expiry, 0)

void ConfigManager::setWebexTokens(const String& access_token, const String& refresh_token, unsigned long expiry) {
    saveString("webex_access", access_token);
    saveString("webex_refresh", refresh_token);
    saveUInt("webex_expiry", expiry);
    cached_access_token = access_token;
    cached_refresh_token = refresh_token;
    cached_token_expiry = expiry;
    Serial.println("[CONFIG] Webex tokens saved");
}

bool ConfigManager::hasWebexTokens() const {
    return !getWebexRefreshToken().isEmpty();
}

void ConfigManager::clearWebexTokens() {
    saveString("webex_access", "");
    saveString("webex_refresh", "");
    saveUInt("webex_expiry", 0);
    cached_access_token = "";
    cached_refresh_token = "";
    cached_token_expiry = 0;
    Serial.println("[CONFIG] Webex tokens cleared");
}

CONFIG_CACHED_UINT16_GETTER(WebexPollInterval, "poll_interval", cached_poll_interval, DEFAULT_POLL_INTERVAL)

void ConfigManager::setWebexPollInterval(uint16_t seconds) {
    // Enforce minimum interval
    if (seconds < MIN_POLL_INTERVAL) {
        seconds = MIN_POLL_INTERVAL;
        Serial.printf("[CONFIG] Poll interval clamped to minimum: %d seconds\n", MIN_POLL_INTERVAL);
    }
    if (seconds > MAX_POLL_INTERVAL) {
        seconds = MAX_POLL_INTERVAL;
    }

    saveUInt("poll_interval", seconds);
    cached_poll_interval = seconds;
    Serial.printf("[CONFIG] Poll interval set to %d seconds\n", seconds);
}

// xAPI Configuration

CONFIG_UNCACHED_STRING_GETTER(XAPIDeviceId, "xapi_device", "")
CONFIG_UNCACHED_STRING_SETTER(XAPIDeviceId, "xapi_device")

bool ConfigManager::hasXAPIDevice() const {
    return !getXAPIDeviceId().isEmpty();
}

CONFIG_UNCACHED_UINT16_GETTER(XAPIPollInterval, "xapi_poll", 10)

void ConfigManager::setXAPIPollInterval(uint16_t seconds) {
    if (seconds < 5) seconds = 5;
    if (seconds > 60) seconds = 60;
    saveUInt("xapi_poll", seconds);
}
