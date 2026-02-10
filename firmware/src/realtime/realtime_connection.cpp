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
#include "../debug/log_system.h"
#include <ArduinoJson.h>

static const char* TAG = "RT_CONN";

namespace {
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
        ESP_LOGW(TAG, "Init blocked: anon_key_missing");
        return false;
    }

    if (!deps.app_state.time_synced) {
        deps.app_state.realtime_error = "time_not_synced";
        deps.app_state.last_realtime_error = millis();
        ESP_LOGW(TAG, "Init blocked: time_not_synced");
        return false;
    }

    const uint32_t min_heap = deps.realtime.minHeapRequired();
    if (ESP.getFreeHeap() < min_heap) {
        deps.app_state.realtime_error = "low_heap";
        deps.app_state.last_realtime_error = millis();
        ESP_LOGW(TAG, "Init blocked: low_heap (free=%lu, need=%lu)",
                 ESP.getFreeHeap(), (unsigned long)min_heap);
        return false;
    }

    String supabaseUrl = deps.config.getSupabaseUrl();
    String accessToken = deps.supabase.getAccessToken();

    if (supabaseUrl.isEmpty() || accessToken.isEmpty()) {
        deps.app_state.realtime_error = "missing_url_or_token";
        deps.app_state.last_realtime_error = millis();
        ESP_LOGW(TAG, "Init blocked: missing_url_or_token");
        return false;
    }

    // Setup connection
    ESP_LOGI(TAG, "Initializing Phase B realtime connection...");

    // Set message handler
    deps.realtime.setMessageHandler(handleRealtimeMessage);

    // Initialize WebSocket connection
    deps.realtime.begin(supabaseUrl, anonKey, accessToken);

    // Subscribe to channels using UUID-based identity
    // Device UUID comes from ConfigManager (set during device-auth response)
    String userUuid = deps.config.getUserUuid();
    String deviceUuid = deps.config.getDeviceUuid();
    bool queued = false;
    
    // User channel subscription (required for pairing and status updates)
    if (!userUuid.isEmpty()) {
        queued = deps.realtime.subscribeToUserChannel(userUuid);
        if (!queued) {
            ESP_LOGW(TAG, "Failed to subscribe to user channel");
            deps.app_state.realtime_error = "user_channel_subscribe_failed";
            deps.app_state.last_realtime_error = millis();
            return false;
        }
    } else {
        ESP_LOGW(TAG, "No user_uuid -- deferred until paired via post-device-state");
        ESP_LOGW(TAG, "Init blocked: no user_uuid");
        return false;
    }
    
    // Device channel subscription (UUID-based: device:{device_uuid})
    // Topic format: realtime:device:{device_uuid} (Phoenix protocol)
    // RLS topic: device:{device_uuid} (used by backend for routing)
    // Used for device-specific events: commands, firmware updates, heartbeats
    if (!deviceUuid.isEmpty()) {
        bool deviceQueued = deps.realtime.subscribeToDeviceChannel(deviceUuid);
        if (!deviceQueued) {
            ESP_LOGW(TAG, "Failed to subscribe to device channel (non-fatal)");
            // Continue anyway - user channel is more important
        } else {
            ESP_LOGI(TAG, "Device channel subscription requested (device_uuid: %s)", 
                     deviceUuid.substring(0, 8).c_str());
        }
    } else {
        ESP_LOGD(TAG, "No device_uuid - skipping device channel subscription");
    }

    if (queued) {
        ESP_LOGI(TAG, "Subscription requested (user channel)");
        deps.app_state.realtime_error = "";
        return true;
    }

    ESP_LOGW(TAG, "Connection timeout - will retry");
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

    return deps.realtime.isConnected();
}
