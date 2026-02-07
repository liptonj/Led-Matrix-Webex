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
#include "../debug/log_system.h"
#include "../app_state.h"
#include "../display/matrix_display.h"
#include "../common/ca_certs.h"
#include "../core/dependencies.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFi.h>
#include <Update.h>
#include <LittleFS.h>

static const char* TAG = "OTA_DL";

bool OTAManager::downloadAndInstallBinary(const String& url, int update_type, const char* label) {
    auto& deps = getDependencies();
    ESP_LOGI(TAG, "Downloading %s from %s", label, url.c_str());
    const bool remote_logging_was_enabled = log_system_is_remote_enabled();
    log_system_set_suppressed(true);

    // Safety disconnect: ensure realtime is not running during OTA
    // The WebSocket competes for heap and network bandwidth, causing stream timeouts
    if (deps.realtime.isConnected() || deps.realtime.isConnecting()) {
        ESP_LOGI(TAG, "Safety disconnect: stopping realtime for OTA");
        deps.realtime.disconnect();
    }
    // Defer realtime reconnection for 10 minutes to cover entire OTA process
    deps.app_state.realtime_defer_until = millis() + 600000UL;

    ESP_LOGI(TAG, "Heap before download: %lu bytes", (unsigned long)ESP.getFreeHeap());

    // Disable watchdog for OTA
    OTAHelpers::disableWatchdogForOTA();

    WiFiClientSecure client;
    OTAHelpers::configureTlsClient(client, CA_CERT_BUNDLE_OTA, deps.config.getTlsVerify(), url);

    HTTPClient http;
    http.begin(client, url);
    OTAHelpers::configureHttpClient(http);

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        ESP_LOGE(TAG, "%s download failed: %d", label, httpCode);
        http.end();
        client.stop();
        log_system_set_suppressed(false);
        return false;
    }

    int contentLength = http.getSize();
    ESP_LOGI(TAG, "%s size: %d bytes", label, contentLength);

    if (contentLength <= 0) {
        ESP_LOGE(TAG, "Invalid content length for %s", label);
        http.end();
        client.stop();
        log_system_set_suppressed(false);
        return false;
    }

#ifndef NATIVE_BUILD
    const esp_partition_t* target_partition = nullptr;
    if (update_type == U_FLASH) {
        target_partition = OTAManagerFlash::getTargetPartition();
        if (!target_partition) {
            ESP_LOGE(TAG, "No OTA partition available (missing ota_1?)");
            http.end();
            client.stop();
            log_system_set_suppressed(false);
            return false;
        }
        ESP_LOGI(TAG, "Target partition: %s (%d bytes)",
                 target_partition->label, target_partition->size);
        if (static_cast<size_t>(contentLength) > target_partition->size) {
            ESP_LOGE(TAG, "%s too large for partition (%d > %d)",
                     label, contentLength, target_partition->size);
            http.end();
            client.stop();
            log_system_set_suppressed(false);
            return false;
        }
    }
