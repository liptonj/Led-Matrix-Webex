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
#include "../debug/remote_logger.h"
#include "../app_state.h"

// External references
extern MatrixDisplay matrix_display;
extern SupabaseRealtime supabaseRealtime;
extern AppState app_state;

OTAManager::OTAManager()
    : update_available(false), use_manifest_mode(false) {
}

OTAManager::~OTAManager() {
}

void OTAManager::begin(const String& url, const String& version) {
    update_url = url;
    current_version = version;

    Serial.printf("[OTA] Initialized with version %s\n", current_version.c_str());
}

void OTAManager::setManifestUrl(const String& url) {
    manifest_url = url;
    use_manifest_mode = true;
    Serial.printf("[OTA] Manifest mode enabled: %s\n", manifest_url.c_str());
}

bool OTAManager::checkForUpdate() {
    // Try manifest first if configured
    if (use_manifest_mode && !manifest_url.isEmpty()) {
        Serial.println("[OTA] Using manifest mode");
        if (checkUpdateFromManifest()) {
            return true;
        }
        // Fall through to GitHub API on failure
        Serial.println("[OTA] Manifest mode failed, falling back to GitHub API");
    }

    // Fallback to GitHub API
    return checkUpdateFromGithubAPI();
}

bool OTAManager::performUpdate() {
    if (!update_available) {
        Serial.println("[OTA] No update available");
        return false;
    }

    RLOG_INFO("OTA", "Starting update from %s to %s", current_version.c_str(), latest_version.c_str());

    // Web assets are now embedded in firmware - only need to download firmware.bin
    // No more LMWB bundles or separate LittleFS downloads needed
    if (firmware_url.isEmpty()) {
        Serial.println("[OTA] Missing firmware URL");
        RLOG_ERROR("OTA", "No firmware URL available for update");
        return false;
    }

    Serial.println("[OTA] Downloading firmware (web assets embedded)");
    if (!downloadAndInstallBinary(firmware_url, U_FLASH, "firmware")) {
        RLOG_ERROR("OTA", "Firmware download/install failed");
        return false;
    }

    Serial.println("[OTA] Firmware update successful!");
    Serial.println("[OTA] Rebooting...");
    RLOG_INFO("OTA", "Update to %s successful, rebooting", latest_version.c_str());

    // Show complete status
    matrix_display.showUpdatingProgress(latest_version, 100, "Rebooting...");

    delay(1000);
    ESP.restart();

    return true; // Won't reach here due to restart
}
