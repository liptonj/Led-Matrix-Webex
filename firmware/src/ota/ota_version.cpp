/**
 * @file ota_version.cpp
 * @brief OTA Version Checking and Update Detection
 * 
 * This file handles version comparison, manifest parsing, GitHub API parsing,
 * and release asset selection for OTA updates.
 */

#include "ota_manager.h"
#include "ota_helpers.h"
#include "../auth/device_credentials.h"
#include "../common/ca_certs.h"
#include "../common/board_utils.h"
#include "../config/config_manager.h"
#include "../debug/log_system.h"
#include "../core/dependencies.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>

static const char* TAG = "OTA_VER";

namespace {
// Add HMAC authentication headers if device is provisioned
void addAuthHeaders(HTTPClient& http) {
    if (deviceCredentials.isProvisioned()) {
        uint32_t timestamp = DeviceCredentials::getTimestamp();
        String signature = deviceCredentials.signRequest(timestamp, "");

        http.addHeader("X-Device-Serial", deviceCredentials.getSerialNumber());
        http.addHeader("X-Timestamp", String(timestamp));
        http.addHeader("X-Signature", signature);

        ESP_LOGD(TAG, "Added HMAC authentication headers");
    }
}
}  // namespace

bool OTAManager::compareVersions(const String& v1, const String& v2) {
    // Simple semantic version comparison
    // Returns true if v1 > v2

    int v1_major = 0, v1_minor = 0, v1_patch = 0;
    int v2_major = 0, v2_minor = 0, v2_patch = 0;

    sscanf(v1.c_str(), "%d.%d.%d", &v1_major, &v1_minor, &v1_patch);
    sscanf(v2.c_str(), "%d.%d.%d", &v2_major, &v2_minor, &v2_patch);

    if (v1_major > v2_major) return true;
    if (v1_major < v2_major) return false;

    if (v1_minor > v2_minor) return true;
    if (v1_minor < v2_minor) return false;

    return v1_patch > v2_patch;
}

String OTAManager::extractVersion(const String& tag) {
    // Remove 'v' prefix if present
    if (tag.startsWith("v") || tag.startsWith("V")) {
        return tag.substring(1);
    }
    return tag;
}

bool OTAManager::checkUpdateFromManifest() {
    if (manifest_url.isEmpty()) {
        return false;
    }

    ESP_LOGI(TAG, "Fetching manifest from %s", manifest_url.c_str());

    WiFiClientSecure client;
    auto& deps = getDependencies();
    OTAHelpers::configureTlsClient(client, CA_CERT_BUNDLE_OTA, deps.config.getTlsVerify(), manifest_url);

    HTTPClient http;
    http.begin(client, manifest_url);
    OTAHelpers::configureHttpClient(http);

    // Add HMAC authentication for authenticated manifest access
    addAuthHeaders(http);

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        ESP_LOGE(TAG, "Manifest fetch failed: HTTP %d", httpCode);
        http.end();
        return false;
    }

    String response = http.getString();
    http.end();

    // Parse manifest JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (error) {
        ESP_LOGE(TAG, "Failed to parse manifest: %s", error.c_str());
        return false;
    }

    // Extract version and build info
    latest_version = doc["version"].as<String>();
    latest_build_id = doc["build_id"].as<String>();
    latest_build_date = doc["build_date"].as<String>();

    if (latest_version.isEmpty()) {
        ESP_LOGE(TAG, "No version in manifest");
        return false;
    }

    ESP_LOGI(TAG, "Manifest: version=%s, build_id=%s, build_date=%s",
             latest_version.c_str(),
             latest_build_id.isEmpty() ? "unknown" : latest_build_id.c_str(),
             latest_build_date.isEmpty() ? "unknown" : latest_build_date.c_str());

    // Extract URLs for this board - prefer firmware-only (web assets embedded)
    // Use runtime board detection instead of compile-time #ifdef
    String board_type_str = getBoardType();
    const char* board_type = board_type_str.c_str();
    ESP_LOGI(TAG, "Detected board type: %s", board_type);

    // Try firmware-only first (preferred - web assets now embedded in firmware)
    firmware_url = doc["firmware"][board_type]["url"].as<String>();

    bool has_firmware = !firmware_url.isEmpty();

    if (!has_firmware) {
        ESP_LOGE(TAG, "Missing %s firmware in manifest", board_type);
        return false;
    }

    // Compare versions
    update_available = compareVersions(latest_version, current_version);

    if (update_available) {
        ESP_LOGI(TAG, "Update available: %s -> %s",
                 current_version.c_str(), latest_version.c_str());
        ESP_LOGI(TAG, "Firmware: %s", firmware_url.c_str());
    } else {
        ESP_LOGD(TAG, "Already on latest version: %s", current_version.c_str());
    }

    return true;  // Successfully checked manifest
}

