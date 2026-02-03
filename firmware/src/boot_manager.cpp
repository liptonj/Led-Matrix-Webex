/**
 * @file boot_manager.cpp
 * @brief Boot validation and partition version tracking implementation
 */

#include "boot_manager.h"
#include "debug/remote_logger.h"
#include "esp_ota_ops.h"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

bool initBootValidation() {
    // Boot validation - check if we should rollback to bootstrap
    if (!boot_validator.begin()) {
        RLOG_ERROR("init", "Boot validation failed");
        return false;
    }
    return true;
}

void storePartitionVersion(ConfigManager& config_manager) {
    // Store version for currently running partition (for OTA version tracking)
    #ifndef NATIVE_BUILD
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        #ifdef FIRMWARE_VERSION
        config_manager.setPartitionVersion(String(running->label), FIRMWARE_VERSION);
        Serial.printf("[INIT] Stored version %s for partition %s\n", FIRMWARE_VERSION, running->label);
        #endif
    }
    #endif
}
