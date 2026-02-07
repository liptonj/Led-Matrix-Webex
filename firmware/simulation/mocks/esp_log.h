/**
 * @file esp_log.h
 * @brief Mock ESP-IDF logging for native builds
 *
 * Provides minimal ESP-IDF logging API compatibility for native/simulation builds.
 * This mock checks if log_system.h has already provided these definitions to avoid
 * redefinition conflicts.
 */

#ifndef ESP_LOG_H
#define ESP_LOG_H

// Only define if log_system.h hasn't already provided these
#ifndef LOG_SYSTEM_H

#include <cstdio>
#include <cstdarg>

/**
 * @brief ESP-IDF log level enum
 */
typedef enum {
    ESP_LOG_NONE = 0,
    ESP_LOG_ERROR = 1,
    ESP_LOG_WARN = 2,
    ESP_LOG_INFO = 3,
    ESP_LOG_DEBUG = 4,
    ESP_LOG_VERBOSE = 5
} esp_log_level_t;

/**
 * @brief vprintf-like function pointer type
 */
typedef int (*vprintf_like_t)(const char*, va_list);

/**
 * @brief ESP-IDF logging macros
 */
#define ESP_LOGE(tag, fmt, ...) printf("[ERROR][%s] " fmt "\n", tag, ##__VA_ARGS__)
#define ESP_LOGW(tag, fmt, ...) printf("[WARN][%s] " fmt "\n", tag, ##__VA_ARGS__)
#define ESP_LOGI(tag, fmt, ...) printf("[INFO][%s] " fmt "\n", tag, ##__VA_ARGS__)
#define ESP_LOGD(tag, fmt, ...) printf("[DEBUG][%s] " fmt "\n", tag, ##__VA_ARGS__)
#define ESP_LOGV(tag, fmt, ...) printf("[VERBOSE][%s] " fmt "\n", tag, ##__VA_ARGS__)

/**
 * @brief Set log level (no-op for native builds)
 */
inline void esp_log_level_set(const char* tag, esp_log_level_t level) {
    (void)tag;
    (void)level;
}

/**
 * @brief Set custom vprintf hook (no-op for native builds)
 * @return nullptr (no original vprintf to return)
 */
inline vprintf_like_t esp_log_set_vprintf(vprintf_like_t func) {
    (void)func;
    return nullptr;
}

#endif // LOG_SYSTEM_H

#endif // ESP_LOG_H
