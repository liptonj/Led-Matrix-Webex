/**
 * @file loop_diagnostics.cpp
 * @brief Diagnostics handlers
 *
 * Handles connection status logging and diagnostic output.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include <WiFi.h>
#include "discovery/mdns_manager.h"
#include "common/pairing_manager.h"
#include "common/board_utils.h"
#include "config/config_manager.h"
#include "../debug/log_system.h"

static const char* TAG = "DIAG";

// =============================================================================
// CONNECTION STATUS LOGGING HANDLER
// =============================================================================

void handleConnectionStatusLogging(LoopContext& ctx) {
    // Print connection info every 15 seconds (visible on serial connect)
    static unsigned long last_connection_print = 0;
    if (ctx.current_time - last_connection_print < 15000) {
        return;
    }
    last_connection_print = ctx.current_time;

    if (!ctx.app_state->wifi_connected) {
        return;
    }

    // Determine status source for logging
    const char* status_source = ctx.app_state->webex_status_source.isEmpty()
        ? (ctx.app_state->embedded_app_connected ? "embedded_app" : "unknown")
        : ctx.app_state->webex_status_source.c_str();

    // Get pairing code for display
    String pairing_code = ctx.pairing_manager ? ctx.pairing_manager->getCode() : "";
    
    // Get user UUID for association check
    String user_uuid = ctx.config_manager ? ctx.config_manager->getUserUuid() : "";
    bool has_user = !user_uuid.isEmpty();
    
    ESP_LOGI(TAG, "");
    ESP_LOGI(TAG, "=== WEBEX STATUS DISPLAY ===");
    ESP_LOGI(TAG, "Hardware: %s | Board: %s",
             getChipDescription().c_str(),
             getBoardType().c_str());
    ESP_LOGI(TAG, "IP: %s | mDNS: %s.local",
             WiFi.localIP().toString().c_str(),
             ctx.mdns_manager->getHostname().c_str());
    ESP_LOGI(TAG, "Status: %s (via %s) | MQTT: %s",
             ctx.app_state->webex_status.c_str(),
             status_source,
             ctx.app_state->mqtt_connected ? "Yes" : "No");
    ESP_LOGI(TAG, "Supabase: %s | App: %s | Webex Source: %s",
             ctx.app_state->supabase_connected ? "Yes" : "No",
             ctx.app_state->embedded_app_connected ? "Yes" : "No",
             status_source);
    ESP_LOGI(TAG, "User: %s", has_user ? "Yes" : "No");
    if (!pairing_code.isEmpty()) {
        ESP_LOGI(TAG, "PAIRING CODE: %s", pairing_code.c_str());
    }
    ESP_LOGI(TAG, "============================");
}

#endif // !NATIVE_BUILD
