/**
 * @file ota_flash.cpp
 * @brief OTA Flash and Partition Operations
 * 
 * This file handles ESP32 partition management, update initialization,
 * finalization, and boot partition selection for OTA updates.
 */

#include "ota_manager.h"
#include "../config/config_manager.h"
#include "../debug/remote_logger.h"
#include "../core/dependencies.h"
#include <Update.h>
#ifndef NATIVE_BUILD
#include <esp_ota_ops.h>
#include <esp_partition.h>
#endif

namespace OTAManagerFlash {

#ifndef NATIVE_BUILD
const esp_partition_t* getTargetPartition() {
    return esp_ota_get_next_update_partition(nullptr);
}
#endif

bool beginUpdate(size_t contentLength, int update_type, const esp_partition_t* target_partition) {
#ifndef NATIVE_BUILD
    // For firmware updates, explicitly target the OTA partition using the partition label
    // This ensures we NEVER overwrite the factory/bootstrap partition
    if (update_type == U_FLASH && target_partition) {
        const char* ota_label = target_partition->label;
        Serial.printf("[OTA] Using explicit partition label: %s\n", ota_label);
        if (!Update.begin(contentLength, update_type, -1, LOW, ota_label)) {
            Serial.printf("[OTA] Not enough space: %s\n", Update.errorString());
            return false;
        }
    } else {
        if (!Update.begin(contentLength, update_type)) {
            Serial.printf("[OTA] Not enough space: %s\n", Update.errorString());
            return false;
        }
    }
#else
    if (!Update.begin(contentLength, update_type)) {
        Serial.printf("[OTA] Not enough space: %s\n", Update.errorString());
        return false;
    }
#endif
    return true;
}

bool finalizeUpdate(int update_type, const esp_partition_t* target_partition, const String& version) {
    if (!Update.end()) {
        Serial.printf("[OTA] Update failed: %s\n", Update.errorString());
        RLOG_ERROR("ota", "Update failed: %s", Update.errorString());
        return false;
    }

#ifndef NATIVE_BUILD
    if (update_type == U_FLASH && target_partition) {
        esp_err_t err = esp_ota_set_boot_partition(target_partition);
        if (err != ESP_OK) {
            Serial.printf("[OTA] Failed to set boot partition: %s\n", esp_err_to_name(err));
            RLOG_ERROR("ota", "Failed to set boot partition: %s", esp_err_to_name(err));
            return false;
        }
        Serial.printf("[OTA] Boot partition set to %s\n", target_partition->label);

        // Store the version for this partition in NVS for future display
        auto& deps = getDependencies();
        deps.config.setPartitionVersion(String(target_partition->label), version);
    }
#endif

    return true;
}

}  // namespace OTAManagerFlash