#endif

    if (update_type == U_SPIFFS) {
        LittleFS.end();
    }

    // Begin update using flash helper
    if (!OTAManagerFlash::beginUpdate(contentLength, update_type, target_partition)) {
        ESP_LOGE(TAG, "Not enough space for %s", label);
        http.end();
        client.stop();
        log_system_set_suppressed(false);
        return false;
    }

    ESP_LOGI(TAG, "Flashing %s...", label);

    // Use chunked download with watchdog feeding to prevent timeout
    // Move buffer to heap to avoid stack overflow (2KB reduces heap pressure)
    uint8_t* buffer = (uint8_t*)malloc(2048);
    if (!buffer) {
        ESP_LOGE(TAG, "Failed to allocate download buffer for %s", label);
        Update.abort();
        http.end();
        client.stop();
        log_system_set_suppressed(false);
        return false;
    }
    
    WiFiClient* stream = http.getStreamPtr();
    if (!stream) {
        ESP_LOGE(TAG, "Failed to get stream for %s", label);
        free(buffer);
        http.end();
        client.stop();
        log_system_set_suppressed(false);
        return false;
    }
    
    // Define write callback for Update.write
    auto writeCallback = [&label](const uint8_t* data, size_t len) -> size_t {
        // Update.write expects non-const pointer, but doesn't modify the data
        size_t written = Update.write(const_cast<uint8_t*>(data), len);
        if (written != len) {
            ESP_LOGE(TAG, "Write failed: wrote %zu of %zu bytes", written, len);
        }
        return written;
    };

    // Define progress callback for display updates
    auto progressCallback = [this, &label, update_type, &deps](int progress) {
        ESP_LOGI(TAG, "%s: %d%%", label, progress);

        // Update display with progress
        // Firmware takes 0-85%, LittleFS takes 85-100% (since LittleFS is much smaller)
        int displayProgress = (update_type == U_FLASH) ?
            (progress * 85) / 100 : 85 + ((progress * 15) / 100);
        static const String empty_status;
        deps.display.showUpdatingProgress(latest_version, displayProgress, empty_status);
    };

    // Use helper to download stream with retry logic
    size_t written = 0;
    int retry_count = 0;

    while (retry_count <= OTAHelpers::MAX_RETRY_ATTEMPTS) {
        written = OTAHelpers::downloadStream(stream, buffer, 2048,
                                              contentLength, writeCallback, progressCallback);
        
        if (written == static_cast<size_t>(contentLength)) {
            break;  // Success
        }
        
        if (!OTAHelpers::shouldRetry(written, contentLength)) {
            ESP_LOGE(TAG, "Download failed at %zu bytes, not retryable", written);
            break;
        }
        
        retry_count++;
        if (retry_count > OTAHelpers::MAX_RETRY_ATTEMPTS) {
            ESP_LOGE(TAG, "Max retries (%d) exceeded", OTAHelpers::MAX_RETRY_ATTEMPTS);
            break;
        }
        
        // Check WiFi before retry
        if (WiFi.status() != WL_CONNECTED) {
            ESP_LOGE(TAG, "WiFi disconnected, cannot retry");
            break;
        }
        
        int delay_ms = OTAHelpers::getRetryDelay(retry_count - 1);
        ESP_LOGW(TAG, "Retry %d/%d in %dms (got %zu/%d bytes)",
                 retry_count, OTAHelpers::MAX_RETRY_ATTEMPTS, delay_ms, written, contentLength);
        
        Update.abort();
        
        // Log heap after abort to verify cleanup
        ESP_LOGI(TAG, "Heap after abort: %lu bytes", (unsigned long)ESP.getFreeHeap());
        
        http.end();
        client.stop();

        vTaskDelay(pdMS_TO_TICKS(delay_ms));

        if (!http.begin(client, url)) {
            ESP_LOGE(TAG, "Retry HTTP begin failed");
            break;
        }
        OTAHelpers::configureHttpClient(http);
        int retryCode = http.GET();
        if (retryCode != HTTP_CODE_OK) {
            ESP_LOGE(TAG, "Retry HTTP failed: %d", retryCode);
            http.end();
            client.stop();
            break;
        }
        stream = http.getStreamPtr();
        if (!stream) {
            ESP_LOGE(TAG, "Failed to get stream on retry");
            http.end();
            client.stop();
            break;
        }
        if (!OTAManagerFlash::beginUpdate(contentLength, update_type, target_partition)) {
            ESP_LOGE(TAG, "Not enough space for %s (retry)", label);
            http.end();
            client.stop();
            break;
        }
    }

    if (written != static_cast<size_t>(contentLength)) {
        ESP_LOGE(TAG, "Written only %zu of %d bytes for %s", written, contentLength, label);
        Update.abort();
        free(buffer);
        http.end();
        client.stop();
        log_system_set_suppressed(false);
        return false;
    }
    
    // Free buffer after successful download
    free(buffer);

    // Finalize update using flash helper
    if (!OTAManagerFlash::finalizeUpdate(update_type, target_partition, latest_version)) {
        ESP_LOGE(TAG, "%s update failed", label);
        http.end();
        client.stop();
        Update.abort();
        log_system_set_suppressed(false);
        return false;
    }

    http.end();
    client.stop();
    ESP_LOGI(TAG, "%s update applied", label);
    log_system_set_suppressed(false);
    return true;
}
