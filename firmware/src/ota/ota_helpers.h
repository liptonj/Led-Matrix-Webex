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
#include "../debug/log_system.h"
#include <functional>

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
void disableWatchdogForOTA();

/**
 * @brief Configure HTTP client for OTA downloads
 * 
 * @param http HTTPClient instance to configure
 */
void configureHttpClient(HTTPClient& http);

/**
 * @brief Configure WiFiClientSecure for HTTPS downloads
 * 
 * @param client WiFiClientSecure instance to configure
 * @param ca_cert_bundle Certificate bundle to use
 * @param tls_verify Enable TLS certificate verification
 * @param url URL being accessed (for logging)
 */
void configureTlsClient(WiFiClientSecure& client, const char* ca_cert_bundle,
                        bool tls_verify, const String& url);

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
size_t downloadStream(WiFiClient* stream, uint8_t* buffer, size_t buffer_size,
                     size_t content_length,
                     std::function<size_t(const uint8_t*, size_t)> write_callback,
                     std::function<void(int)> progress_callback = nullptr);

/**
 * @brief Read exact number of bytes from stream with timeout
 * 
 * @param stream WiFiClient stream to read from
 * @param buffer Buffer to read into
 * @param length Number of bytes to read
 * @param timeout_ms Timeout in milliseconds
 * @return true if all bytes read successfully, false on timeout/error
 */
bool readExactBytes(WiFiClient* stream, uint8_t* buffer, size_t length, 
                   unsigned long timeout_ms = 10000);

}  // namespace OTAHelpers

#endif  // OTA_HELPERS_H
