/**
 * @file command_processor.cpp
 * @brief Command Processor Implementation
 */

#include "command_processor.h"
#include "../app_state.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../config/config_manager.h"
#include <esp_heap_caps.h>

extern AppState app_state;
extern SupabaseClient supabaseClient;
extern SupabaseRealtime supabaseRealtime;
extern ConfigManager config_manager;

// Global instance
CommandProcessor commandProcessor;

namespace {
bool hasSafeTlsHeap(uint32_t min_free, uint32_t min_block) {
    return ESP.getFreeHeap() >= min_free &&
           heap_caps_get_largest_free_block(MALLOC_CAP_8BIT) >= min_block;
}
}  // namespace

CommandProcessor::CommandProcessor()
    : _recentCommandIndex(0), _pendingAckHead(0), _pendingAckCount(0),
      _pendingAction(PendingCommandAction::None), _pendingActionSince(0),
      _pendingActionLastLog(0) {
}

CommandProcessor::~CommandProcessor() {
}

void CommandProcessor::begin() {
    _recentCommandIndex = 0;
    _pendingAckHead = 0;
    _pendingAckCount = 0;
    _pendingAction = PendingCommandAction::None;
    _pendingActionId = "";
    _pendingActionSince = 0;
    _pendingActionLastLog = 0;

    for (uint8_t i = 0; i < MAX_RECENT_COMMANDS; i++) {
        _recentCommandIds[i] = "";
    }
}

bool CommandProcessor::wasRecentlyProcessed(const String& id) const {
    if (id.isEmpty()) {
        return false;
    }
    for (uint8_t i = 0; i < MAX_RECENT_COMMANDS; i++) {
        if (!_recentCommandIds[i].isEmpty() && _recentCommandIds[i] == id) {
            return true;
        }
    }
    return false;
}

void CommandProcessor::markProcessed(const String& id) {
    if (id.isEmpty()) {
        return;
    }
    _recentCommandIds[_recentCommandIndex] = id;
    _recentCommandIndex = (_recentCommandIndex + 1) % MAX_RECENT_COMMANDS;
}

void CommandProcessor::queuePendingAction(PendingCommandAction action, const String& id) {
    if (id.isEmpty()) {
        return;
    }
    if (_pendingAction != PendingCommandAction::None) {
        if (_pendingActionId == id) {
            return;
        }
        Serial.println("[SUPABASE] Another command action already pending; ignoring");
        return;
    }

    _pendingAction = action;
    _pendingActionId = id;
    _pendingActionSince = millis();
    _pendingActionLastLog = 0;
    markProcessed(id);

    // Free heap by disconnecting realtime before ack + reboot
    supabaseRealtime.disconnect();
    app_state.realtime_defer_until = millis() + 60000UL;

    Serial.printf("[SUPABASE] %s queued - waiting for safe heap to ack\n",
                  action == PendingCommandAction::FactoryReset ? "Factory reset" : "Reboot");
}

void CommandProcessor::processPendingActions() {
    if (_pendingAction == PendingCommandAction::None) {
        return;
    }

    const unsigned long now = millis();
    app_state.realtime_defer_until = now + 60000UL;

    if (!hasSafeTlsHeap(65000, 40000)) {
        if (now - _pendingActionLastLog > 10000) {
            _pendingActionLastLog = now;
            Serial.printf("[SUPABASE] Pending command waiting for TLS heap (%lus)\n",
                          (now - _pendingActionSince) / 1000);
        }
        return;
    }

    if (supabaseClient.isRequestInFlight()) {
        return;
    }

    if (!supabaseClient.ackCommand(_pendingActionId, true, "", "")) {
        if (now - _pendingActionLastLog > 10000) {
            _pendingActionLastLog = now;
            Serial.println("[SUPABASE] Pending command ack failed; will retry");
        }
        return;
    }

    markProcessed(_pendingActionId);

    if (_pendingAction == PendingCommandAction::FactoryReset) {
        config_manager.factoryReset();
    }

    _pendingAction = PendingCommandAction::None;
    _pendingActionId = "";

    delay(500);
    ESP.restart();
}

bool CommandProcessor::enqueuePendingAck(const String& id, bool success,
                                          const String& response, const String& error) {
    if (_pendingAckCount >= MAX_PENDING_ACKS) {
        Serial.println("[SUPABASE] Ack queue full; dropping command ack");
        return false;
    }

    uint8_t slot = (_pendingAckHead + _pendingAckCount) % MAX_PENDING_ACKS;
    _pendingAcks[slot] = { id, success, response, error };
    _pendingAckCount++;
    return true;
}

void CommandProcessor::processPendingAcks() {
    if (_pendingAckCount == 0) {
        return;
    }

    if (!supabaseClient.isAuthenticated()) {
        return;
    }

    const bool realtime_connecting = supabaseRealtime.isConnecting();
    if (realtime_connecting) {
        return;
    }

    if (!hasSafeTlsHeap(65000, 40000)) {
        return;
    }

    while (_pendingAckCount > 0) {
        PendingAck& ack = _pendingAcks[_pendingAckHead];
        if (!supabaseClient.ackCommand(ack.id, ack.success, ack.response, ack.error)) {
            break;
        }
        _pendingAckHead = (_pendingAckHead + 1) % MAX_PENDING_ACKS;
        _pendingAckCount--;
    }
}

bool CommandProcessor::sendOrQueueAck(const String& id, bool success,
                                       const String& response, const String& error) {
    const bool realtime_connecting = supabaseRealtime.isConnecting();
    if (realtime_connecting || !hasSafeTlsHeap(65000, 40000)) {
        return enqueuePendingAck(id, success, response, error);
    }

    if (!supabaseClient.ackCommand(id, success, response, error)) {
        return enqueuePendingAck(id, success, response, error);
    }
    return true;
}

// Note: handleCommand() is intentionally NOT implemented here
// The actual command execution stays in main.cpp due to dependencies on many global objects
// main.cpp will call commandProcessor methods for queue management
