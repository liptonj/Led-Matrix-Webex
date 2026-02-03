/**
 * @file ota_manager.cpp
 * @brief OTA Update Manager Implementation
 */

#include "ota_manager.h"
#include "ota_helpers.h"
#include "../auth/device_credentials.h"
#include "../common/ca_certs.h"
#include "../display/matrix_display.h"
#include "../config/config_manager.h"
#include "../common/secure_client_config.h"
#include "../supabase/supabase_realtime.h"
#include "../debug/remote_logger.h"
#include "../app_state.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <Update.h>
#include <LittleFS.h>
#ifndef NATIVE_BUILD
#include <esp_ota_ops.h>
#include <esp_partition.h>
#endif

// External reference to display for progress updates
extern MatrixDisplay matrix_display;
extern ConfigManager config_manager;
extern SupabaseRealtime supabaseRealtime;
extern AppState app_state;

namespace {
// Add HMAC authentication headers if device is provisioned
void addAuthHeaders(HTTPClient& http) {
    if (deviceCredentials.isProvisioned()) {
        uint32_t timestamp = DeviceCredentials::getTimestamp();
        String signature = deviceCredentials.signRequest(timestamp, "");

        http.addHeader("X-Device-Serial", deviceCredentials.getSerialNumber());
        http.addHeader("X-Timestamp", String(timestamp));
        http.addHeader("X-Signature", signature);

        Serial.println("[OTA] Added HMAC authentication headers");
    }
}
}  // namespace

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

bool OTAManager::checkUpdateFromManifest() {
    if (manifest_url.isEmpty()) {
        return false;
    }

    Serial.printf("[OTA] Fetching manifest from %s\n", manifest_url.c_str());

    WiFiClientSecure client;
    OTAHelpers::configureTlsClient(client, CA_CERT_BUNDLE_OTA, config_manager.getTlsVerify(), manifest_url);

    HTTPClient http;
    http.begin(client, manifest_url);
    OTAHelpers::configureHttpClient(http);

    // Add HMAC authentication for authenticated manifest access
    addAuthHeaders(http);

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] Manifest fetch failed: %d\n", httpCode);
        RLOG_ERROR("ota", "Manifest fetch failed: HTTP %d", httpCode);
        http.end();
        return false;
    }

    String response = http.getString();
    http.end();

    // Parse manifest JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (error) {
        Serial.printf("[OTA] Failed to parse manifest: %s\n", error.c_str());
        return false;
    }

    // Extract version and build info
    latest_version = doc["version"].as<String>();
    latest_build_id = doc["build_id"].as<String>();
    latest_build_date = doc["build_date"].as<String>();

    if (latest_version.isEmpty()) {
        Serial.println("[OTA] No version in manifest");
        return false;
    }

    Serial.printf("[OTA] Manifest: version=%s, build_id=%s, build_date=%s\n",
                  latest_version.c_str(),
                  latest_build_id.isEmpty() ? "unknown" : latest_build_id.c_str(),
                  latest_build_date.isEmpty() ? "unknown" : latest_build_date.c_str());

    // Extract URLs for this board - prefer firmware-only (web assets embedded)
    #if defined(ESP32_S3_BOARD)
    const char* board_type = "esp32s3";
    #else
    const char* board_type = "esp32";
    #endif

    // Try firmware-only first (preferred - web assets now embedded in firmware)
    firmware_url = doc["firmware"][board_type]["url"].as<String>();

    // Legacy fallback: bundle (for transition period)
    bundle_url = doc["bundle"][board_type]["url"].as<String>();

    // Clear filesystem URL - no longer needed
    littlefs_url = "";

    bool has_firmware = !firmware_url.isEmpty();
    bool has_bundle = !bundle_url.isEmpty();

    if (!has_firmware && !has_bundle) {
        Serial.printf("[OTA] Missing %s firmware in manifest\n", board_type);
        return false;
    }

    // Compare versions
    update_available = compareVersions(latest_version, current_version);

    if (update_available) {
        Serial.printf("[OTA] Update available: %s -> %s\n",
                      current_version.c_str(), latest_version.c_str());
        RLOG_INFO("OTA", "Update available: %s -> %s", current_version.c_str(), latest_version.c_str());
        if (has_firmware) {
            Serial.printf("[OTA] Firmware: %s\n", firmware_url.c_str());
        } else {
            Serial.printf("[OTA] Legacy bundle: %s\n", bundle_url.c_str());
        }
    } else {
        Serial.println("[OTA] Already on latest version");
        RLOG_DEBUG("OTA", "Already on latest version: %s", current_version.c_str());
    }

    return true;  // Successfully checked manifest
}

