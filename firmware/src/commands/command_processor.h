/**
 * @file command_processor.h
 * @brief Command processing and queue management
 *
 * Handles all Supabase commands, acknowledgments, and pending actions.
 */

#ifndef COMMAND_PROCESSOR_H
#define COMMAND_PROCESSOR_H

#include <Arduino.h>
#include "../supabase/supabase_client.h"

/**
 * @brief Pending command action types
 */
enum class PendingCommandAction : uint8_t {
    None = 0,
    Reboot,
    FactoryReset
};

/**
 * @brief Command Processor - handles all command execution and queuing
 */
class CommandProcessor {
public:
    CommandProcessor();
    ~CommandProcessor();

    void begin();
    void processPendingActions();
    void processPendingAcks();
    bool wasRecentlyProcessed(const String& id) const;
    void markProcessed(const String& id);
    bool sendOrQueueAck(const String& id, bool success,
                        const String& response, const String& error);
    void queuePendingAction(PendingCommandAction action, const String& id);

private:
    static constexpr uint8_t MAX_RECENT_COMMANDS = 8;
    String _recentCommandIds[MAX_RECENT_COMMANDS];
    uint8_t _recentCommandIndex;

    struct PendingAck {
        String id;
        bool success;
        String response;
        String error;
    };
    static constexpr uint8_t MAX_PENDING_ACKS = 4;
    PendingAck _pendingAcks[MAX_PENDING_ACKS];
    uint8_t _pendingAckHead;
    uint8_t _pendingAckCount;

    PendingCommandAction _pendingAction;
    String _pendingActionId;
    unsigned long _pendingActionSince;
    unsigned long _pendingActionLastLog;

    bool enqueuePendingAck(const String& id, bool success,
                           const String& response, const String& error);
};

extern CommandProcessor commandProcessor;

#endif // COMMAND_PROCESSOR_H
