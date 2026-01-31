/**
 * @file sync_manager.cpp
 * @brief Sync Manager Implementation
 */

#include "sync_manager.h"
#include "../app_state.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../config/config_manager.h"
#include "../auth/device_credentials.h"
#include <WiFi.h>
#include <esp_heap_caps.h>

extern AppState app_state;
extern ConfigManager config_manager;
extern SupabaseClient supabaseClient;
extern SupabaseRealtime supabaseRealtime;
extern DeviceCredentials deviceCredentials;

// Global instance
SyncManager syncManager;

// Forward declaration for command handler (defined in command_processor)
extern void handleSupabaseCommand(const SupabaseCommand& cmd);

namespace {
constexpr unsigned long HEARTBEAT_INTERVAL = 30000;  // 30 seconds
constexpr unsigned long SYNC_INTERVAL = 300000;      // 5 minutes

bool hasSafeTlsHeap(uint32_t min_free, uint32_t min_block) {
    return ESP.getFreeHeap() >= min_free &&
           heap_caps_get_largest_free_block(MALLOC_CAP_8BIT) >= min_block;
}
}  // namespace

SyncManager::SyncManager()
    : _lastHeartbeat(0), _lastFullSync(0), _lastRealtimeSocketSeen(0) {
}

SyncManager::~SyncManager() {
}

void SyncManager::begin() {
    _lastHeartbeat = 0;
    _lastFullSync = 0;
    _lastRealtimeSocketSeen = 0;
}

void SyncManager::loop(unsigned long current_time) {
    if (!app_state.wifi_connected || !supabaseClient.isAuthenticated()) {
        return;
    }

    const bool commandsSocketActive = supabaseRealtime.isSocketConnected();
    const bool commandsConnecting = supabaseRealtime.isConnecting();
    const bool realtime_connecting = commandsConnecting;

    if (commandsSocketActive) {
        _lastRealtimeSocketSeen = current_time;
    }

    const bool commandsRealtimeEnabled = !config_manager.getSupabaseAnonKey().isEmpty();
    const bool realtimeWorking = commandsRealtimeEnabled && commandsSocketActive;
    const bool realtimeStale = commandsRealtimeEnabled &&
                               (_lastRealtimeSocketSeen > 0) &&
                               (current_time - _lastRealtimeSocketSeen > 120000UL);

    // Determine sync intervals
    bool isHeartbeat = false;
    bool shouldSync = false;

    if (realtimeWorking) {
        // Realtime active: heartbeat every 30s, full sync every 5min
        if (current_time - _lastHeartbeat >= HEARTBEAT_INTERVAL) {
            isHeartbeat = true;
            shouldSync = true;
        }
        if (current_time - _lastFullSync >= SYNC_INTERVAL) {
            isHeartbeat = false;
            shouldSync = true;
        }
    } else if (realtimeStale) {
        // Realtime stale: poll every 15s
        if (current_time - _lastHeartbeat >= 15000UL) {
            isHeartbeat = false;
            shouldSync = true;
        }
    } else {
        // No realtime: poll every 10s
        if (current_time - _lastHeartbeat >= 10000UL) {
            isHeartbeat = false;
            shouldSync = true;
        }
    }

    if (!shouldSync) {
        return;
    }

    // Skip if realtime is connecting or heap is low
    if (realtime_connecting || !hasSafeTlsHeap(65000, 40000)) {
        return;
    }

    performSync(isHeartbeat);

    if (isHeartbeat) {
        _lastHeartbeat = current_time;
    } else {
        _lastHeartbeat = current_time;
        _lastFullSync = current_time;
    }

    // Poll for commands if not using realtime
    if (!realtimeWorking) {
        pollCommands();
    }
}

void SyncManager::forceSyncNow() {
    _lastHeartbeat = 0;
    _lastFullSync = 0;
}

bool SyncManager::isSyncDue(unsigned long current_time) const {
    return (current_time - _lastHeartbeat >= HEARTBEAT_INTERVAL);
}

void SyncManager::performSync(bool isHeartbeat) {
    if (!supabaseClient.isAuthenticated()) {
        return;
    }

    int rssi = WiFi.RSSI();
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t uptime = millis() / 1000;
    #ifndef FIRMWARE_VERSION
    #define FIRMWARE_VERSION "0.0.0-dev"
    #endif
    String firmwareVersion = FIRMWARE_VERSION;

    SupabaseAppState appState = supabaseClient.postDeviceState(
        rssi, freeHeap, uptime, firmwareVersion, 0);

    if (appState.valid) {
        app_state.last_supabase_sync = millis();

        if (appState.app_connected) {
            app_state.supabase_app_connected = true;
            app_state.webex_status = appState.webex_status;
            app_state.webex_status_received = true;
            if (!appState.display_name.isEmpty()) {
                app_state.embedded_app_display_name = appState.display_name;
            }
            app_state.camera_on = appState.camera_on;
            app_state.mic_muted = appState.mic_muted;
            app_state.in_call = appState.in_call;
        } else {
            app_state.supabase_app_connected = false;
        }
    }
}

void SyncManager::pollCommands() {
    const int MAX_COMMANDS = 10;
    SupabaseCommand commands[MAX_COMMANDS];

    int count = supabaseClient.pollCommands(commands, MAX_COMMANDS);

    for (int i = 0; i < count; i++) {
        if (commands[i].valid) {
            handleSupabaseCommand(commands[i]);
        }
    }
}