bool OTAManager::checkUpdateFromGithubAPI() {
    if (update_url.isEmpty()) {
        Serial.println("[OTA] No update URL configured");
        return false;
    }

    Serial.printf("[OTA] Checking for updates at %s\n", update_url.c_str());

    WiFiClientSecure client;
    OTAHelpers::configureTlsClient(client, CA_CERT_BUNDLE_OTA, config_manager.getTlsVerify(), update_url);

    HTTPClient http;
    http.begin(client, update_url);
    OTAHelpers::configureHttpClient(http);
    http.addHeader("Accept", "application/vnd.github.v3+json");

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] Failed to check for updates: %d\n", httpCode);
        RLOG_ERROR("ota", "Failed to check for updates: HTTP %d", httpCode);
        http.end();
        return false;
    }

    String response = http.getString();
    http.end();

    // Parse GitHub releases response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (error) {
        Serial.printf("[OTA] Failed to parse response: %s\n", error.c_str());
        return false;
    }

    // Extract version from tag_name
    String tag = doc["tag_name"].as<String>();
    latest_version = extractVersion(tag);

    firmware_url = "";
    littlefs_url = "";

    // Find firmware + filesystem assets in release
    JsonArray assets = doc["assets"].as<JsonArray>();
    if (!selectReleaseAssets(assets)) {
        Serial.println("[OTA] Missing firmware or LittleFS asset in release");
        return false;
    }

    // Compare versions
    update_available = compareVersions(latest_version, current_version);

    if (update_available) {
        Serial.printf("[OTA] Update available: %s -> %s\n",
                      current_version.c_str(), latest_version.c_str());
    } else {
        Serial.println("[OTA] Already on latest version");
    }

    return true;  // Successfully checked (even if no update available)
}

bool OTAManager::performUpdate() {
    if (!update_available) {
        Serial.println("[OTA] No update available");
        return false;
    }

    RLOG_INFO("OTA", "Starting update from %s to %s", current_version.c_str(), latest_version.c_str());

    // Web assets are now embedded in firmware - only need to download firmware.bin
    // No more LMWB bundles or separate LittleFS downloads needed
    if (!firmware_url.isEmpty()) {
        Serial.println("[OTA] Downloading firmware (web assets embedded)");
        if (!downloadAndInstallBinary(firmware_url, U_FLASH, "firmware")) {
            RLOG_ERROR("OTA", "Firmware download/install failed");
            return false;
        }
    } else if (!bundle_url.isEmpty()) {
        // Legacy fallback: support old LMWB bundles for transition period
        Serial.println("[OTA] Using legacy LMWB bundle for update");
        if (!downloadAndInstallBundle(bundle_url)) {
            RLOG_ERROR("OTA", "Bundle download/install failed");
            return false;
        }
    } else {
        Serial.println("[OTA] Missing firmware URL");
        RLOG_ERROR("OTA", "No firmware URL available for update");
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

bool OTAManager::selectReleaseAssets(const JsonArray& assets) {
    int bundle_priority = 0;
    int firmware_priority = 0;
    int littlefs_priority = 0;

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

        // Check for LMWB bundle file (firmware-ota-*.bin) - PREFERRED
        if (name_lower.indexOf("firmware") >= 0 && name_lower.indexOf("ota") >= 0) {
            int priority = 0;
            #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 200;
            }
            #else
            if (name_lower.indexOf("esp32") >= 0 &&
                name_lower.indexOf("esp32s3") < 0 &&
                name_lower.indexOf("esp32-s3") < 0) {
                priority = 200;
            }
            #endif
            if (priority > bundle_priority) {
                bundle_priority = priority;
                bundle_url = download;
                Serial.printf("[OTA] Found bundle: %s (priority %d)\n", name.c_str(), priority);
            }
            continue;
        }

        // Fallback: separate littlefs file
        if (name_lower.indexOf("littlefs") >= 0 || name_lower.indexOf("spiffs") >= 0) {
            int priority = 0;
            #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 200;
            }
            #else
            if (name_lower.indexOf("esp32") >= 0 &&
                name_lower.indexOf("esp32s3") < 0 &&
                name_lower.indexOf("esp32-s3") < 0) {
                priority = 200;
            }
            #endif
            if (name_lower == "littlefs.bin" || name_lower == "spiffs.bin") {
                priority = max(priority, 50);
            }
            if (priority > littlefs_priority) {
                littlefs_priority = priority;
                littlefs_url = download;
            }
            continue;
        }

        // Fallback: separate firmware file
        if (name_lower.indexOf("firmware") >= 0) {
            int priority = 0;
            #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 200;
            }
            #else
            if (name_lower.indexOf("esp32") >= 0 &&
                name_lower.indexOf("esp32s3") < 0 &&
                name_lower.indexOf("esp32-s3") < 0) {
                priority = 200;
            }
            #endif
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
        Serial.printf("[OTA] Using firmware: %s\n", firmware_url.c_str());
        littlefs_url = "";  // Clear - no longer needed
        return true;
    }

    // Legacy fallback: use bundle if firmware-only not available
    if (bundle_priority > 0) {
        Serial.printf("[OTA] Using legacy bundle: %s\n", bundle_url.c_str());
        return true;
    }

    return false;
}

