/**
 * @file log_system.h
 * @brief Unified Logging System built on ESP-IDF esp_log
 *
 * Replaces the fragmented logging landscape (RLOG_*, DEBUG_LOG, DEBUG_DISPLAY,
 * DEBUG_REALTIME, LOG_INFO/ERROR/WARN, raw Serial.print) with a single system
 * built on ESP-IDF's native logging library.
 *
 * Features:
 * - All logs go through ESP-IDF ESP_LOGx macros (per-tag level control)
 * - Custom vprintf hook routes logs to FreeRTOS queue for async remote delivery
 * - Errors always stream remotely (even when debug_enabled is off)
 * - Heap-aware throttling prevents OOM during heavy logging
 * - Non-blocking: logging never blocks the calling task
 *
 * Usage:
 *   #include "log_system.h"
 *   static const char* TAG = "MY_MODULE";
 *   ESP_LOGI(TAG, "Hello %s", "world");
 *   ESP_LOGE(TAG, "Something failed: %d", err);
 */

#ifndef LOG_SYSTEM_H
#define LOG_SYSTEM_H

#ifdef NATIVE_BUILD
// =========================================================================
// Native/simulation build: stub everything to printf
// =========================================================================
#include <cstdio>
#include <cstdarg>

// Log level enum matching ESP-IDF
typedef enum {
    ESP_LOG_NONE = 0,
    ESP_LOG_ERROR = 1,
    ESP_LOG_WARN = 2,
    ESP_LOG_INFO = 3,
    ESP_LOG_DEBUG = 4,
    ESP_LOG_VERBOSE = 5
} esp_log_level_t;

#define ESP_LOGE(tag, fmt, ...) printf("[ERROR][%s] " fmt "\n", tag, ##__VA_ARGS__)
#define ESP_LOGW(tag, fmt, ...) printf("[WARN][%s] " fmt "\n", tag, ##__VA_ARGS__)
#define ESP_LOGI(tag, fmt, ...) printf("[INFO][%s] " fmt "\n", tag, ##__VA_ARGS__)
#define ESP_LOGD(tag, fmt, ...) printf("[DEBUG][%s] " fmt "\n", tag, ##__VA_ARGS__)
#define ESP_LOGV(tag, fmt, ...) printf("[VERBOSE][%s] " fmt "\n", tag, ##__VA_ARGS__)

inline void esp_log_level_set(const char*, esp_log_level_t) {}

// Stub log system functions for native builds
inline void log_system_init() {}
inline void log_system_set_remote_ready(void*, void*, void*) {}
inline void log_system_set_remote_enabled(bool) {}
inline bool log_system_is_remote_enabled() { return false; }
inline void log_system_set_suppressed(bool) {}
inline bool log_system_is_suppressed() { return false; }

#else
// =========================================================================
// ESP32 build: full implementation
// =========================================================================
#include "esp_log.h"
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

// Forward declarations
class SupabaseClient;
class SupabaseRealtime;
class ConfigManager;

// =========================================================================
// Log queue message structure
// =========================================================================

/** Maximum message length in the remote log queue */
#define LOG_QUEUE_MSG_LEN 256

/** Number of messages the queue can hold */
#define LOG_QUEUE_SIZE 32

/** Stack size for the remote log sender task (bytes) */
#define LOG_TASK_STACK_SIZE 4096

/** Priority for the remote log sender task */
#define LOG_TASK_PRIORITY 1

/** Minimum free heap to attempt remote log send */
#define LOG_MIN_FREE_HEAP 50000

/** Minimum largest free block to attempt remote log send */
#define LOG_MIN_FREE_BLOCK 30000

/**
 * @brief Log level for queued remote messages
 * Maps to ESP-IDF log levels but stored as a compact enum for the queue.
 */
enum LogQueueLevel : uint8_t {
    LOG_Q_ERROR = 1,
    LOG_Q_WARN  = 2,
    LOG_Q_INFO  = 3,
    LOG_Q_DEBUG = 4,
    LOG_Q_VERBOSE = 5,
    LOG_Q_UNKNOWN = 0
};

