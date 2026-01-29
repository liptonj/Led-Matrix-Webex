/**
 * @file boot_validator.h
 * @brief Boot Validation and OTA Rollback Support
 * 
 * This module implements boot validation to ensure firmware stability.
 * If the main firmware fails to boot properly, the ESP32 will automatically
 * rollback to the factory partition (bootstrap firmware).
 * 
 * How it works:
 * 1. On boot, increment a boot counter in NVS
 * 2. If counter exceeds threshold (3), firmware is unstable - rollback
 * 3. After successful initialization, mark app as valid and reset counter
 * 4. If app crashes before marking valid, counter persists for next boot
 */

#ifndef BOOT_VALIDATOR_H
#define BOOT_VALIDATOR_H

#include <Arduino.h>

// Maximum failed boot attempts before rollback
#define MAX_BOOT_FAILURES 3

// Maximum boot loop count before emergency recovery (reset boot count)
// This prevents infinite boot loops when both partitions are bad
#define MAX_BOOT_LOOP_COUNT 10

// NVS namespace and keys
#define BOOT_NVS_NAMESPACE "boot"
#define BOOT_COUNTER_KEY "boot_count"
#define LAST_PARTITION_KEY "last_partition"

class BootValidator {
public:
    BootValidator();
    
    /**
     * @brief Initialize boot validator and check boot count
     * 
     * Call this early in setup() BEFORE other initialization.
     * If boot count exceeds threshold, this will trigger rollback.
     * 
     * @return true if boot is allowed to proceed
     * @return false if rollback was triggered (won't return, device reboots)
     */
    bool begin();
    
    /**
     * @brief Mark the current firmware as valid
     * 
     * Call this AFTER all critical initialization is complete
     * and the firmware is confirmed working.
     * This cancels the OTA rollback mechanism.
     */
    void markBootSuccessful();
    
    /**
     * @brief Get the current boot count
     * @return Number of boot attempts since last successful boot
     */
    int getBootCount() const { return boot_count; }
    
    /**
     * @brief Check if running from factory partition
     * @return true if running from factory (bootstrap) partition
     */
    bool isFactoryPartition() const;
    
    /**
     * @brief Manually trigger rollback to last known good partition
     * 
     * Attempts A/B rollback (switch between ota_0 and ota_1).
     * Falls back to factory partition if it exists.
     * If both partitions fail repeatedly, resets boot count as last resort.
     */
    void rollbackToLastKnownGood();
    
    /**
     * @brief Manually trigger rollback to factory partition (legacy)
     * @deprecated Use rollbackToLastKnownGood() instead
     */
    void rollbackToFactory() { rollbackToLastKnownGood(); }
    
    /**
     * @brief Call this when OTA update fails to rollback to bootloader
     * @param error_message Error message to log
     */
    void onOTAFailed(const String& error_message);
    
    /**
     * @brief Call this on ANY critical boot failure to rollback to bootloader
     * @param component Component that failed (e.g., "WiFi", "Display", "Config")
     * @param error_message Error description
     */
    void onCriticalFailure(const String& component, const String& error_message);
    
private:
    int boot_count;
    bool initialized;
    
    void incrementBootCount();
    void resetBootCount();
    void rollbackToFactoryFallback();
};

// Global instance
extern BootValidator boot_validator;

#endif // BOOT_VALIDATOR_H