bool OTAManager::downloadAndInstallBinary(const String& url, int update_type, const char* label) {
    Serial.printf("[OTA] Downloading %s from %s\n", label, url.c_str());

    // Safety disconnect: ensure realtime is not running during OTA
    // The WebSocket competes for heap and network bandwidth, causing stream timeouts
    if (supabaseRealtime.isConnected() || supabaseRealtime.isConnecting()) {
        Serial.println("[OTA] Safety disconnect: stopping realtime for OTA");
        supabaseRealtime.disconnect();
    }
    // Defer realtime reconnection for 10 minutes to cover entire OTA process
    app_state.realtime_defer_until = millis() + 600000UL;

    Serial.printf("[OTA] Heap before download: %lu bytes\n", (unsigned long)ESP.getFreeHeap());

    // Disable watchdog for OTA
    OTAHelpers::disableWatchdogForOTA();

    WiFiClientSecure client;
    OTAHelpers::configureTlsClient(client, CA_CERT_BUNDLE_OTA, config_manager.getTlsVerify(), url);

    HTTPClient http;
    http.begin(client, url);
    OTAHelpers::configureHttpClient(http);

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] %s download failed: %d\n", label, httpCode);
        RLOG_ERROR("ota", "%s download failed: HTTP %d", label, httpCode);
        http.end();
        return false;
    }

    int contentLength = http.getSize();
    Serial.printf("[OTA] %s size: %d bytes\n", label, contentLength);

    if (contentLength <= 0) {
        Serial.printf("[OTA] Invalid content length for %s\n", label);
        http.end();
        return false;
    }

#ifndef NATIVE_BUILD
    const esp_partition_t* target_partition = nullptr;
    if (update_type == U_FLASH) {
        target_partition = esp_ota_get_next_update_partition(nullptr);
        if (!target_partition) {
            Serial.println("[OTA] No OTA partition available (missing ota_1?)");
            http.end();
            return false;
        }
        Serial.printf("[OTA] Target partition: %s (%d bytes)\n",
                      target_partition->label, target_partition->size);
        if (static_cast<size_t>(contentLength) > target_partition->size) {
            Serial.printf("[OTA] %s too large for partition (%d > %d)\n",
                          label, contentLength, target_partition->size);
            http.end();
            return false;
        }
    }
#endif

    if (update_type == U_SPIFFS) {
        LittleFS.end();
    }

