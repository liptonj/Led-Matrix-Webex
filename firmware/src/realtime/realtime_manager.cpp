/**
 * @file realtime_manager.cpp
 * @brief Realtime Manager Implementation
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

// Forward declarations for message handlers (defined in main.cpp)
extern void handleRealtimeMessage(const RealtimeMessage& msg);

// Global instance
RealtimeManager realtimeManager;

namespace {
constexpr int REALTIME_SUBSCRIPTION_MODE = 0;  // 0=all tables, 1=commands only, 2=pairings only, 3=broadcast
constexpr unsigned long INIT_RETRY_INTERVAL = 15000;  // 15 seconds
constexpr unsigned long WATCHDOG_INTERVAL = 30000;    // 30 seconds
}  // namespace

RealtimeManager::RealtimeManager()
    : _initialized(false), _lastInitAttempt(0), _lastSubscribedTime(0),
      _lastWatchdogLog(0), _watchdogInit(false) {
}

RealtimeManager::~RealtimeManager() {
}

void RealtimeManager::begin() {
    _initialized = false;
    _lastInitAttempt = 0;
    _lastSubscribedTime = 0;
    _lastWatchdogLog = 0;
    _watchdogInit = false;
}

void RealtimeManager::loop(unsigned long current_time) {
    // Process realtime events if socket is connected
    if (app_state.wifi_connected && supabaseRealtime.isSocketConnected()) {
        supabaseRealtime.loop();
    }

    // Watchdog: log if not subscribed for too long
    if (!_watchdogInit) {
        _watchdogInit = true;
        _lastSubscribedTime = current_time;
    }

    // Update watchdog timer if socket is connected (not just subscribed)
    // This prevents false positives when messages are flowing but subscription flag is unclear
    if (supabaseRealtime.isSocketConnected()) {
        _lastSubscribedTime = current_time;
    } else if (app_state.wifi_connected && app_state.supabase_connected) {
        if (current_time - _lastSubscribedTime > 60000UL &&
            current_time - _lastWatchdogLog > WATCHDOG_INTERVAL) {
            _lastWatchdogLog = current_time;
            Serial.println("[REALTIME] Watchdog: socket disconnected for 60s");
        }
    }

    // Auto-reconnect if needed
    if (app_state.wifi_connected && app_state.supabase_connected &&
        !supabaseRealtime.isSocketConnected() &&
        !supabaseRealtime.isConnecting()) {

        if (current_time < app_state.realtime_defer_until) {
            return;  // Deferred
        }

        unsigned long interval = supabaseRealtime.hasEverConnected() ? 60000UL : INIT_RETRY_INTERVAL;
        if (current_time - _lastInitAttempt > interval) {
            if (!supabaseClient.isRequestInFlight()) {
                _lastInitAttempt = current_time;
                Serial.println("[REALTIME] Attempting to reconnect...");
                initConnection();
            }
        }
    }
}

bool RealtimeManager::isConnected() const {
    return supabaseRealtime.isConnected();
}

void RealtimeManager::reconnect() {
    supabaseRealtime.disconnect();
    _lastInitAttempt = 0;
}

bool RealtimeManager::initConnection() {
    return attemptInit();
}

bool RealtimeManager::attemptInit() {
    static unsigned long last_realtime_error_log = 0;

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

    Serial.println("[REALTIME] Initializing Phase B realtime connection...");

    // Set message handler
    supabaseRealtime.setMessageHandler(handleRealtimeMessage);

    // Initialize WebSocket connection
    supabaseRealtime.begin(supabaseUrl, anonKey, accessToken);

    // Subscribe based on mode
    String pairingCode = pairing_manager.getCode();
    if (pairingCode.isEmpty()) {
        Serial.println("[REALTIME] No pairing code - cannot subscribe");
        return false;
    }

    String filter = "pairing_code=eq." + pairingCode;
    Serial.printf("[REALTIME] Subscribing mode=%d pairing=%s\n",
                  REALTIME_SUBSCRIPTION_MODE, pairingCode.c_str());

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
        Serial.printf("[REALTIME] Subscription requested for pairing code: %s\n",
                      pairingCode.c_str());
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
