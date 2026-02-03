/**
 * @file ota_download.cpp
 * @brief OTA Download Logic
 * 
 * This file handles downloading firmware binaries from URLs and coordinating
 * with flash operations for installation.
 */

#include "ota_manager.h"
#include "ota_helpers.h"
#include "ota_flash.h"
#ifndef NATIVE_BUILD
#include <esp_ota_ops.h>
#include <esp_partition.h>
#endif
#include "../config/config_manager.h"
#include "../supabase/supabase_realtime.h"
#include "../debug/remote_logger.h"
#include "../app_state.h"
#include "../display/matrix_display.h"
#include "../common/ca_certs.h"
#include "../core/dependencies.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFi.h>
#include <Update.h>
#include <LittleFS.h>

bool OTAManager::downloadAndInstallBinary(const String& url, int update_type, const char* label) {
    auto& deps = getDependencies();
    Serial.printf("[OTA] Downloading %s from %s\n", label, url.c_str());

    // Safety disconnect: ensure realtime is not running during OTA
    // The WebSocket competes for heap and network bandwidth, causing stream timeouts
    if (deps.realtime.isConnected() || deps.realtime.isConnecting()) {
        Serial.println("[OTA] Safety disconnect: stopping realtime for OTA");
        deps.realtime.disconnect();
    }
    // Defer realtime reconnection for 10 minutes to cover entire OTA process
    deps.app_state.realtime_defer_until = millis() + 600000UL;

    Serial.printf("[OTA] Heap before download: %lu bytes\n", (unsigned long)ESP.getFreeHeap());

    // Disable watchdog for OTA
    OTAHelpers::disableWatchdogForOTA();

    WiFiClientSecure client;
    OTAHelpers::configureTlsClient(client, CA_CERT_BUNDLE_OTA, deps.config.getTlsVerify(), url);

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
        target_partition = OTAManagerFlash::getTargetPartition();
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

    // Begin update using flash helper
    if (!OTAManagerFlash::beginUpdate(contentLength, update_type, target_partition)) {
        Serial.printf("[OTA] Not enough space for %s\n", label);
        http.end();
        return false;
    }

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
    auto progressCallback = [this, &label, update_type, &deps](int progress) {
        Serial.printf("[OTA] %s: %d%%\n", label, progress);

        // Update display with progress
        // Firmware takes 0-85%, LittleFS takes 85-100% (since LittleFS is much smaller)
        int displayProgress = (update_type == U_FLASH) ?
            (progress * 85) / 100 : 85 + ((progress * 15) / 100);
        String statusText = String(label) + " " + String(progress) + "%";
        deps.display.showUpdatingProgress(latest_version, displayProgress, statusText);
    };

    // Use helper to download stream with retry logic
    size_t written = 0;
    int retry_count = 0;

    while (retry_count <= OTAHelpers::MAX_RETRY_ATTEMPTS) {
        written = OTAHelpers::downloadStream(stream, buffer, 4096, 
                                              contentLength, writeCallback, progressCallback);
        
        if (written == static_cast<size_t>(contentLength)) {
            break;  // Success
        }
        
        if (!OTAHelpers::shouldRetry(written, contentLength)) {
            Serial.printf("[OTA] Download failed at %zu bytes, not retryable\n", written);
            RLOG_ERROR("ota", "Download failed at %zu/%d bytes, not retryable", written, contentLength);
            break;
        }
        
        retry_count++;
        if (retry_count > OTAHelpers::MAX_RETRY_ATTEMPTS) {
            Serial.printf("[OTA] Max retries (%d) exceeded\n", OTAHelpers::MAX_RETRY_ATTEMPTS);
            RLOG_ERROR("ota", "OTA failed after %d retries at %zu/%d bytes", 
                       OTAHelpers::MAX_RETRY_ATTEMPTS, written, contentLength);
            break;
        }
        
        // Check WiFi before retry
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("[OTA] WiFi disconnected, cannot retry");
            RLOG_ERROR("ota", "WiFi disconnected during OTA at %zu bytes", written);
            break;
        }
        
        int delay_ms = OTAHelpers::getRetryDelay(retry_count - 1);
        Serial.printf("[OTA] Retry %d/%d in %dms (got %zu/%d bytes)\n",
                      retry_count, OTAHelpers::MAX_RETRY_ATTEMPTS, delay_ms, written, contentLength);
        RLOG_WARN("ota", "OTA retry %d/%d at %zu/%d bytes", 
                  retry_count, OTAHelpers::MAX_RETRY_ATTEMPTS, written, contentLength);
        
        Update.abort();
        
        // Log heap after abort to verify cleanup
        Serial.printf("[OTA] Heap after abort: %lu bytes\n", (unsigned long)ESP.getFreeHeap());
        
        vTaskDelay(pdMS_TO_TICKS(delay_ms));
        
        // NOTE: Full HTTP reconnect with Range header resume is out of scope.
        // For now, fail and let the main loop schedule a full OTA retry.
        break;
    }

    if (written != static_cast<size_t>(contentLength)) {
        Serial.printf("[OTA] Written only %zu of %d bytes for %s\n", written, contentLength, label);
        Update.abort();
        free(buffer);
        http.end();
        return false;
    }
    
    // Free buffer after successful download
    free(buffer);

    // Finalize update using flash helper
    if (!OTAManagerFlash::finalizeUpdate(update_type, target_partition, latest_version)) {
        Serial.printf("[OTA] %s update failed\n", label);
        http.end();
        return false;
    }

    http.end();
    Serial.printf("[OTA] %s update applied\n", label);
    return true;
}