#ifndef NATIVE_BUILD
    // For firmware updates, explicitly target the OTA partition using the partition label
    // This ensures we NEVER overwrite the factory/bootstrap partition
    if (update_type == U_FLASH && target_partition) {
        const char* ota_label = target_partition->label;
        Serial.printf("[OTA] Using explicit partition label: %s\n", ota_label);
        if (!Update.begin(contentLength, update_type, -1, LOW, ota_label)) {
            Serial.printf("[OTA] Not enough space for %s: %s\n", label, Update.errorString());
            http.end();
            return false;
        }
    } else {
        if (!Update.begin(contentLength, update_type)) {
            Serial.printf("[OTA] Not enough space for %s: %s\n", label, Update.errorString());
            http.end();
            return false;
        }
    }
#else
    if (!Update.begin(contentLength, update_type)) {
        Serial.printf("[OTA] Not enough space for %s: %s\n", label, Update.errorString());
        http.end();
        return false;
    }
#endif

    Serial.printf("[OTA] Flashing %s...\n", label);

    // Use chunked download with watchdog feeding to prevent timeout
    // Move buffer to heap to avoid stack overflow (4KB is too large for stack)
    uint8_t* buffer = (uint8_t*)malloc(4096);
    if (!buffer) {
        Serial.printf("[OTA] Failed to allocate download buffer for %s\n", label);
        RLOG_ERROR("ota", "Failed to allocate buffer for %s", label);
        Update.abort();
        http.end();
        return false;
    }
    
    WiFiClient* stream = http.getStreamPtr();
    if (!stream) {
        Serial.printf("[OTA] Failed to get stream for %s\n", label);
        free(buffer);
        http.end();
        return false;
    }
    
    // Define write callback for Update.write
    auto writeCallback = [&label](const uint8_t* data, size_t len) -> size_t {
        // Update.write expects non-const pointer, but doesn't modify the data
        size_t written = Update.write(const_cast<uint8_t*>(data), len);
        if (written != len) {
            Serial.printf("[OTA] Write failed: wrote %zu of %zu bytes\n", written, len);
        }
        return written;
    };

    // Define progress callback for display updates
    auto progressCallback = [this, &label, update_type](int progress) {
        Serial.printf("[OTA] %s: %d%%\n", label, progress);

        // Update display with progress
        // Firmware takes 0-85%, LittleFS takes 85-100% (since LittleFS is much smaller)
        int displayProgress = (update_type == U_FLASH) ?
            (progress * 85) / 100 : 85 + ((progress * 15) / 100);
        String statusText = String(label) + " " + String(progress) + "%";
        matrix_display.showUpdatingProgress(latest_version, displayProgress, statusText);
    };

    // Use helper to download stream
    size_t written = OTAHelpers::downloadStream(stream, buffer, 4096, 
                                                 contentLength, writeCallback, progressCallback);

    if (written != static_cast<size_t>(contentLength)) {
        Serial.printf("[OTA] Written only %zu of %d bytes for %s\n", written, contentLength, label);
        Update.abort();
        free(buffer);
        http.end();
        return false;
    }
    
    // Free buffer after successful download
    free(buffer);

    if (!Update.end()) {
        Serial.printf("[OTA] %s update failed: %s\n", label, Update.errorString());
        RLOG_ERROR("ota", "%s update failed: %s", label, Update.errorString());
        http.end();
        return false;
    }

#ifndef NATIVE_BUILD
    if (update_type == U_FLASH && target_partition) {
        esp_err_t err = esp_ota_set_boot_partition(target_partition);
        if (err != ESP_OK) {
            Serial.printf("[OTA] Failed to set boot partition: %s\n", esp_err_to_name(err));
            RLOG_ERROR("ota", "Failed to set boot partition: %s", esp_err_to_name(err));
            http.end();
            return false;
        }
        Serial.printf("[OTA] Boot partition set to %s\n", target_partition->label);

        // Store the version for this partition in NVS for future display
        extern ConfigManager config_manager;
        config_manager.setPartitionVersion(String(target_partition->label), latest_version);
    }
