/**
 * @file realtime_reconnect.cpp
 * @brief Reconnection Logic for Supabase Realtime
 *
 * Handles reconnection attempts with exponential backoff and connection health monitoring.
 * See supabase_realtime.cpp for WebSocket connection management.
 * See phoenix_protocol.cpp for Phoenix Channels protocol handling.
 */

#include "supabase_realtime.h"

namespace {
constexpr uint32_t REALTIME_LOW_HEAP_LOG_MS = 30000;
}  // namespace

void SupabaseRealtime::attemptReconnect() {
    _lastReconnectAttempt = millis();
    
    // Exponential backoff
    _reconnectDelay = min(_reconnectDelay * 2, (unsigned long)PHOENIX_RECONNECT_MAX_MS);
    
    if (_supabaseUrl.isEmpty()) {
        return;
    }
    
    Serial.printf("[REALTIME] Reconnecting (next attempt in %lu ms)...\n", _reconnectDelay);
    uint32_t minHeap = minHeapRequired();
    if (ESP.getFreeHeap() < minHeap) {
        unsigned long now = millis();
        if (now - _lowHeapLogAt > REALTIME_LOW_HEAP_LOG_MS) {
            _lowHeapLogAt = now;
            Serial.printf("[REALTIME] Skipping reconnect - low heap (%lu < %lu)\n",
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
