/**
 * @file boot_validator.cpp
 * @brief Boot Validation Implementation
 */

#include "boot_validator.h"
#include "common/nvs_utils.h"
#include "debug/log_system.h"
#include <esp_ota_ops.h>

static const char* TAG = "BOOT_VAL";

// Global instance
BootValidator boot_validator;

BootValidator::BootValidator()
    : boot_count(0), initialized(false) {
}

bool BootValidator::begin() {
    ESP_LOGI(TAG, "Boot validator starting...");
    
    // Check which partition we're running from
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        ESP_LOGI(TAG, "Running from partition: %s (type %d, subtype %d)",
                      running->label, running->type, running->subtype);
        
        if (running->subtype == ESP_PARTITION_SUBTYPE_APP_FACTORY) {
            ESP_LOGI(TAG, "Running from factory partition (bootstrap)");
            // Factory partition doesn't need boot validation
            initialized = true;
            return true;
        }
    }
    
    // Read and increment boot counter
    incrementBootCount();
    
    ESP_LOGI(TAG, "Boot count: %d / %d", boot_count, MAX_BOOT_FAILURES);
    
    // Check if we've exceeded boot failure threshold
    if (boot_count > MAX_BOOT_FAILURES) {
        ESP_LOGE(TAG, "Too many boot failures, rolling back");
        rollbackToLastKnownGood();
        // Won't return - device reboots
        return false;
    }
    
    // Emergency recovery: if boot count exceeds MAX_BOOT_LOOP_COUNT, reset counter
    // This prevents infinite boot loops when both partitions are problematic
    if (boot_count > MAX_BOOT_LOOP_COUNT) {
        ESP_LOGW(TAG, "Emergency recovery: boot count %d exceeds %d, resetting counter",
                      boot_count, MAX_BOOT_LOOP_COUNT);
        ESP_LOGW(TAG, "WARNING: Continuing boot despite repeated failures");
        resetBootCount();
        // Continue boot - this allows recovery via web installer or serial
    }
    
    initialized = true;
    return true;
}

void BootValidator::markBootSuccessful() {
    if (!initialized) {
        ESP_LOGW(TAG, "Cannot mark successful - not initialized");
        return;
    }
    
    ESP_LOGI(TAG, "Marking boot as successful");
    
    // Reset boot counter
    resetBootCount();
    
    // Cancel OTA rollback - mark current partition as valid
    esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "OTA rollback cancelled - firmware validated");
    } else if (err == ESP_ERR_OTA_ROLLBACK_INVALID_STATE) {
        ESP_LOGI(TAG, "No pending OTA rollback (normal boot)");
    } else {
        ESP_LOGE(TAG, "Failed to cancel rollback: %s", esp_err_to_name(err));
    }
}

bool BootValidator::isFactoryPartition() const {
    const esp_partition_t* running = esp_ota_get_running_partition();
    return running && running->subtype == ESP_PARTITION_SUBTYPE_APP_FACTORY;
}

void BootValidator::rollbackToLastKnownGood() {
    ESP_LOGI(TAG, "Initiating rollback to last known good partition...");
    
    // Get current running partition
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (!running) {
        ESP_LOGE(TAG, "ERROR: Cannot determine running partition!");
        // Try factory partition as fallback
        rollbackToFactoryFallback();
        return;
    }
    
    ESP_LOGI(TAG, "Currently running from: %s", running->label);
    
    // Read last attempted partition from NVS to prevent ping-ponging
    String lastPartition = nvsReadString(BOOT_NVS_NAMESPACE, LAST_PARTITION_KEY, "");
    
    // Determine target partition (switch between ota_0 and ota_1)
    const esp_partition_t* target = nullptr;
    
    if (running->subtype == ESP_PARTITION_SUBTYPE_APP_OTA_0) {
        // Currently on ota_0, switch to ota_1
        ESP_LOGI(TAG, "Switching from ota_0 to ota_1...");
        target = esp_partition_find_first(
            ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_1, NULL);
    } else if (running->subtype == ESP_PARTITION_SUBTYPE_APP_OTA_1) {
        // Currently on ota_1, switch to ota_0
        ESP_LOGI(TAG, "Switching from ota_1 to ota_0...");
        target = esp_partition_find_first(
            ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_0, NULL);
    }
    
    // Check if we're ping-ponging between partitions
    if (!lastPartition.isEmpty() && target && lastPartition == target->label) {
        ESP_LOGW(TAG, "WARNING: Already attempted partition %s, preventing ping-pong",
                      target->label);
        // Both partitions are bad - check if we should reset boot count
        if (boot_count > MAX_BOOT_LOOP_COUNT) {
            ESP_LOGW(TAG, "Both partitions failing, resetting boot count for recovery");
            resetBootCount();
            // Don't reboot - allow boot to continue for recovery
            return;
        }
        // Still in recovery mode - try factory partition instead
        rollbackToFactoryFallback();
        return;
    }
    
    if (target) {
        ESP_LOGI(TAG, "Found target partition: %s (address: 0x%x, size: %d)",
                      target->label, target->address, target->size);
        
        // FIXED: Store label string before using pointer (prevent dangling pointer)
        String targetLabel = String(target->label);
        
        // Store target partition in NVS before switching
        {
            NvsScope nvs(BOOT_NVS_NAMESPACE);
            if (nvs.isOpen()) {
                nvs.putString(LAST_PARTITION_KEY, targetLabel);
                // Reset boot count for the new partition
                nvs.putInt(BOOT_COUNTER_KEY, 0);
            }
        }
        
        // Set boot partition to target
        esp_err_t err = esp_ota_set_boot_partition(target);
        if (err == ESP_OK) {
            // Verify partition switch
            const esp_partition_t* boot_partition = esp_ota_get_boot_partition();
            if (boot_partition && strcmp(boot_partition->label, targetLabel.c_str()) == 0) {
                ESP_LOGI(TAG, "Boot partition verified: %s", boot_partition->label);
                ESP_LOGI(TAG, "Rebooting to last known good partition...");
                delay(1000);
                ESP.restart();
            } else {
                ESP_LOGW(TAG, "WARNING: Boot partition verification failed!");
                // Continue with reboot anyway
                delay(1000);
                ESP.restart();
            }
        } else {
            ESP_LOGE(TAG, "Failed to set boot partition: %s", esp_err_to_name(err));
            // Try factory partition as fallback
            rollbackToFactoryFallback();
        }
    } else {
        ESP_LOGE(TAG, "Target OTA partition not found!");
        // Try factory partition as fallback
        rollbackToFactoryFallback();
    }
}

