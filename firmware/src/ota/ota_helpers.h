/**
 * @file ota_helpers.h
 * @brief OTA Helper Functions
 * 
 * Extracted helper functions for OTA operations to improve code reusability
 * and reduce duplication in ota_manager.cpp
 */

#ifndef OTA_HELPERS_H
#define OTA_HELPERS_H

#include <Arduino.h>
#include <HTTPClient.h>
#ifndef NATIVE_BUILD
#include <WiFiClientSecure.h>
#include <Update.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#else
// Mock is in simulation/mocks/ which is in include path via -I flag
#include "WiFiClientSecure.h"
#endif
#include "../common/secure_client_config.h"
#include "../common/heap_utils.h"

namespace OTAHelpers {

// Retry configuration
static constexpr int MAX_RETRY_ATTEMPTS = 3;
static constexpr int INITIAL_RETRY_DELAY_MS = 2000;
static constexpr int MAX_RETRY_DELAY_MS = 15000;

// Check if download should be retried (partial download = retryable)
inline bool shouldRetry(size_t written, size_t expected) {
    return written > 0 && written < expected;
}

inline int getRetryDelay(int attempt) {
    int delay = INITIAL_RETRY_DELAY_MS * (1 << attempt);
    return min(delay, MAX_RETRY_DELAY_MS);
}

/**
 * @brief Disable and reconfigure watchdog for OTA operations
 * 
 * Unsubscribes all tasks from WDT and reconfigures with 120s timeout
 * to prevent resets during large file downloads.
 */
inline void disableWatchdogForOTA() {
#ifndef NATIVE_BUILD
    // First, delete the current task from WDT (if subscribed)
    esp_err_t err = esp_task_wdt_delete(nullptr);  // nullptr = current task
    if (err != ESP_OK && err != ESP_ERR_NOT_FOUND) {
        Serial.printf("[OTA] Warning: Failed to delete current task from WDT: %s\n", esp_err_to_name(err));
    }

    // Delete async_tcp task from WDT if it exists
    // This task is created by the AsyncTCP library and may be subscribed to WDT
    TaskHandle_t async_tcp_task = xTaskGetHandle("async_tcp");
    if (async_tcp_task != nullptr) {
        err = esp_task_wdt_delete(async_tcp_task);
        if (err == ESP_OK) {
            Serial.println("[OTA] Removed async_tcp task from watchdog");
        } else if (err != ESP_ERR_NOT_FOUND) {
            Serial.printf("[OTA] Warning: Failed to delete async_tcp from WDT: %s\n", esp_err_to_name(err));
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
        Serial.printf("[OTA] Warning: WDT deinit failed: %s (continuing anyway)\n", esp_err_to_name(err));
    }

    // Reinitialize WDT with longer timeout for OTA (120s, no panic, don't subscribe IDLE)
    err = esp_task_wdt_init(120, false);
    if (err != ESP_OK) {
        Serial.printf("[OTA] Warning: WDT init failed: %s\n", esp_err_to_name(err));
    } else {
        Serial.println("[OTA] Task watchdog reconfigured for update (120s timeout)");
    }
#endif
}

/**
 * @brief Configure HTTP client for OTA downloads
 * 
 * @param http HTTPClient instance to configure
 */
inline void configureHttpClient(HTTPClient& http) {
    // Enable following redirects - required for GitHub release downloads
    // GitHub redirects asset URLs to CDN (returns 302)
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(30000);  // 30 second timeout for large downloads
    http.addHeader("User-Agent", "ESP32-Webex-Display");
}

/**
 * @brief Configure WiFiClientSecure for HTTPS downloads
 * 
 * @param client WiFiClientSecure instance to configure
 * @param ca_cert_bundle Certificate bundle to use
 * @param tls_verify Enable TLS certificate verification
 * @param url URL being accessed (for logging)
 */
inline void configureTlsClient(WiFiClientSecure& client, const char* ca_cert_bundle,
                                bool tls_verify, const String& url) {
    Serial.printf("[OTA] TLS context: url=%s time=%lu heap=%lu verify=%s\n",
                  url.c_str(), (unsigned long)time(nullptr), ESP.getFreeHeap(),
                  tls_verify ? "on" : "off");

    // Use existing secure client configuration helper
    configureSecureClientWithTls(client, ca_cert_bundle, tls_verify, 2048, 2048);
}

/**
 * @brief Chunked download with watchdog feeding and progress tracking
 * 
 * @param stream WiFiClient stream to read from
 * @param buffer Heap-allocated buffer for reading chunks
 * @param buffer_size Size of the buffer
 * @param content_length Total bytes to download
 * @param write_callback Function to write downloaded data (returns bytes written)
 * @param progress_callback Optional function called on progress updates (percent)
 * @return Number of bytes successfully downloaded (should match content_length)
 */
inline size_t downloadStream(WiFiClient* stream, uint8_t* buffer, size_t buffer_size,
                             size_t content_length,
                             std::function<size_t(const uint8_t*, size_t)> write_callback,
                             std::function<void(int)> progress_callback = nullptr) {
    if (!stream) {
        Serial.println("[OTA] Invalid stream pointer");
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
                    Serial.printf("[OTA] Stream timeout waiting for data (60s)\n");
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
            Serial.printf("[OTA] Buffer overflow prevented: toRead=%zu > buffer=%zu\n", 
                          to_read, buffer_size);
            return total_written;
        }

        unsigned long read_start = millis();
        int bytes_read = stream->readBytes(buffer, to_read);
        unsigned long read_time = millis() - read_start;
        if (read_time > 1000) {
            Serial.printf("[OTA] WARNING: Slow read: %lu ms for %d bytes\n", read_time, bytes_read);
        }

        if (bytes_read > 0) {
            unsigned long write_start = millis();
            size_t bytes_written = write_callback(buffer, bytes_read);
            unsigned long write_time = millis() - write_start;
            if (write_time > 500) {
                Serial.printf("[OTA] WARNING: Slow write: %lu ms for %zu bytes\n", write_time, bytes_written);
            }

            if (bytes_written != static_cast<size_t>(bytes_read)) {
                Serial.printf("[OTA] Write failed: wrote %zu of %d bytes\n", 
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
                    Serial.printf("[OTA] %d%% complete, heap: %u bytes (block=%u)\n",
                                  progress, freeHeap, maxBlock);
                    if (freeHeap < 30000 || (freeHeap < 50000 && maxBlock < 20000)) {
                        Serial.println("[OTA] CRITICAL: Heap too low, aborting");
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

/**
 * @brief Read exact number of bytes from stream with timeout
 * 
 * @param stream WiFiClient stream to read from
 * @param buffer Buffer to read into
 * @param length Number of bytes to read
 * @param timeout_ms Timeout in milliseconds
 * @return true if all bytes read successfully, false on timeout/error
 */
inline bool readExactBytes(WiFiClient* stream, uint8_t* buffer, size_t length, 
                           unsigned long timeout_ms = 10000) {
    if (!stream || !buffer) {
        return false;
    }

    size_t bytes_read = 0;
    unsigned long start_time = millis();

    while (bytes_read < length) {
        if (millis() - start_time > timeout_ms) {
            Serial.printf("[OTA] Timeout reading %zu bytes (got %zu)\n", length, bytes_read);
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

#endif  // OTA_HELPERS_H
