/**
 * @file boot_manager.h
 * @brief Boot validation and partition version tracking
 *
 * Handles boot validation and stores partition version information
 * for OTA version tracking.
 */

#ifndef BOOT_MANAGER_H
#define BOOT_MANAGER_H

#include <Arduino.h>
#include "boot_validator.h"
#include "config/config_manager.h"

/**
 * @brief Initialize boot validator and check boot count
 *
 * Call this early in setup() BEFORE other initialization.
 * If boot count exceeds threshold, this will trigger rollback.
 *
 * @return true if boot is allowed to proceed
 * @return false if rollback was triggered (won't return, device reboots)
 */
bool initBootValidation();

/**
 * @brief Store version for currently running partition
 *
 * Stores the firmware version for the current partition in config manager
 * for OTA version tracking.
 *
 * @param config_manager Config manager instance
 */
void storePartitionVersion(ConfigManager& config_manager);

#endif // BOOT_MANAGER_H
