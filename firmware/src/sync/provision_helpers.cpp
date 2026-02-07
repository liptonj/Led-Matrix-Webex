/**
 * @file provision_helpers.cpp
 * @brief Provisioning helper functions implementation
 */

#include "provision_helpers.h"
#include "../core/dependencies.h"
#include "../app_state.h"
#include "../supabase/supabase_client.h"
#include "../auth/device_credentials.h"
#include "../common/pairing_manager.h"
#include "../config/config_manager.h"
#include "../display/matrix_display.h"
#include "../serial/serial_commands.h"
#include "../debug/log_system.h"
#ifndef NATIVE_BUILD
#include <WiFi.h>
#endif
#include <ArduinoJson.h>

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

static const char* TAG = "PROVISION";

// Static state variables in anonymous namespace
namespace {
    unsigned long pairing_start_time = 0;
    unsigned long last_countdown_log = 0;
    unsigned long last_approval_log = 0;
    constexpr unsigned long PAIRING_TIMEOUT_MS = 240000;  // 4 minutes
    constexpr unsigned long COUNTDOWN_LOG_INTERVAL_MS = 10000;  // 10 seconds
    constexpr unsigned long APPROVAL_LOG_INTERVAL_MS = 60000;  // 60 seconds
}

namespace ProvisionHelpers {

bool shouldAttemptProvision() {
    auto& deps = getDependencies();
    
    if (!deps.app_state.wifi_connected) {
        return false;
    }
    
    if (!deps.supabase.isInitialized()) {
        return false;
    }
    
    if (!deps.app_state.time_synced) {
        return false;
    }
    
    if (!deps.credentials.isProvisioned()) {
        return false;
    }
    
    if (deps.app_state.supabase_disabled || 
        deps.app_state.supabase_blacklisted || 
        deps.app_state.supabase_deleted) {
        return false;
    }
    
    String supabase_url = deps.config.getSupabaseUrl();
    supabase_url.trim();
    if (supabase_url.isEmpty()) {
        return false;
    }
    
    return true;
}

String buildProvisionPayload() {
    auto& deps = getDependencies();
    
    JsonDocument payload;
    payload["serial_number"] = deps.credentials.getSerialNumber();
    payload["key_hash"] = deps.credentials.getKeyHash();
    payload["firmware_version"] = FIRMWARE_VERSION;
    
#ifndef NATIVE_BUILD
    if (WiFi.isConnected()) {
        payload["ip_address"] = WiFi.localIP().toString();
    }
#endif
    
    String existing_code = deps.pairing.getCode();
    if (!existing_code.isEmpty()) {
        payload["existing_pairing_code"] = existing_code;
    }
    
    // Include provision token if available (single-use)
    String token = get_provision_token();
    if (token.length() > 0) {
        payload["provision_token"] = token;
        ESP_LOGI(TAG, "Including provision token in payload (length: %d)", token.length());
        clear_provision_token();  // Clear after use to ensure single-use
    }
    
    String body;
    body.reserve(256);
    serializeJson(payload, body);
    return body;
}

bool displayPairingCodeWithTimeout(const String& pairingCode, unsigned long startTime) {
    auto& deps = getDependencies();
    unsigned long now = millis();
    unsigned long elapsed = now - startTime;
    
    if (elapsed >= PAIRING_TIMEOUT_MS) {
        return true;  // Timeout exceeded
    }
    
    unsigned long remaining = (PAIRING_TIMEOUT_MS - elapsed) / 1000;
    deps.display.showPairingCode(pairingCode);
    
    if (now - last_countdown_log >= COUNTDOWN_LOG_INTERVAL_MS) {
        last_countdown_log = now;
        ESP_LOGI(TAG, "Pairing code: %s (expires in %lu seconds)", 
                 pairingCode.c_str(), remaining);
    }
    
    return false;  // Still within timeout
}

int handleAwaitingApproval(const String& response) {
    auto& deps = getDependencies();
    unsigned long now = millis();
    
    // Try to extract pairing code from JSON response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    String pairing_code = "";
    if (!error) {
        pairing_code = doc["pairing_code"] | "";
    }
    
    // If pairing code exists, display it with timeout
    if (!pairing_code.isEmpty()) {
        deps.pairing.setCode(pairing_code, true);
        deps.supabase.setPairingCode(pairing_code);
        if (pairing_start_time == 0) {
            pairing_start_time = now;
        }
        
        if (displayPairingCodeWithTimeout(pairing_code, pairing_start_time)) {
            pairing_start_time = 0;
            return 1;  // Timeout expired
        }
    } else {
        // No pairing code - display provisioning status with serial number
        if (now - last_approval_log >= APPROVAL_LOG_INTERVAL_MS) {
            last_approval_log = now;
            ESP_LOGI(TAG, "Device awaiting user approval");
            ESP_LOGI(TAG, "Serial: %s", 
                     deps.credentials.getSerialNumber().c_str());
            deps.display.displayProvisioningStatus(deps.credentials.getSerialNumber());
        }
    }
    
    deps.app_state.supabase_approval_pending = true;
    return 0;  // Keep trying
}

void resetProvisionState() {
    pairing_start_time = 0;
    last_countdown_log = 0;
    last_approval_log = 0;
}

}  // namespace ProvisionHelpers