#endif

    http.end();
    Serial.printf("[OTA] %s update applied\n", label);
    return true;
}

bool OTAManager::downloadAndInstallBundle(const String& url) {
    Serial.printf("[OTA] Downloading LMWB bundle from %s\n", url.c_str());

    // Disable watchdog for OTA
    OTAHelpers::disableWatchdogForOTA();

    WiFiClientSecure client;
    OTAHelpers::configureTlsClient(client, CA_CERT_BUNDLE_OTA, config_manager.getTlsVerify(), url);

    HTTPClient http;
    http.begin(client, url);
    OTAHelpers::configureHttpClient(http);

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] Bundle download failed: %d\n", httpCode);
        RLOG_ERROR("ota", "Bundle download failed: HTTP %d", httpCode);
        http.end();
        return false;
    }

    int contentLength = http.getSize();
    Serial.printf("[OTA] Bundle size: %d bytes\n", contentLength);

    if (contentLength <= 16) {
        Serial.println("[OTA] Bundle too small for valid LMWB format");
        http.end();
        return false;
    }

    WiFiClient* stream = http.getStreamPtr();
    if (!stream) {
        Serial.println("[OTA] Failed to get stream for bundle");
        http.end();
        return false;
    }

    // Read LMWB header (16 bytes) using helper
    uint8_t header[16];
    if (!OTAHelpers::readExactBytes(stream, header, 16)) {
        Serial.println("[OTA] Timeout reading bundle header");
        http.end();
        return false;
    }

    // Verify LMWB magic
    if (header[0] != 'L' || header[1] != 'M' || header[2] != 'W' || header[3] != 'B') {
        Serial.println("[OTA] Invalid bundle magic - not LMWB format");
        http.end();
        return false;
    }

    // Parse header (little-endian)
    size_t app_size = static_cast<size_t>(header[4]) |
                      (static_cast<size_t>(header[5]) << 8) |
                      (static_cast<size_t>(header[6]) << 16) |
                      (static_cast<size_t>(header[7]) << 24);
    size_t fs_size = static_cast<size_t>(header[8]) |
                     (static_cast<size_t>(header[9]) << 8) |
                     (static_cast<size_t>(header[10]) << 16) |
                     (static_cast<size_t>(header[11]) << 24);

    Serial.printf("[OTA] Bundle: app=%u bytes, fs=%u bytes\n",
                  static_cast<unsigned>(app_size), static_cast<unsigned>(fs_size));

    // Validate sizes
    if (app_size == 0 || fs_size == 0) {
        Serial.println("[OTA] Invalid bundle sizes");
        http.end();
        return false;
    }

    size_t expected_total = 16 + app_size + fs_size;
    if (contentLength > 0 && static_cast<size_t>(contentLength) != expected_total) {
        Serial.printf("[OTA] Bundle size mismatch: got %d, expected %u\n",
                      contentLength, static_cast<unsigned>(expected_total));
        // Continue anyway - content-length might be missing for chunked transfer
    }

#ifndef NATIVE_BUILD
    // Get target partition for app
    const esp_partition_t* target_partition = esp_ota_get_next_update_partition(nullptr);
    if (!target_partition) {
        Serial.println("[OTA] No OTA partition available");
        http.end();
        return false;
    }
    Serial.printf("[OTA] Target partition: %s (%d bytes)\n",
                  target_partition->label, target_partition->size);

    if (app_size > target_partition->size) {
        Serial.printf("[OTA] App too large for partition (%u > %d)\n",
                      static_cast<unsigned>(app_size), target_partition->size);
        http.end();
        return false;
    }
#endif

    // =========== PHASE 1: Flash firmware ===========
    Serial.println("[OTA] Flashing firmware...");
    matrix_display.showUpdatingProgress(latest_version, 0, "Flashing firmware...");

#ifndef NATIVE_BUILD
    const char* ota_label = target_partition->label;
    if (!Update.begin(app_size, U_FLASH, -1, LOW, ota_label)) {
        Serial.printf("[OTA] Update.begin app failed: %s\n", Update.errorString());
        http.end();
        return false;
    }
