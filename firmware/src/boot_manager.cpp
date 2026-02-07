/**
 * @file boot_manager.cpp
 * @brief Boot validation and partition version tracking implementation
 */

#include "boot_manager.h"
#include "debug/log_system.h"
#include "esp_ota_ops.h"

static const char* TAG = "BOOT";

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

bool initBootValidation() {
    // Boot validation - check if we should rollback to bootstrap
    if (!boot_validator.begin()) {
        ESP_LOGE(TAG, "Boot validation failed");
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
        ESP_LOGI(TAG, "Stored version %s for partition %s", FIRMWARE_VERSION, running->label);
        #endif
    }
    #endif
}
