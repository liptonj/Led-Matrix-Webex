/**
 * @file loop_webex.cpp
 * @brief Webex integration handlers
 *
 * Handles xAPI WebSocket processing and Webex API fallback polling.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include <ArduinoJson.h>
#include "webex/xapi_websocket.h"
#include "webex/webex_client.h"
#include "supabase/supabase_client.h"
#include "config/config_manager.h"
#include "../debug/log_system.h"
#include "../core/dependencies.h"

static const char* TAG = "WEBEX_LOOP";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Helper function to extract first name from display name
static String extractFirstName(const String& input) {
    String name = input;
    name.trim();
    if (name.isEmpty()) {
        return name;
    }
    int comma = name.indexOf(',');
    if (comma >= 0) {
        String after = name.substring(comma + 1);
        after.trim();
        if (!after.isEmpty()) {
            name = after;
        }
    }
    int space = name.indexOf(' ');
    if (space > 0) {
        name = name.substring(0, space);
    }
    return name;
}

// =============================================================================
// XAPI WEBSOCKET HANDLER
// =============================================================================

void handleXAPIWebSocket(LoopContext& ctx) {
    // Process xAPI WebSocket
    if (ctx.xapi_websocket->isConnected()) {
        ctx.xapi_websocket->loop();

        // Check for device status updates
        if (ctx.xapi_websocket->hasUpdate()) {
            XAPIUpdate update = ctx.xapi_websocket->getUpdate();
            ctx.app_state->camera_on = update.camera_on;
            ctx.app_state->mic_muted = update.mic_muted;
            ctx.app_state->in_call = update.in_call;
            ctx.app_state->xapi_connected = true;
        }
    }
}

// =============================================================================
// WEBEX FALLBACK POLLING HANDLER
// =============================================================================

bool handleWebexFallbackPolling(LoopContext& ctx) {
    auto& deps = getDependencies();
    
    // Poll Webex API as fallback when Supabase/app status is unavailable or stale
    // Conditions for fallback polling:
    // 1. Embedded app not connected, OR
    // 2. Supabase sync is stale (no update in 60+ seconds)
    const unsigned long SUPABASE_STALE_THRESHOLD = 60000UL;  // 60 seconds
    bool supabase_status_stale = (ctx.app_state->last_supabase_sync > 0) &&
                                 (ctx.current_time - ctx.app_state->last_supabase_sync > SUPABASE_STALE_THRESHOLD);
    bool need_api_fallback = !ctx.app_state->embedded_app_connected &&
                             (supabase_status_stale || !ctx.app_state->webex_status_received);

    if (!need_api_fallback || (!deps.supabase.isAuthenticated() && !ctx.app_state->webex_authenticated)) {
        return false;
    }

    unsigned long poll_interval = ctx.config_manager->getWebexPollInterval() * 1000UL;

    if (ctx.current_time - ctx.app_state->last_poll_time < poll_interval) {
        return false;
    }

    ctx.app_state->last_poll_time = ctx.current_time;

    // Log why we're polling (for debugging)
    if (supabase_status_stale) {
        ESP_LOGD(TAG, "Supabase status stale, polling cloud status");
    } else if (!ctx.app_state->embedded_app_connected) {
        ESP_LOGD(TAG, "Embedded app not connected, polling cloud status");
    }

    bool cloud_synced = false;
    String cloud_status;

    if (deps.supabase.isAuthenticated()) {
        if (!hasSafeTlsHeap(65000, 40000)) {
            ESP_LOGW(TAG, "Skipping webex-status - low heap for TLS");
        } else {
            cloud_synced = deps.supabase.syncWebexStatus(cloud_status);
            if (cloud_synced) {
                safeStrCopy(ctx.app_state->webex_status, sizeof(ctx.app_state->webex_status), cloud_status);
                ctx.app_state->webex_status_received = true;
                safeStrCopyLiteral(ctx.app_state->webex_status_source, sizeof(ctx.app_state->webex_status_source), "cloud");
                // Cloud successfully fetched Webex status using server-side OAuth tokens
                // Mark as authenticated so the UI reflects the connection
                if (!ctx.app_state->webex_authenticated) {
                    ctx.app_state->webex_authenticated = true;
                    ESP_LOGI(TAG, "Authenticated via cloud (Supabase OAuth)");
                }
                ESP_LOGI(TAG, "Cloud status: %s", cloud_status.c_str());
            }
        }
    }

    if (!cloud_synced) {
        if (ctx.app_state->embedded_app_connected) {
            return true;
        }
        if (deps.supabase.isWebexTokenMissing() && ctx.app_state->wifi_connected) {
            ESP_LOGD(TAG, "No Webex token; skipping local fallback");
            return true;
        }
        if (!ctx.app_state->webex_authenticated) {
            static unsigned long last_local_skip_log = 0;
            unsigned long now = millis();
            if (now - last_local_skip_log > 60000) {
                last_local_skip_log = now;
                ESP_LOGD(TAG, "Local API auth unavailable; skipping local fallback");
            }
            return true;
        }
        ESP_LOGW(TAG, "Cloud status failed, falling back to local API");
        WebexPresence presence;
        if (ctx.webex_client->getPresence(presence)) {
            safeStrCopy(ctx.app_state->webex_status, sizeof(ctx.app_state->webex_status), presence.status);
            ctx.app_state->webex_status_received = true;
            safeStrCopyLiteral(ctx.app_state->webex_status_source, sizeof(ctx.app_state->webex_status_source), "local");

            // Auto-populate display name with firstName if not already set
            if (ctx.config_manager->getDisplayName().isEmpty() && !presence.first_name.isEmpty()) {
                ctx.config_manager->setDisplayName(presence.first_name);
                ESP_LOGI(TAG, "Auto-populated display name: %s", presence.first_name.c_str());
            }

            // Derive in_call from status if not connected to xAPI
            if (!ctx.app_state->xapi_connected) {
                ctx.app_state->in_call = (presence.status == "meeting" || presence.status == "busy" ||
                                         presence.status == "call" || presence.status == "presenting");
            }

            JsonDocument payload;
            payload["webex_status"] = presence.status;
            if (!presence.display_name.isEmpty()) {
                payload["display_name"] = presence.display_name;
            } else if (!presence.first_name.isEmpty()) {
                payload["display_name"] = presence.first_name;
            }
            payload["camera_on"] = ctx.app_state->camera_on;
            payload["mic_muted"] = ctx.app_state->mic_muted;
            payload["in_call"] = ctx.app_state->in_call;

            String body;
            serializeJson(payload, body);

            String ignored;
            deps.supabase.syncWebexStatus(ignored, body);
        }
    }

    return false;
}

#endif // !NATIVE_BUILD
