/**
 * @file sync_manager.h
 * @brief Manages synchronization with Supabase backend
 *
 * Handles device state sync, command polling, and heartbeat management.
 */

#ifndef SYNC_MANAGER_H
#define SYNC_MANAGER_H

#include <Arduino.h>

/**
 * @brief Sync Manager - handles Supabase backend sync operations
 */
class SyncManager {
public:
    SyncManager();
    ~SyncManager();

    /**
     * @brief Initialize sync manager
     */
    void begin();

    /**
     * @brief Main sync loop - call from main loop()
     * @param current_time Current millis()
     */
    void loop(unsigned long current_time);

    /**
     * @brief Force immediate sync
     */
    void forceSyncNow();

    /**
     * @brief Check if sync is due
     * @param current_time Current millis()
     * @return true if sync should run
     */
    bool isSyncDue(unsigned long current_time) const;

private:
    unsigned long _lastHeartbeat;
    unsigned long _lastFullSync;
    unsigned long _lastRealtimeSocketSeen;

    /**
     * @brief Perform device state sync with Supabase
     */
    void performSync(bool isHeartbeat);

    /**
     * @brief Poll for pending commands
     */
    void pollCommands();
};

// Global instance
extern SyncManager syncManager;

#endif // SYNC_MANAGER_H
