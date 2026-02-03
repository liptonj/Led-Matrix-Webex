/**
 * @file ota_bundle.cpp
 * @brief LMWB Bundle Handling for OTA Updates
 * 
 * This file handles downloading and installing LMWB (Led Matrix Webex Bundle)
 * format files, which contain both firmware and filesystem images in a single
 * file with a custom header format.
 */

#include "ota_manager.h"
#include "ota_helpers.h"
#include "ota_flash.h"
#include "../config/config_manager.h"
#include "../common/ca_certs.h"
#include "../display/matrix_display.h"
#include "../debug/remote_logger.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include <LittleFS.h>
#ifndef NATIVE_BUILD
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif
#include <Arduino.h>

// External references
extern ConfigManager config_manager;
extern MatrixDisplay matrix_display;

namespace {
/**
 * @brief Parse LMWB bundle header (16 bytes)
 * @param header 16-byte header buffer
 * @param app_size Output: application size
 * @param fs_size Output: filesystem size
 * @return true if header is valid
 */
bool parseBundleHeader(const uint8_t* header, size_t& app_size, size_t& fs_size) {
    // Verify LMWB magic
    if (header[0] != 'L' || header[1] != 'M' || header[2] != 'W' || header[3] != 'B') {
        Serial.println("[OTA] Invalid bundle magic - not LMWB format");
        return false;
    }

    // Parse header (little-endian)
    app_size = static_cast<size_t>(header[4]) |
               (static_cast<size_t>(header[5]) << 8) |
               (static_cast<size_t>(header[6]) << 16) |
               (static_cast<size_t>(header[7]) << 24);
    fs_size = static_cast<size_t>(header[8]) |
              (static_cast<size_t>(header[9]) << 8) |
              (static_cast<size_t>(header[10]) << 16) |
              (static_cast<size_t>(header[11]) << 24);

    Serial.printf("[OTA] Bundle: app=%u bytes, fs=%u bytes\n",
                  static_cast<unsigned>(app_size), static_cast<unsigned>(fs_size));

    // Validate sizes
    if (app_size == 0 || fs_size == 0) {
        Serial.println("[OTA] Invalid bundle sizes");
        return false;
    }

    return true;
}
}  // namespace

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

    // Parse header
    size_t app_size = 0, fs_size = 0;
    if (!parseBundleHeader(header, app_size, fs_size)) {
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
    const esp_partition_t* target_partition = OTAManagerFlash::getTargetPartition();
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
#else
    const esp_partition_t* target_partition = nullptr;
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
        size_t toRead = min(min(available, static_cast<size_t>(2048)), remaining);

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
#ifndef NATIVE_BUILD
    vTaskDelay(pdMS_TO_TICKS(10));  // Brief yield before Update.end
#else
    delay(10);
#endif

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
