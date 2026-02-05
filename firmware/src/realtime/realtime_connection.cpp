/**
 * @file realtime_connection.cpp
 * @brief Realtime connection setup and initialization
 */

#include "realtime_manager.h"
#include "../app_state.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../config/config_manager.h"
#include "../common/pairing_manager.h"
#include "../core/dependencies.h"
#include <ArduinoJson.h>

namespace {
constexpr int REALTIME_SUBSCRIPTION_MODE = 0;  // 0=all tables, 1=commands only, 2=pairings only, 3=broadcast
constexpr unsigned long INIT_RETRY_INTERVAL = 15000;  // 15 seconds
}  // namespace

// handleRealtimeMessage is declared in realtime_manager.h and defined in realtime_handlers.cpp

bool RealtimeManager::attemptInit() {
    auto& deps = getDependencies();
    static unsigned long last_realtime_error_log = 0;

    // Validate preconditions
    String anonKey = deps.config.getSupabaseAnonKey();

    // Skip if anon key not configured
    if (anonKey.isEmpty()) {
        deps.app_state.realtime_error = "anon_key_missing";
        deps.app_state.last_realtime_error = millis();
        return false;
    }

    if (!deps.app_state.time_synced) {
        deps.app_state.realtime_error = "time_not_synced";
        deps.app_state.last_realtime_error = millis();
        return false;
    }

    const uint32_t min_heap = deps.realtime.minHeapRequired();
    if (ESP.getFreeHeap() < min_heap) {
        deps.app_state.realtime_error = "low_heap";
        deps.app_state.last_realtime_error = millis();
        return false;
    }

    String supabaseUrl = deps.config.getSupabaseUrl();
    String accessToken = deps.supabase.getAccessToken();

    if (supabaseUrl.isEmpty() || accessToken.isEmpty()) {
        deps.app_state.realtime_error = "missing_url_or_token";
        deps.app_state.last_realtime_error = millis();
        return false;
    }

    // Setup connection
    Serial.println("[REALTIME] Initializing Phase B realtime connection...");

    // Set message handler
    deps.realtime.setMessageHandler(handleRealtimeMessage);

    // Initialize WebSocket connection
    deps.realtime.begin(supabaseUrl, anonKey, accessToken);

    // Subscribe to channels
    // Phase 3: Prefer user channel if user_uuid is available, otherwise fall back to pairing-based subscription
    String userUuid = deps.config.getUserUuid();
    bool queued = false;
    
    if (!userUuid.isEmpty()) {
        // UUID-based device identity: Subscribe to user channel
        Serial.printf("[REALTIME] User UUID available - subscribing to user channel: %s\n", userUuid.substring(0, 8).c_str());
        queued = deps.realtime.subscribeToUserChannel(userUuid);
    } else {
        // Legacy pairing-based subscription
        String pairingCode = deps.pairing.getCode();
        if (pairingCode.isEmpty()) {
            Serial.println("[REALTIME] No pairing code and no user_uuid - cannot subscribe");
            return false;
        }

        String filter = "pairing_code=eq." + pairingCode;
        Serial.printf("[REALTIME] Subscribing mode=%d (pairing-based)\n", REALTIME_SUBSCRIPTION_MODE);

        if (REALTIME_SUBSCRIPTION_MODE == 3) {
            // Broadcast mode
            String channelTopic = "realtime:pairing:" + pairingCode + ":events";
            deps.realtime.setChannelTopic(channelTopic);
            queued = deps.realtime.subscribeBroadcast();
        } else if (REALTIME_SUBSCRIPTION_MODE == 1) {
            // Commands only
            deps.realtime.setChannelTopic("realtime:display");
            const String tables[] = { "commands" };
            queued = deps.realtime.subscribeMultiple("display", tables, 1, filter);
        } else if (REALTIME_SUBSCRIPTION_MODE == 2) {
            // Pairings only
            deps.realtime.setChannelTopic("realtime:display");
            const String tables[] = { "pairings" };
            queued = deps.realtime.subscribeMultiple("display", tables, 1, filter);
        } else {
            // All tables (default)
            deps.realtime.setChannelTopic("realtime:display");
            const String tables[] = { "commands", "pairings", "devices" };
            queued = deps.realtime.subscribeMultiple("display", tables, 3, filter);
        }
    }

    if (queued) {
        Serial.println("[REALTIME] Subscription requested");
        deps.app_state.realtime_error = "";
        return true;
    }

    Serial.println("[REALTIME] Connection timeout - will retry");
    deps.app_state.realtime_error = "connection_timeout";
    deps.app_state.last_realtime_error = millis();

    unsigned long now = millis();
    if (now - last_realtime_error_log > 600000) {  // 10 minutes
        last_realtime_error_log = now;
        JsonDocument meta;
        meta["reason"] = "connection_timeout";
        meta["heap"] = ESP.getFreeHeap();
        meta["time"] = (unsigned long)time(nullptr);
        String metaStr;
        serializeJson(meta, metaStr);
        deps.supabase.insertDeviceLog("warn", "realtime_connect_failed", metaStr);
    }

    return deps.realtime.isSocketConnected();
}