/**
 * @brief Message structure for the remote log queue
 *
 * Fixed-size struct suitable for FreeRTOS queue (no heap allocation).
 * The message is the pre-formatted log line from ESP-IDF.
 */
struct LogQueueMessage {
    LogQueueLevel level;
    char message[LOG_QUEUE_MSG_LEN];
};

// =========================================================================
// Public API
// =========================================================================

/**
 * @brief Initialize the unified log system
 *
 * Creates the FreeRTOS queue and background sender task.
 * Registers the custom vprintf hook with ESP-IDF logging.
 * Call this early in setup(), before any ESP_LOGx calls if possible.
 */
void log_system_init();

/**
 * @brief Provide references to Supabase components for remote sending
 *
 * Call this after SupabaseClient and SupabaseRealtime are initialized.
 * Until this is called, remote logging is buffered but not sent.
 *
 * @param supabase Pointer to SupabaseClient (for HTTP fallback)
 * @param realtime Pointer to SupabaseRealtime (for WebSocket broadcast)
 * @param config Pointer to ConfigManager (for device UUID, serial number)
 */
void log_system_set_remote_ready(SupabaseClient* supabase,
                                  SupabaseRealtime* realtime,
                                  ConfigManager* config);

/**
 * @brief Enable or disable remote log streaming
 *
 * When enabled, logs are queued for remote delivery.
 * Error-level logs are ALWAYS queued regardless of this setting.
 *
 * @param enabled true to stream all logs remotely, false for errors-only
 */
void log_system_set_remote_enabled(bool enabled);

/**
 * @brief Check if remote logging is currently enabled
 * @return true if remote streaming is active for all levels
 */
bool log_system_is_remote_enabled();

/**
 * @brief Temporarily suppress remote logging (e.g., during OTA)
 *
 * When suppressed, NO logs are queued for remote delivery (not even errors).
 * Use this during OTA downloads to prevent heap/network contention.
 *
 * @param suppressed true to suppress, false to restore
 */
void log_system_set_suppressed(bool suppressed);

/**
 * @brief Check if remote logging is suppressed
 * @return true if suppressed (e.g., during OTA)
 */
bool log_system_is_suppressed();

#endif // NATIVE_BUILD

// =========================================================================
// Backward-compatible macros (Phase 2 compatibility layer)
// =========================================================================
// These allow existing code to compile unchanged during migration.
// New code should use ESP_LOGx directly.

#define RLOG_ERROR(tag, fmt, ...) ESP_LOGE(tag, fmt, ##__VA_ARGS__)
#define RLOG_WARN(tag, fmt, ...)  ESP_LOGW(tag, fmt, ##__VA_ARGS__)
#define RLOG_INFO(tag, fmt, ...)  ESP_LOGI(tag, fmt, ##__VA_ARGS__)
#define RLOG_DEBUG(tag, fmt, ...) ESP_LOGD(tag, fmt, ##__VA_ARGS__)

// Map old debug macros to ESP_LOGD with subsystem tags
// These ignore the old g_debug_* flags -- use esp_log_level_set() instead
#define DEBUG_LOG(tag, fmt, ...)      ESP_LOGD(tag, fmt, ##__VA_ARGS__)
#define DEBUG_DISPLAY(fmt, ...)       ESP_LOGD("DISPLAY", fmt, ##__VA_ARGS__)
#define DEBUG_REALTIME(fmt, ...)      ESP_LOGD("REALTIME", fmt, ##__VA_ARGS__)

// Map unused LOG_* macros (avoid collision with LogLevel enum names)
#define LOG_INFO_TAG(tag, fmt, ...)  ESP_LOGI(tag, fmt, ##__VA_ARGS__)
#define LOG_ERROR_TAG(tag, fmt, ...) ESP_LOGE(tag, fmt, ##__VA_ARGS__)
#define LOG_WARN_TAG(tag, fmt, ...)  ESP_LOGW(tag, fmt, ##__VA_ARGS__)

#endif // LOG_SYSTEM_H
