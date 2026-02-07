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
    
    Serial.println();
    Serial.println("=== WEBEX STATUS DISPLAY ===");
    Serial.printf("Hardware: %s | Board: %s\n",
                  getChipDescription().c_str(),
                  getBoardType().c_str());
    Serial.printf("IP: %s | mDNS: %s.local\n",
                  WiFi.localIP().toString().c_str(),
                  ctx.mdns_manager->getHostname().c_str());
    Serial.printf("Status: %s (via %s) | MQTT: %s\n",
                  ctx.app_state->webex_status.c_str(),
                  status_source,
                  ctx.app_state->mqtt_connected ? "Yes" : "No");
    Serial.printf("Supabase: %s | App: %s | Webex Source: %s\n",
                  ctx.app_state->supabase_connected ? "Yes" : "No",
                  ctx.app_state->embedded_app_connected ? "Yes" : "No",
                  status_source);
    Serial.printf("User: %s\n", has_user ? "Yes" : "No");
    if (!pairing_code.isEmpty()) {
        Serial.printf("PAIRING CODE: %s\n", pairing_code.c_str());
    }
    Serial.println("============================");
}

#endif // !NATIVE_BUILD
