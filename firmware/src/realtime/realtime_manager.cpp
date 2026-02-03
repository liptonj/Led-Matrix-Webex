/**
 * @file realtime_manager.cpp
 * @brief Realtime Manager Implementation - Core orchestration
 */

#include "realtime_manager.h"
#include "../app_state.h"
#include "../supabase/supabase_realtime.h"
#include "realtime_watchdog.h"
#include "../core/dependencies.h"

// Global instance
RealtimeManager realtimeManager;

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
    auto& deps = getDependencies();
    
    // Process realtime events if socket is connected
    if (deps.app_state.wifi_connected && deps.realtime.isSocketConnected()) {
        deps.realtime.loop();
    }

    // Update watchdog timer
    updateWatchdogTimer(current_time, _lastSubscribedTime, _lastWatchdogLog, _watchdogInit);

    // Auto-reconnect if needed
    if (checkReconnection(current_time, _lastInitAttempt)) {
        initConnection();
    }
}

bool RealtimeManager::isConnected() const {
    auto& deps = getDependencies();
    return deps.realtime.isConnected();
}

void RealtimeManager::reconnect() {
    auto& deps = getDependencies();
    deps.realtime.disconnect();
    _lastInitAttempt = 0;
}

bool RealtimeManager::initConnection() {
    return attemptInit();
}
