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
#include <ArduinoJson.h>

extern AppState app_state;
extern ConfigManager config_manager;
extern SupabaseClient supabaseClient;
extern SupabaseRealtime supabaseRealtime;
extern PairingManager pairing_manager;

namespace {
constexpr int REALTIME_SUBSCRIPTION_MODE = 0;  // 0=all tables, 1=commands only, 2=pairings only, 3=broadcast
constexpr unsigned long INIT_RETRY_INTERVAL = 15000;  // 15 seconds

// Forward declaration
void handleRealtimeMessage(const RealtimeMessage& msg);
}  // namespace

bool RealtimeManager::attemptInit() {
    static unsigned long last_realtime_error_log = 0;

    // Validate preconditions
    String anonKey = config_manager.getSupabaseAnonKey();

    // Skip if anon key not configured
    if (anonKey.isEmpty()) {
        app_state.realtime_error = "anon_key_missing";
        app_state.last_realtime_error = millis();
        return false;
    }

    if (!app_state.time_synced) {
        app_state.realtime_error = "time_not_synced";
        app_state.last_realtime_error = millis();
        return false;
    }

    const uint32_t min_heap = supabaseRealtime.minHeapRequired();
    if (ESP.getFreeHeap() < min_heap) {
        app_state.realtime_error = "low_heap";
        app_state.last_realtime_error = millis();
        return false;
    }

    String supabaseUrl = config_manager.getSupabaseUrl();
    String accessToken = supabaseClient.getAccessToken();

    if (supabaseUrl.isEmpty() || accessToken.isEmpty()) {
        app_state.realtime_error = "missing_url_or_token";
        app_state.last_realtime_error = millis();
        return false;
    }

    // Setup connection
    Serial.println("[REALTIME] Initializing Phase B realtime connection...");

    // Set message handler
    supabaseRealtime.setMessageHandler(handleRealtimeMessage);

    // Initialize WebSocket connection
    supabaseRealtime.begin(supabaseUrl, anonKey, accessToken);

    // Subscribe to channels
    String pairingCode = pairing_manager.getCode();
    if (pairingCode.isEmpty()) {
        Serial.println("[REALTIME] No pairing code - cannot subscribe");
        return false;
    }

    String filter = "pairing_code=eq." + pairingCode;
    Serial.printf("[REALTIME] Subscribing mode=%d\n", REALTIME_SUBSCRIPTION_MODE);

    bool queued = false;

    if (REALTIME_SUBSCRIPTION_MODE == 3) {
        // Broadcast mode
        String channelTopic = "realtime:pairing:" + pairingCode + ":events";
        supabaseRealtime.setChannelTopic(channelTopic);
        queued = supabaseRealtime.subscribeBroadcast();
    } else if (REALTIME_SUBSCRIPTION_MODE == 1) {
        // Commands only
        supabaseRealtime.setChannelTopic("realtime:display");
        const String tables[] = { "commands" };
        queued = supabaseRealtime.subscribeMultiple("display", tables, 1, filter);
    } else if (REALTIME_SUBSCRIPTION_MODE == 2) {
        // Pairings only
        supabaseRealtime.setChannelTopic("realtime:display");
        const String tables[] = { "pairings" };
        queued = supabaseRealtime.subscribeMultiple("display", tables, 1, filter);
    } else {
        // All tables (default)
        supabaseRealtime.setChannelTopic("realtime:display");
        const String tables[] = { "commands", "pairings", "devices" };
        queued = supabaseRealtime.subscribeMultiple("display", tables, 3, filter);
    }

    if (queued) {
        Serial.println("[REALTIME] Subscription requested");
        app_state.realtime_error = "";
        return true;
    }

    Serial.println("[REALTIME] Connection timeout - will retry");
    app_state.realtime_error = "connection_timeout";
    app_state.last_realtime_error = millis();

    unsigned long now = millis();
    if (now - last_realtime_error_log > 600000) {  // 10 minutes
        last_realtime_error_log = now;
        JsonDocument meta;
        meta["reason"] = "connection_timeout";
        meta["heap"] = ESP.getFreeHeap();
        meta["time"] = (unsigned long)time(nullptr);
        String metaStr;
        serializeJson(meta, metaStr);
        supabaseClient.insertDeviceLog("warn", "realtime_connect_failed", metaStr);
    }

    return supabaseRealtime.isSocketConnected();
}