#else
    if (!Update.begin(app_size, U_FLASH)) {
        Serial.printf("[OTA] Update.begin app failed: %s\n", Update.errorString());
        http.end();
        return false;
    }
#endif

    // Move buffer to heap to reduce stack usage (2KB is too large for stack)
    uint8_t* buffer = (uint8_t*)malloc(2048);
    if (!buffer) {
        Serial.println("[OTA] Failed to allocate download buffer");
        Update.abort();
        http.end();
        return false;
    }
    
    size_t app_written = 0;
    int lastProgress = -1;

    // Warn if heap is getting low
    if (ESP.getFreeHeap() < 80000) {
        Serial.printf("[OTA] WARNING: Low heap before firmware download: %u bytes\n", ESP.getFreeHeap());
    }

    unsigned long lastDataTime = millis();

    while (app_written < app_size) {
#ifndef NATIVE_BUILD
        vTaskDelay(pdMS_TO_TICKS(1));  // Minimal yield
#else
        yield();
#endif
        size_t available = stream->available();
        if (available == 0) {
            // Check if connection is still alive
            if (!stream->connected()) {
                Serial.printf("[OTA] Stream disconnected during firmware at %d%% (%u/%u bytes)\n",
                              (app_written * 100) / app_size,
                              static_cast<unsigned>(app_written),
                              static_cast<unsigned>(app_size));
                Serial.flush();
                Update.abort();
                free(buffer);
                http.end();
                return false;
            }

            // Check for timeout
            if (millis() - lastDataTime > 60000) {
                Serial.printf("[OTA] Stream timeout at %d%% - no data for 60s\n",
                              (app_written * 100) / app_size);
                Serial.flush();
                Update.abort();
                free(buffer);
                http.end();
                return false;
            }

#ifndef NATIVE_BUILD
            vTaskDelay(pdMS_TO_TICKS(10));
#else
            delay(10);
#endif
            continue;
        }

        lastDataTime = millis();  // Reset timeout on data received

        size_t remaining = app_size - app_written;
        size_t toRead = min(min(available, sizeof(buffer)), remaining);

        unsigned long readStart = millis();
        int bytesRead = stream->readBytes(buffer, toRead);
        unsigned long readTime = millis() - readStart;

        // Warn if read is taking too long (possible SSL stall)
        if (readTime > 1000) {
            Serial.printf("[OTA] WARNING: Slow read: %lu ms for %d bytes\n", readTime, bytesRead);
        }

        if (bytesRead > 0) {
            unsigned long writeStart = millis();
            size_t bytesWritten = Update.write(buffer, bytesRead);
            unsigned long writeTime = millis() - writeStart;

            // Warn if write is taking too long
            if (writeTime > 500) {
                Serial.printf("[OTA] WARNING: Slow write: %lu ms for %u bytes\n", writeTime, bytesWritten);
            }

            if (bytesWritten != static_cast<size_t>(bytesRead)) {
                Serial.printf("[OTA] App write failed: wrote %d of %d\n", bytesWritten, bytesRead);
                Update.abort();
                free(buffer);
                http.end();
                return false;
            }
            app_written += bytesWritten;

            int progress = (app_written * 100) / app_size;
            if (progress / 5 > lastProgress / 5) {
                lastProgress = progress;
                uint32_t freeHeap = ESP.getFreeHeap();
                Serial.printf("[OTA] firmware: %d%% (heap: %u, last read: %lums)\n", progress, freeHeap, readTime);
                Serial.flush();

                // Check for critically low heap
                if (freeHeap < 50000) {
                    Serial.println("[OTA] CRITICAL: Heap too low, aborting update");
                    Update.abort();
                    free(buffer);
                    http.end();
                    return false;
                }

                int displayProgress = (progress * 85) / 100;
                matrix_display.showUpdatingProgress(latest_version, displayProgress,
                    String("Firmware ") + String(progress) + "%");
            }
        }
    }

    if (app_written != app_size) {
        Serial.printf("[OTA] App incomplete: wrote %u of %u\n",
                      static_cast<unsigned>(app_written), static_cast<unsigned>(app_size));
        Update.abort();
        free(buffer);
        http.end();
        return false;
    }
    
    // Free buffer after firmware phase complete
    free(buffer);
    buffer = nullptr;

    Serial.println("[OTA] Firmware write complete, finalizing...");
    Serial.flush();
    vTaskDelay(pdMS_TO_TICKS(10));  // Brief yield before Update.end

    if (!Update.end(true)) {
        Serial.printf("[OTA] App update failed: %s\n", Update.errorString());
        http.end();
        return false;
    }

    Serial.println("[OTA] Update.end() succeeded");
    Serial.flush();

