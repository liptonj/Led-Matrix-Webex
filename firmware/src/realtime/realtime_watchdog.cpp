/**
 * @file realtime_watchdog.cpp
 * @brief Realtime connection health monitoring and watchdog
 */

#include "realtime_watchdog.h"
#include "../app_state.h"
#include "../supabase/supabase_realtime.h"
#include "../supabase/supabase_client.h"
#include "../core/dependencies.h"
#include "../debug/log_system.h"

static const char* TAG = "RT_WDG";

namespace {
constexpr unsigned long WATCHDOG_INTERVAL = 30000;    // 30 seconds
constexpr unsigned long RECONNECT_INTERVAL = 60000;   // 60 seconds (after first connection)
constexpr unsigned long INIT_RETRY_INTERVAL = 15000;   // 15 seconds (before first connection)
}  // namespace

/**
 * @brief Check if reconnection is needed and attempt it
 * @param current_time Current millis()
 * @param lastInitAttempt Last initialization attempt time
 * @return true if reconnection was attempted
 */
bool checkReconnection(unsigned long current_time, unsigned long& lastInitAttempt) {
    auto& deps = getDependencies();
    
    if (!deps.app_state.wifi_connected || !deps.app_state.supabase_connected) {
        return false;
    }

    // Use isSocketConnected() (not isConnected()) because the subscription
    // confirmation (_subscribed flag) may be delayed due to message queuing.
    // Heartbeat timeout handles actual dead connections; we only need to
    // reconnect when the socket itself is down.
    if (deps.realtime.isSocketConnected() || deps.realtime.isConnecting()) {
        return false;
    }

    if (current_time < deps.app_state.realtime_defer_until) {
        return false;  // Deferred
    }

    unsigned long interval = deps.realtime.hasEverConnected() ? RECONNECT_INTERVAL : INIT_RETRY_INTERVAL;
    if (current_time - lastInitAttempt > interval) {
        if (!deps.supabase.isRequestInFlight()) {
            lastInitAttempt = current_time;
            ESP_LOGW(TAG, "Attempting to reconnect...");
            return true;  // Signal that reconnection should be attempted
        }
    }

    return false;
}

/**
 * @brief Update watchdog timer based on connection state
 * @param current_time Current millis()
 * @param lastSubscribedTime Reference to last subscribed time
 * @param lastWatchdogLog Reference to last watchdog log time
 * @param watchdogInit Reference to watchdog initialization flag
 */
void updateWatchdogTimer(unsigned long current_time,
                        unsigned long& lastSubscribedTime,
                        unsigned long& lastWatchdogLog,
                        bool& watchdogInit) {
    auto& deps = getDependencies();
    
    // Initialize watchdog timer on first call
    if (!watchdogInit) {
        watchdogInit = true;
        lastSubscribedTime = current_time;
    }

    // Update watchdog timer if fully connected (socket + channel subscribed)
    if (deps.realtime.isConnected()) {
        lastSubscribedTime = current_time;
    } else if (deps.app_state.wifi_connected && deps.app_state.supabase_connected) {
        if (current_time - lastSubscribedTime > 60000UL &&
            current_time - lastWatchdogLog > WATCHDOG_INTERVAL) {
            lastWatchdogLog = current_time;
            ESP_LOGW(TAG, "Watchdog: not fully connected for 60s");
        }
    }
}
