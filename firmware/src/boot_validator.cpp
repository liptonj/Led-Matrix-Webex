/**
 * @file boot_validator.cpp
 * @brief Boot Validation Implementation
 */

#include "boot_validator.h"
#include <Preferences.h>
#include <esp_ota_ops.h>

// Global instance
BootValidator boot_validator;

BootValidator::BootValidator()
    : boot_count(0), initialized(false) {
}

bool BootValidator::begin() {
    Serial.println("[BOOT] Boot validator starting...");
    
    // Check which partition we're running from
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        Serial.printf("[BOOT] Running from partition: %s (type %d, subtype %d)\n",
                      running->label, running->type, running->subtype);
        
        if (running->subtype == ESP_PARTITION_SUBTYPE_APP_FACTORY) {
            Serial.println("[BOOT] Running from factory partition (bootstrap)");
            // Factory partition doesn't need boot validation
            initialized = true;
            return true;
        }
    }
    
    // Read and increment boot counter
    incrementBootCount();
    
    Serial.printf("[BOOT] Boot count: %d / %d\n", boot_count, MAX_BOOT_FAILURES);
    
    // Check if we've exceeded boot failure threshold
    if (boot_count > MAX_BOOT_FAILURES) {
        Serial.println("[BOOT] Too many boot failures, rolling back to factory...");
        rollbackToFactory();
        // Won't return - device reboots
        return false;
    }
    
    initialized = true;
    return true;
}

void BootValidator::markBootSuccessful() {
    if (!initialized) {
        Serial.println("[BOOT] Cannot mark successful - not initialized");
        return;
    }
    
    Serial.println("[BOOT] Marking boot as successful");
    
    // Reset boot counter
    resetBootCount();
    
    // Cancel OTA rollback - mark current partition as valid
    esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
    if (err == ESP_OK) {
        Serial.println("[BOOT] OTA rollback cancelled - firmware validated");
    } else if (err == ESP_ERR_OTA_ROLLBACK_INVALID_STATE) {
        Serial.println("[BOOT] No pending OTA rollback (normal boot)");
    } else {
        Serial.printf("[BOOT] Failed to cancel rollback: %s\n", esp_err_to_name(err));
    }
}

bool BootValidator::isFactoryPartition() const {
    const esp_partition_t* running = esp_ota_get_running_partition();
    return running && running->subtype == ESP_PARTITION_SUBTYPE_APP_FACTORY;
}

void BootValidator::rollbackToFactory() {
    Serial.println("[BOOT] Initiating rollback to factory partition...");
    
    // Find factory partition
    const esp_partition_t* factory = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_FACTORY, NULL);
    
    if (factory) {
        Serial.printf("[BOOT] Found factory partition: %s\n", factory->label);
        
        // Set boot partition to factory
        esp_err_t err = esp_ota_set_boot_partition(factory);
        if (err == ESP_OK) {
            Serial.println("[BOOT] Boot partition set to factory, rebooting...");
            delay(1000);
            ESP.restart();
        } else {
            Serial.printf("[BOOT] Failed to set boot partition: %s\n", esp_err_to_name(err));
        }
    } else {
        Serial.println("[BOOT] Factory partition not found!");
        // Try ESP-IDF rollback as fallback
        esp_err_t err = esp_ota_mark_app_invalid_rollback_and_reboot();
        if (err != ESP_OK) {
            Serial.printf("[BOOT] OTA rollback failed: %s\n", esp_err_to_name(err));
            // Last resort - just reboot and hope for the best
            ESP.restart();
        }
    }
}

void BootValidator::onOTAFailed(const String& error_message) {
    onCriticalFailure("OTA Update", error_message);
}

void BootValidator::onCriticalFailure(const String& component, const String& error_message) {
    Serial.println();
    Serial.println("=============================================");
    Serial.println("  CRITICAL BOOT FAILURE");
    Serial.println("=============================================");
    Serial.printf("  Component: %s\n", component.c_str());
    Serial.printf("  Error: %s\n", error_message.c_str());
    Serial.println();
    Serial.println("  Rolling back to bootloader for recovery...");
    Serial.println("  Use bootloader to reconfigure or reinstall.");
    Serial.println("=============================================");
    Serial.println();
    
    delay(3000);  // Give user time to see the message
    
    // Rollback to bootloader (factory partition)
    rollbackToFactory();
}

void BootValidator::incrementBootCount() {
    Preferences prefs;
    prefs.begin(BOOT_NVS_NAMESPACE, false);
    boot_count = prefs.getInt(BOOT_COUNTER_KEY, 0) + 1;
    prefs.putInt(BOOT_COUNTER_KEY, boot_count);
    prefs.end();
}

void BootValidator::resetBootCount() {
    Preferences prefs;
    prefs.begin(BOOT_NVS_NAMESPACE, false);
    prefs.putInt(BOOT_COUNTER_KEY, 0);
    boot_count = 0;
    prefs.end();
    Serial.println("[BOOT] Boot counter reset");
}
