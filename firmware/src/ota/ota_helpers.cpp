/**
 * @file ota_helpers.cpp
 * @brief OTA Helper Functions Implementation
 * 
 * Implementation of OTA helper functions extracted from header to reduce
 * code duplication across translation units.
 */

#include "ota_helpers.h"

#ifndef NATIVE_BUILD
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <Update.h>
#else
#include "WiFiClientSecure.h"
#endif
#include "../common/heap_utils.h"
#include "../common/secure_client_config.h"
#include "../debug/log_system.h"
#include <Arduino.h>
#include <WiFi.h>

static const char* TAG = "OTA_HELP";

namespace OTAHelpers {

void disableWatchdogForOTA() {
#ifndef NATIVE_BUILD
    // First, delete the current task from WDT (if subscribed)
    esp_err_t err = esp_task_wdt_delete(nullptr);  // nullptr = current task
    if (err != ESP_OK && err != ESP_ERR_NOT_FOUND) {
        ESP_LOGW(TAG, "Warning: Failed to delete current task from WDT: %s", esp_err_to_name(err));
    }

    // Delete async_tcp task from WDT if it exists
    // This task is created by the AsyncTCP library and may be subscribed to WDT
    TaskHandle_t async_tcp_task = xTaskGetHandle("async_tcp");
    if (async_tcp_task != nullptr) {
        err = esp_task_wdt_delete(async_tcp_task);
        if (err == ESP_OK) {
            ESP_LOGD(TAG, "Removed async_tcp task from watchdog");
        } else if (err != ESP_ERR_NOT_FOUND) {
            ESP_LOGW(TAG, "Warning: Failed to delete async_tcp from WDT: %s", esp_err_to_name(err));
        }
    }

    // Delete IDLE tasks from WDT (they are subscribed by default)
    TaskHandle_t idle0 = xTaskGetIdleTaskHandleForCPU(0);
    TaskHandle_t idle1 = xTaskGetIdleTaskHandleForCPU(1);
    if (idle0) esp_task_wdt_delete(idle0);
    if (idle1) esp_task_wdt_delete(idle1);

    // Now we can safely reconfigure WDT with longer timeout
    err = esp_task_wdt_deinit();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Warning: WDT deinit failed: %s (continuing anyway)", esp_err_to_name(err));
    }

    // Reinitialize WDT with longer timeout for OTA (120s, no panic, don't subscribe IDLE)
    err = esp_task_wdt_init(120, false);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Warning: WDT init failed: %s", esp_err_to_name(err));
    } else {
        ESP_LOGI(TAG, "Task watchdog reconfigured for update (120s timeout)");
    }
#endif
}

void configureHttpClient(HTTPClient& http) {
    // Enable following redirects - required for GitHub release downloads
    // GitHub redirects asset URLs to CDN (returns 302)
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(30000);  // 30 second timeout for large downloads
    http.addHeader("User-Agent", "ESP32-Webex-Display");
}

void configureTlsClient(WiFiClientSecure& client, const char* ca_cert_bundle,
                        bool tls_verify, const String& url) {
    ESP_LOGD(TAG, "TLS context: url=%s time=%lu heap=%lu verify=%s",
             url.c_str(), (unsigned long)time(nullptr), ESP.getFreeHeap(),
             tls_verify ? "on" : "off");

    // Use existing secure client configuration helper
    // Reduced buffer sizes to minimize heap usage during OTA:
    // rx=512 (receive buffer, default is 512), tx=4096 (transmit buffer, reduced from default 16KB)
    configureSecureClientWithTls(client, ca_cert_bundle, tls_verify, 512, 4096);
}

