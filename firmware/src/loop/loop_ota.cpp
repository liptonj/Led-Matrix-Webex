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
#include "../debug/log_system.h"
#include "../core/dependencies.h"

static const char* TAG = "OTA_LOOP";

// =============================================================================
// OTA CHECK HANDLER
// =============================================================================

/**
 * @brief Check for firmware updates and perform auto-update if enabled
 */
void check_for_updates() {
    auto& deps = getDependencies();
    ESP_LOGI(TAG, "Checking for updates...");
    bool realtime_was_active = deps.realtime.isConnected() || deps.realtime.isConnecting();
    if (realtime_was_active) {
        ESP_LOGI(TAG, "Pausing realtime during OTA check");
        deps.realtime.disconnect();
    }
    // Defer realtime for check phase - will extend if update starts
    deps.app_state.realtime_defer_until = millis() + 30000UL;

    if (deps.ota.checkForUpdate()) {
        String new_version = deps.ota.getLatestVersion();
        ESP_LOGI(TAG, "Update available: %s", new_version.c_str());

        if (deps.config.getAutoUpdate()) {
            // Check if this version previously failed - skip to avoid retry loop
            String failed_version = deps.config.getFailedOTAVersion();
            if (!failed_version.isEmpty() && failed_version == new_version) {
                ESP_LOGW(TAG, "Skipping auto-update - version %s previously failed",
                         new_version.c_str());
                return;
            }

            ESP_LOGI(TAG, "Auto-update enabled, installing...");
            deps.display.showUpdating(new_version);

            // Disconnect realtime and defer for 10 minutes to cover the entire download
            // This is critical to free memory and prevent network contention during OTA
            if (deps.realtime.isConnected() || deps.realtime.isConnecting()) {
                ESP_LOGI(TAG, "Disconnecting realtime for update");
                deps.realtime.disconnect();
            }
            deps.app_state.realtime_defer_until = millis() + 600000UL;  // 10 minutes

            if (deps.ota.performUpdate()) {
                ESP_LOGI(TAG, "Update successful, rebooting...");
                deps.config.clearFailedOTAVersion();
                ESP.restart();
            } else {
                ESP_LOGE(TAG, "OTA update failed");
                deps.display.unlockFromOTA();  // Unlock display on failure
                // Record this version as failed to prevent retry loop
                deps.config.setFailedOTAVersion(new_version);
                ESP_LOGW(TAG, "Marked version %s as failed - will not auto-retry",
                         new_version.c_str());
            }
        }
    } else {
        ESP_LOGI(TAG, "No updates available.");
    }

    if (realtime_was_active) {
        deps.app_state.supabase_realtime_resubscribe = true;
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
