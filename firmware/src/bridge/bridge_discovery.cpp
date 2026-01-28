/**
 * @file bridge_discovery.cpp
 * @brief Bridge Discovery Client Implementation
 */

#include "bridge_discovery.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include "../common/ca_certs.h"
#include "../config/config_manager.h"

extern ConfigManager config_manager;

BridgeDiscovery::BridgeDiscovery() {
    config.valid = false;
    config.pairing_enabled = true;
    config.fetched_at = 0;
}

bool BridgeDiscovery::fetchConfig(bool force) {
    // Check if we need to refresh
    if (!force && hasValidConfig() && !needsRefresh()) {
        Serial.println("[DISCOVERY] Using cached config");
        return true;
    }

    // Check WiFi connection
    if (!WiFi.isConnected()) {
        Serial.println("[DISCOVERY] WiFi not connected, cannot fetch config");
        return false;
    }

    Serial.printf("[DISCOVERY] Fetching bridge configuration from %s\n", BRIDGE_CONFIG_URL);

    WiFiClientSecure client;
    if (config_manager.getTlsVerify()) {
        client.setCACert(CA_CERT_BUNDLE_OTA);  // GTS Root R4 for display.5ls.us
    } else {
        client.setInsecure();
    }

    HTTPClient http;
    http.begin(client, BRIDGE_CONFIG_URL);
    http.setTimeout(10000);  // 10 second timeout

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[DISCOVERY] HTTP error: %d (URL: %s)\n", httpCode, BRIDGE_CONFIG_URL);
        http.end();
        return false;
    }

    Serial.printf("[DISCOVERY] HTTP %d OK\n", httpCode);

    String payload = http.getString();
    http.end();

    if (parseConfig(payload)) {
        config.valid = true;
        config.fetched_at = millis();
        Serial.printf("[DISCOVERY] Config loaded - Bridge URL: %s\n", config.url.c_str());
        return true;
    }

    Serial.println("[DISCOVERY] Failed to parse config");
    return false;
}

bool BridgeDiscovery::parseConfig(const String& json) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);

    if (error) {
        Serial.printf("[DISCOVERY] JSON parse error: %s\n", error.c_str());
        return false;
    }

    // Parse bridge section
    JsonObject bridge = doc["bridge"];
    if (bridge.isNull()) {
        Serial.println("[DISCOVERY] Missing 'bridge' section in config");
        return false;
    }

    config.url = bridge["url"].as<String>();
    config.fallback_url = bridge["fallback_url"].as<String>();

    // Parse features section (optional)
    JsonObject features = doc["features"];
    if (!features.isNull()) {
        config.pairing_enabled = features["pairing_enabled"] | true;
    }

    // Parse supabase section (optional - for device provisioning)
    JsonObject supabase = doc["supabase"];
    if (!supabase.isNull()) {
        config.supabase_url = supabase["url"].as<String>();
        if (!config.supabase_url.isEmpty()) {
            Serial.printf("[DISCOVERY] Supabase URL: %s\n", config.supabase_url.c_str());
        }
    }

    // Validate we got a URL
    if (config.url.isEmpty()) {
        Serial.println("[DISCOVERY] Empty bridge URL in config");
        return false;
    }

    return true;
}

bool BridgeDiscovery::hasValidConfig() const {
    return config.valid && !config.url.isEmpty();
}

String BridgeDiscovery::getBridgeUrl() const {
    if (hasValidConfig()) {
        return config.url;
    }
    // Return default if no config
    return "wss://bridge.5ls.us";
}

String BridgeDiscovery::getFallbackUrl() const {
    if (hasValidConfig() && !config.fallback_url.isEmpty()) {
        return config.fallback_url;
    }
    // Return default fallback
    return "ws://webex-bridge.local:8080";
}

String BridgeDiscovery::getSupabaseUrl() const {
    if (hasValidConfig() && !config.supabase_url.isEmpty()) {
        return config.supabase_url;
    }
    // Return default Supabase URL defined at build time
    // This provides a fallback for existing devices when bridge-config.json
    // doesn't include a supabase section yet.
    // DEFAULT_SUPABASE_URL is set in platformio.ini or via CI build flags.
    #ifdef DEFAULT_SUPABASE_URL
    return DEFAULT_SUPABASE_URL;
    #else
    // No fallback if not defined - device must configure via web UI
    return "";
    #endif
}

bool BridgeDiscovery::needsRefresh() const {
    if (!config.valid) {
        return true;
    }

    unsigned long elapsed = millis() - config.fetched_at;
    return elapsed >= BRIDGE_CONFIG_REFRESH_INTERVAL;
}
