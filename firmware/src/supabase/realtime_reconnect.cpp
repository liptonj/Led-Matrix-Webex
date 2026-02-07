/**
 * @file realtime_reconnect.cpp
 * @brief Reconnection Logic for Supabase Realtime
 *
 * Handles reconnection attempts with exponential backoff and connection health monitoring.
 * See supabase_realtime.cpp for WebSocket connection management.
 * See phoenix_protocol.cpp for Phoenix Channels protocol handling.
 */

#include "supabase_realtime.h"
#include "../core/dependencies.h"
#include "../app_state.h"
#include "../debug/log_system.h"

static const char* TAG = "REALTIME";

namespace {
constexpr uint32_t REALTIME_LOW_HEAP_LOG_MS = 30000;
}  // namespace

void SupabaseRealtime::attemptReconnect() {
    auto& deps = getDependencies();
    unsigned long now = millis();
    if (now < deps.app_state.realtime_defer_until) {
        return;
    }
    _lastReconnectAttempt = now;
    
    // Exponential backoff
    _reconnectDelay = min(_reconnectDelay * 2, (unsigned long)PHOENIX_RECONNECT_MAX_MS);
    
    if (_supabaseUrl.isEmpty()) {
        return;
    }
    
    ESP_LOGI(TAG, "Reconnecting (next attempt in %lu ms)...", _reconnectDelay);
    uint32_t minHeap = minHeapRequired();
    if (ESP.getFreeHeap() < minHeap) {
        unsigned long now = millis();
        if (now - _lowHeapLogAt > REALTIME_LOW_HEAP_LOG_MS) {
            _lowHeapLogAt = now;
            ESP_LOGW(TAG, "Skipping reconnect - low heap (%lu < %lu)",
                     ESP.getFreeHeap(), (unsigned long)minHeap);
        }
        return;
    }
    
    disconnect();
    begin(_supabaseUrl, _anonKey, _accessToken);
}

uint32_t SupabaseRealtime::minHeapRequired() const {
    uint32_t required = _hasConnected ? _minHeapSteady : _minHeapFirstConnect;
    if (required < _minHeapFloor) {
        required = _minHeapFloor;
    }
    return required;
}
