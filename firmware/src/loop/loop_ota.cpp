/**
 * @file loop_ota.cpp
 * @brief OTA update handlers
 *
 * Handles firmware update checks and installation.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include "ota/ota_manager.h"
#include "config/config_manager.h"
#include "display/matrix_display.h"
#include "supabase/supabase_realtime.h"
#include "debug/remote_logger.h"

// External globals from main.cpp
extern OTAManager ota_manager;
extern ConfigManager config_manager;
extern MatrixDisplay matrix_display;
extern AppState app_state;

// Forward declaration
extern SupabaseRealtime supabaseRealtime;

// =============================================================================
// OTA CHECK HANDLER
// =============================================================================

/**
 * @brief Check for firmware updates and perform auto-update if enabled
 */
void check_for_updates() {
    Serial.println("[OTA] Checking for updates...");
    bool realtime_was_active = supabaseRealtime.isConnected() || supabaseRealtime.isConnecting();
    if (realtime_was_active) {
        Serial.println("[OTA] Pausing realtime during OTA check");
        supabaseRealtime.disconnect();
    }
    // Defer realtime for check phase - will extend if update starts
    app_state.realtime_defer_until = millis() + 30000UL;

    if (ota_manager.checkForUpdate()) {
        String new_version = ota_manager.getLatestVersion();
        Serial.printf("[OTA] Update available: %s\n", new_version.c_str());

        if (config_manager.getAutoUpdate()) {
            // Check if this version previously failed - skip to avoid retry loop
            String failed_version = config_manager.getFailedOTAVersion();
            if (!failed_version.isEmpty() && failed_version == new_version) {
                Serial.printf("[OTA] Skipping auto-update - version %s previously failed\n",
                              new_version.c_str());
                return;
            }

            Serial.println("[OTA] Auto-update enabled, installing...");
            matrix_display.showUpdating(new_version);

            // Disconnect realtime and defer for 10 minutes to cover the entire download
            // This is critical to free memory and prevent network contention during OTA
            if (supabaseRealtime.isConnected() || supabaseRealtime.isConnecting()) {
                Serial.println("[OTA] Disconnecting realtime for update");
                supabaseRealtime.disconnect();
            }
            app_state.realtime_defer_until = millis() + 600000UL;  // 10 minutes

            if (ota_manager.performUpdate()) {
                Serial.println("[OTA] Update successful, rebooting...");
                config_manager.clearFailedOTAVersion();
                ESP.restart();
            } else {
                Serial.println("[OTA] Update failed!");
                RLOG_ERROR("loop", "OTA update failed");
                matrix_display.unlockFromOTA();  // Unlock display on failure
                // Record this version as failed to prevent retry loop
                config_manager.setFailedOTAVersion(new_version);
                Serial.printf("[OTA] Marked version %s as failed - will not auto-retry\n",
                              new_version.c_str());
            }
        }
    } else {
        Serial.println("[OTA] No updates available.");
    }

    if (realtime_was_active) {
        app_state.supabase_realtime_resubscribe = true;
    }
}

void handleOTACheck(LoopContext& ctx) {
    // Check for OTA updates (hourly)
    if (ctx.current_time - ctx.app_state->last_ota_check >= 3600000UL) {
        ctx.app_state->last_ota_check = ctx.current_time;
        check_for_updates();
    }
}

#endif // !NATIVE_BUILD
