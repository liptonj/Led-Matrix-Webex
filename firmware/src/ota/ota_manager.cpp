/**
 * @file ota_manager.cpp
 * @brief OTA Update Manager - Core Orchestration
 * 
 * This file contains the core orchestration logic for OTA updates,
 * delegating to phase-specific modules for version checking, downloading,
 * flashing, and bundle handling.
 */

#include "ota_manager.h"
#include <Arduino.h>
#include <Update.h>
#include "../display/matrix_display.h"
#include "../supabase/supabase_realtime.h"
#include "../debug/log_system.h"
#include "../app_state.h"
#include "../core/dependencies.h"

static const char* TAG = "OTA_MGR";

OTAManager::OTAManager()
    : update_available(false), use_manifest_mode(false) {
}

OTAManager::~OTAManager() {
}

void OTAManager::begin(const String& url, const String& version) {
    update_url = url;
    current_version = version;

    ESP_LOGI(TAG, "Initialized with version %s", current_version.c_str());
}

void OTAManager::setManifestUrl(const String& url) {
    manifest_url = url;
    use_manifest_mode = true;
    ESP_LOGI(TAG, "Manifest mode enabled: %s", manifest_url.c_str());
}

bool OTAManager::checkForUpdate() {
    // Try manifest first if configured
    if (use_manifest_mode && !manifest_url.isEmpty()) {
        ESP_LOGI(TAG, "Using manifest mode");
        if (checkUpdateFromManifest()) {
            return true;
        }
        // Fall through to GitHub API on failure
        ESP_LOGW(TAG, "Manifest mode failed, falling back to GitHub API");
    }

    // Fallback to GitHub API
    return checkUpdateFromGithubAPI();
}

bool OTAManager::performUpdate() {
    if (!update_available) {
        ESP_LOGI(TAG, "No update available");
        return false;
    }

    ESP_LOGI(TAG, "Starting update from %s to %s", current_version.c_str(), latest_version.c_str());

    // Web assets are now embedded in firmware - only need to download firmware.bin
    // No more LMWB bundles or separate LittleFS downloads needed
    if (firmware_url.isEmpty()) {
        ESP_LOGE(TAG, "Missing firmware URL");
        return false;
    }

    ESP_LOGI(TAG, "Downloading firmware (web assets embedded)");
    if (!downloadAndInstallBinary(firmware_url, U_FLASH, "firmware")) {
        ESP_LOGE(TAG, "Firmware download/install failed");
        return false;
    }

    ESP_LOGI(TAG, "Firmware update successful!");
    ESP_LOGI(TAG, "Rebooting...");
    ESP_LOGI(TAG, "Update to %s successful, rebooting", latest_version.c_str());

    // Show complete status
    auto& deps = getDependencies();
    deps.display.showUpdatingProgress(latest_version, 100, "Rebooting...");

    delay(1000);
    ESP.restart();

    return true; // Won't reach here due to restart
}