bool OTAManager::checkUpdateFromGithubAPI() {
    if (update_url.isEmpty()) {
        ESP_LOGE(TAG, "No update URL configured");
        return false;
    }

    ESP_LOGI(TAG, "Checking for updates at %s", update_url.c_str());

    WiFiClientSecure client;
    auto& deps = getDependencies();
    OTAHelpers::configureTlsClient(client, CA_CERT_BUNDLE_OTA, deps.config.getTlsVerify(), update_url);

    HTTPClient http;
    http.begin(client, update_url);
    OTAHelpers::configureHttpClient(http);
    http.addHeader("Accept", "application/vnd.github.v3+json");

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        ESP_LOGE(TAG, "Failed to check for updates: HTTP %d", httpCode);
        http.end();
        return false;
    }

    String response = http.getString();
    http.end();

    // Parse GitHub releases response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (error) {
        ESP_LOGE(TAG, "Failed to parse response: %s", error.c_str());
        return false;
    }

    // Extract version from tag_name
    String tag = doc["tag_name"].as<String>();
    latest_version = extractVersion(tag);

    firmware_url = "";

    // Find firmware assets in release
    JsonArray assets = doc["assets"].as<JsonArray>();
    if (!selectReleaseAssets(assets)) {
        ESP_LOGE(TAG, "Missing firmware asset in release");
        return false;
    }

    // Compare versions
    update_available = compareVersions(latest_version, current_version);

    if (update_available) {
        ESP_LOGI(TAG, "Update available: %s -> %s",
                 current_version.c_str(), latest_version.c_str());
    } else {
        ESP_LOGD(TAG, "Already on latest version");
    }

    return true;  // Successfully checked (even if no update available)
}

bool OTAManager::selectReleaseAssets(const JsonArray& assets) {
    int firmware_priority = 0;

    for (JsonObject asset : assets) {
        String name = asset["name"].as<String>();
        String name_lower = name;
        name_lower.toLowerCase();

        if (!name_lower.endsWith(".bin")) {
            continue;
        }

        if (name_lower.indexOf("bootstrap") >= 0) {
            continue;
        }

        const String download = asset["browser_download_url"].as<String>();

        // Check for firmware file
        if (name_lower.indexOf("firmware") >= 0) {
            int priority = 0;
            // Use runtime board detection instead of compile-time #ifdef
            String board = getBoardType();
            if (board == "esp32s3") {
                if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                    priority = 200;
                }
            } else if (board == "esp32s2") {
                if (name_lower.indexOf("esp32s2") >= 0 || name_lower.indexOf("esp32-s2") >= 0) {
                    priority = 200;
                }
            } else {
                // Base ESP32 - avoid S2/S3 variants
                if (name_lower.indexOf("esp32") >= 0 &&
                    name_lower.indexOf("esp32s3") < 0 &&
                    name_lower.indexOf("esp32-s3") < 0 &&
                    name_lower.indexOf("esp32s2") < 0 &&
                    name_lower.indexOf("esp32-s2") < 0) {
                    priority = 200;
                }
            }
            if (name_lower == "firmware.bin") {
                priority = max(priority, 50);
            }
            if (priority > firmware_priority) {
                firmware_priority = priority;
                firmware_url = download;
            }
        }
    }

    // Prefer firmware-only (web assets now embedded in firmware)
    if (firmware_priority > 0) {
        ESP_LOGI(TAG, "Using firmware: %s", firmware_url.c_str());
        return true;
    }

    return false;
}