size_t downloadStream(WiFiClient* stream, uint8_t* buffer, size_t buffer_size,
                     size_t content_length,
                     std::function<size_t(const uint8_t*, size_t)> write_callback,
                     std::function<void(int)> progress_callback) {
    if (!stream) {
        ESP_LOGE(TAG, "Invalid stream pointer");
        return 0;
    }

    size_t total_written = 0;
    int last_progress = -1;

    while (total_written < content_length) {
        // Yield to other FreeRTOS tasks - use proper delay to allow async_tcp task to run
#ifndef NATIVE_BUILD
        vTaskDelay(pdMS_TO_TICKS(5));  // 5ms delay to properly yield to other tasks
#else
        yield();
#endif

        size_t available = stream->available();
        if (available == 0) {
            // Wait for more data with timeout
            unsigned long wait_start = millis();
            while (stream->available() == 0 && stream->connected()) {
                if (millis() - wait_start > 60000) {  // 60 second timeout
                    ESP_LOGE(TAG, "Stream timeout waiting for data (60s)");
                    return total_written;
                }
#ifndef NATIVE_BUILD
                vTaskDelay(pdMS_TO_TICKS(20));  // Wait 20ms, yield to other tasks
#else
                delay(20);
#endif
            }
            available = stream->available();
        }

        if (available == 0 && !stream->connected()) {
            break;  // Connection closed
        }

        size_t to_read = min(available, buffer_size);
        if (to_read > buffer_size) {
            ESP_LOGW(TAG, "Buffer overflow prevented: toRead=%zu > buffer=%zu", 
                     to_read, buffer_size);
            return total_written;
        }

        unsigned long read_start = millis();
        int bytes_read = stream->readBytes(buffer, to_read);
        unsigned long read_time = millis() - read_start;
        if (read_time > 1000) {
            ESP_LOGW(TAG, "WARNING: Slow read: %lu ms for %d bytes", read_time, bytes_read);
        }

        if (bytes_read > 0) {
            unsigned long write_start = millis();
            size_t bytes_written = write_callback(buffer, bytes_read);
            unsigned long write_time = millis() - write_start;
            if (write_time > 500) {
                ESP_LOGW(TAG, "WARNING: Slow write: %lu ms for %zu bytes", write_time, bytes_written);
            }

            if (bytes_written != static_cast<size_t>(bytes_read)) {
                ESP_LOGE(TAG, "Write failed: wrote %zu of %d bytes", 
                        bytes_written, bytes_read);
                return total_written;
            }
            total_written += bytes_written;

            // Update progress every 5%
            if (progress_callback) {
                int progress = (total_written * 100) / content_length;
                if (progress / 5 > last_progress / 5) {
                    last_progress = progress;
                    progress_callback(progress);
                    
                    // Heap monitoring
                    uint32_t freeHeap = ESP.getFreeHeap();
                    uint32_t maxBlock = HeapUtils::getMaxAllocBlock();
                    ESP_LOGI(TAG, "%d%% complete, heap: %u bytes (block=%u)",
                             progress, freeHeap, maxBlock);
                    if (freeHeap < 30000 || (freeHeap < 50000 && maxBlock < 20000)) {
                        ESP_LOGE(TAG, "CRITICAL: Heap too low, aborting");
#ifndef NATIVE_BUILD
                        Update.abort();
#endif
                        return total_written;
                    }
                }
            }
        }
    }

    return total_written;
}

bool readExactBytes(WiFiClient* stream, uint8_t* buffer, size_t length, 
                   unsigned long timeout_ms) {
    if (!stream || !buffer) {
        return false;
    }

    size_t bytes_read = 0;
    unsigned long start_time = millis();

    while (bytes_read < length) {
        if (millis() - start_time > timeout_ms) {
            ESP_LOGE(TAG, "Timeout reading %zu bytes (got %zu)", length, bytes_read);
            return false;
        }

        if (stream->available()) {
            int chunk = stream->readBytes(buffer + bytes_read, length - bytes_read);
            if (chunk > 0) {
                bytes_read += chunk;
            }
        }

#ifndef NATIVE_BUILD
        vTaskDelay(pdMS_TO_TICKS(5));
#else
        delay(5);
#endif
    }

    return true;
}

}  // namespace OTAHelpers