void BootValidator::rollbackToFactoryFallback() {
    ESP_LOGI(TAG, "Attempting fallback to factory partition...");
    
    // Find factory partition
    const esp_partition_t* factory = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_FACTORY, NULL);
    
    if (factory) {
        ESP_LOGI(TAG, "Found factory partition: %s", factory->label);
        
        // Set boot partition to factory
        esp_err_t err = esp_ota_set_boot_partition(factory);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "Boot partition set to factory, rebooting...");
            delay(1000);
            ESP.restart();
        } else {
            ESP_LOGE(TAG, "Failed to set boot partition: %s", esp_err_to_name(err));
        }
    } else {
        ESP_LOGE(TAG, "Factory partition not found!");
    }
    
    // Last resort: try ESP-IDF rollback mechanism
    ESP_LOGI(TAG, "Trying ESP-IDF rollback mechanism...");
    esp_err_t err = esp_ota_mark_app_invalid_rollback_and_reboot();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA rollback failed: %s", esp_err_to_name(err));
        
        // Final fallback: if boot count exceeds MAX_BOOT_LOOP_COUNT, reset and continue
        if (boot_count > MAX_BOOT_LOOP_COUNT) {
            ESP_LOGW(TAG, "Emergency recovery: resetting boot count");
            resetBootCount();
            // Don't reboot - allow boot to continue for recovery
            return;
        }
        
        // Last resort - just reboot and hope for the best
        ESP.restart();
    }
}

void BootValidator::onOTAFailed(const String& error_message) {
    onCriticalFailure("OTA Update", error_message);
}

void BootValidator::onCriticalFailure(const String& component, const String& error_message) {
    ESP_LOGE(TAG, "=============================================");
    ESP_LOGE(TAG, "  CRITICAL BOOT FAILURE");
    ESP_LOGE(TAG, "=============================================");
    ESP_LOGE(TAG, "  Component: %s", component.c_str());
    ESP_LOGE(TAG, "  Error: %s", error_message.c_str());
    ESP_LOGE(TAG, "");
    ESP_LOGE(TAG, "  Rolling back to bootloader for recovery...");
    ESP_LOGE(TAG, "  Use bootloader to reconfigure or reinstall.");
    ESP_LOGE(TAG, "=============================================");
    
    delay(3000);  // Give user time to see the message
    
    // Rollback to last known good partition
    rollbackToLastKnownGood();
}

void BootValidator::incrementBootCount() {
    NvsScope nvs(BOOT_NVS_NAMESPACE);
    if (nvs.isOpen()) {
        boot_count = nvs.getInt(BOOT_COUNTER_KEY, 0) + 1;
        nvs.putInt(BOOT_COUNTER_KEY, boot_count);
    }
}

void BootValidator::resetBootCount() {
    NvsScope nvs(BOOT_NVS_NAMESPACE);
    if (nvs.isOpen()) {
        nvs.putInt(BOOT_COUNTER_KEY, 0);
        boot_count = 0;
    }
    ESP_LOGI(TAG, "Boot counter reset");
}