#ifndef NATIVE_BUILD
    vTaskDelay(pdMS_TO_TICKS(10));  // Yield before partition operation

    // Set boot partition
    Serial.println("[OTA] Setting boot partition...");
    Serial.flush();

    esp_err_t err = esp_ota_set_boot_partition(target_partition);
    if (err != ESP_OK) {
        Serial.printf("[OTA] Failed to set boot partition: %s\n", esp_err_to_name(err));
        RLOG_ERROR("ota", "Failed to set boot partition: %s", esp_err_to_name(err));
        http.end();
        return false;
    }
    Serial.printf("[OTA] Boot partition set to %s\n", target_partition->label);

    // Store the version for this partition in NVS for future display
    extern ConfigManager config_manager;
    config_manager.setPartitionVersion(String(target_partition->label), latest_version);
#endif
    Serial.flush();

    Serial.println("[OTA] Firmware complete, flashing filesystem...");
    Serial.flush();

    // =========== PHASE 2: Flash filesystem ===========
    matrix_display.showUpdatingProgress(latest_version, 85, "Flashing filesystem...");

    // Check if HTTP stream is still valid before proceeding
    if (!stream->connected()) {
        Serial.println("[OTA] ERROR: HTTP stream disconnected before filesystem phase");
        http.end();
        return false;
    }
    Serial.printf("[OTA] Stream still connected, %d bytes remaining for FS\n", fs_size);

    LittleFS.end();
    Serial.println("[OTA] LittleFS unmounted");

    if (!Update.begin(fs_size, U_SPIFFS)) {
        Serial.printf("[OTA] Update.begin FS failed: %s\n", Update.errorString());
        http.end();
        return false;
    }
    Serial.println("[OTA] Update.begin FS succeeded");

    // Allocate buffer for filesystem phase
    buffer = (uint8_t*)malloc(2048);
    if (!buffer) {
        Serial.println("[OTA] Failed to allocate FS buffer");
        Update.abort();
        http.end();
        return false;
    }
    
    // Define write callback for Update.write
    auto fsWriteCallback = [](const uint8_t* data, size_t len) -> size_t {
        // Update.write expects non-const pointer, but doesn't modify the data
        size_t written = Update.write(const_cast<uint8_t*>(data), len);
        if (written != len) {
            Serial.printf("[OTA] FS write failed: wrote %zu of %zu bytes\n", written, len);
        }
        return written;
    };

    // Define progress callback for display updates
    auto fsProgressCallback = [this](int progress) {
        Serial.printf("[OTA] filesystem: %d%%\n", progress);
        int displayProgress = 85 + ((progress * 15) / 100);
        matrix_display.showUpdatingProgress(latest_version, displayProgress,
            String("Filesystem ") + String(progress) + "%");
    };

    // Use helper to download filesystem
    size_t fs_written = OTAHelpers::downloadStream(stream, buffer, 2048, 
                                                    fs_size, fsWriteCallback, fsProgressCallback);

    if (fs_written != fs_size) {
        Serial.printf("[OTA] FS incomplete: wrote %zu of %zu\n", fs_written, fs_size);
        Update.abort();
        free(buffer);
        http.end();
        return false;
    }
    
    // Free buffer after filesystem phase complete
    free(buffer);

    if (!Update.end(true)) {
        Serial.printf("[OTA] FS update failed: %s\n", Update.errorString());
        http.end();
        return false;
    }

    http.end();
    Serial.println("[OTA] Bundle update complete");
    return true;
}
