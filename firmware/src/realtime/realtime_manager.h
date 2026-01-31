/**
 * @file realtime_manager.h
 * @brief Manages Supabase Realtime WebSocket connection
 *
 * Handles realtime connection initialization, message routing, and reconnection logic.
 */

#ifndef REALTIME_MANAGER_H
#define REALTIME_MANAGER_H

#include <Arduino.h>
#include "../supabase/supabase_realtime.h"

/**
 * @brief Realtime Manager - handles WebSocket connection lifecycle
 */
class RealtimeManager {
public:
    RealtimeManager();
    ~RealtimeManager();

    /**
     * @brief Initialize realtime manager
     */
    void begin();

    /**
     * @brief Main realtime loop - call from main loop()
     * @param current_time Current millis()
     */
    void loop(unsigned long current_time);

    /**
     * @brief Check if realtime is connected and subscribed
     */
    bool isConnected() const;

    /**
     * @brief Force reconnection
     */
    void reconnect();

    /**
     * @brief Initialize realtime connection if conditions are met
     * @return true if initialization succeeded or connection is already active
     */
    bool initConnection();

private:
    bool _initialized;
    unsigned long _lastInitAttempt;
    unsigned long _lastSubscribedTime;
    unsigned long _lastWatchdogLog;
    bool _watchdogInit;

    /**
     * @brief Attempt to initialize the realtime WebSocket connection
     */
    bool attemptInit();
};

// Global instance
extern RealtimeManager realtimeManager;

#endif // REALTIME_MANAGER_H
