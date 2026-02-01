/**
 * @file firmware_constants.h
 * @brief Centralized firmware constants and magic numbers
 * 
 * This file consolidates commonly used magic numbers throughout the firmware
 * to improve maintainability and prevent inconsistencies.
 */

#ifndef FIRMWARE_CONSTANTS_H
#define FIRMWARE_CONSTANTS_H

#include <cstdint>

// =============================================================================
// TIME CONSTANTS (milliseconds unless otherwise noted)
// =============================================================================

// Intervals
constexpr unsigned long INTERVAL_1_SECOND = 1000;
constexpr unsigned long INTERVAL_2_SECONDS = 2000;
constexpr unsigned long INTERVAL_3_SECONDS = 3000;
constexpr unsigned long INTERVAL_5_SECONDS = 5000;
constexpr unsigned long INTERVAL_10_SECONDS = 10000;
constexpr unsigned long INTERVAL_30_SECONDS = 30000;
constexpr unsigned long INTERVAL_1_MINUTE = 60000;
constexpr unsigned long INTERVAL_5_MINUTES = 300000;

// Timeouts
constexpr unsigned long TIMEOUT_HTTP_REQUEST = 30000;  // 30 seconds
constexpr unsigned long TIMEOUT_WIFI_CONNECT = 10000;  // 10 seconds
constexpr unsigned long TIMEOUT_SUPABASE_REQUEST = 10000;  // 10 seconds
constexpr unsigned long TIMEOUT_PROVISION = 60000;  // 60 seconds
constexpr unsigned long TIMEOUT_PROVISION_RECOVERY = 300000;  // 5 minutes (recovery mode)
constexpr unsigned long TIMEOUT_WIFI_DETECT_RECOVERY = 300000;  // 5 minutes (recovery mode)

// Delays
constexpr unsigned long DELAY_RETRY = 2000;  // Generic retry delay
constexpr unsigned long DELAY_BOOT_CHECK = 1000;  // Boot status check delay

// =============================================================================
// MEMORY CONSTANTS (bytes)
// =============================================================================

// Heap thresholds
constexpr uint32_t HEAP_MIN_FREE = 40000;  // Minimum free heap for normal operation
constexpr uint32_t HEAP_MIN_BLOCK = 30000;  // Minimum largest contiguous block
constexpr uint32_t HEAP_CRITICAL = 30000;  // Critical heap threshold
constexpr uint32_t HEAP_LOW_THRESHOLD = 50000;  // Low heap warning threshold

// Buffer sizes
constexpr size_t BUFFER_SIZE_TINY = 32;
constexpr size_t BUFFER_SIZE_SMALL = 64;
constexpr size_t BUFFER_SIZE_MEDIUM = 128;
constexpr size_t BUFFER_SIZE_LARGE = 256;
constexpr size_t BUFFER_SIZE_XLARGE = 512;
constexpr size_t BUFFER_SIZE_HUGE = 1024;
constexpr size_t BUFFER_SIZE_MEGA = 2048;
constexpr size_t BUFFER_SIZE_GIGA = 4096;

// OTA buffers
constexpr size_t OTA_BUFFER_SIZE = 4096;  // OTA download buffer
constexpr size_t OTA_BUFFER_SIZE_SMALL = 2048;  // Smaller OTA buffer for constrained memory

// =============================================================================
// DISPLAY CONSTANTS
// =============================================================================

// Page intervals
constexpr unsigned long PAGE_INTERVAL_MIN = 3000;  // Minimum page switch interval
constexpr unsigned long PAGE_INTERVAL_MAX = 30000;  // Maximum page switch interval
constexpr unsigned long PAGE_INTERVAL_DEFAULT = 5000;  // Default page switch interval

// Colors (RGB565 format)
constexpr uint16_t COLOR_BLACK = 0x0000;
constexpr uint16_t COLOR_WHITE = 0xFFFF;
constexpr uint16_t COLOR_RED = 0xF800;
constexpr uint16_t COLOR_GREEN = 0x07E0;
constexpr uint16_t COLOR_BLUE = 0x001F;
constexpr uint16_t COLOR_YELLOW = 0xFFE0;
constexpr uint16_t COLOR_CYAN = 0x07FF;
constexpr uint16_t COLOR_MAGENTA = 0xF81F;
constexpr uint16_t COLOR_ORANGE = 0xFC00;
constexpr uint16_t COLOR_GRAY = 0x7BEF;

// Matrix dimensions (defined elsewhere but documented here)
// MATRIX_WIDTH and MATRIX_HEIGHT are defined in display_config.h

// =============================================================================
// NETWORK CONSTANTS
// =============================================================================

// Retry settings
constexpr unsigned long RETRY_INTERVAL_DEFAULT = 60000;  // 1 minute
constexpr unsigned long RETRY_INTERVAL_MQTT = 30000;  // 30 seconds for MQTT reconnect
constexpr unsigned long RETRY_INTERVAL_TIME_SYNC = 60000;  // 1 minute for time sync

// Watchdog timeout
constexpr uint32_t WATCHDOG_TIMEOUT_NORMAL = 30;  // seconds
constexpr uint32_t WATCHDOG_TIMEOUT_OTA = 120;  // seconds (for long downloads)

// =============================================================================
// SENSOR CONSTANTS
// =============================================================================

// Sensor thresholds
constexpr float TVOC_DISPLAY_THRESHOLD = 1000.0f;  // Display in thousands above this
constexpr float TVOC_THOUSAND_ROUNDING = 500.0f;  // Round to nearest thousand

// Temperature conversion
constexpr float TEMP_F_TO_C_MULTIPLIER = 5.0f / 9.0f;
constexpr float TEMP_F_TO_C_OFFSET = 32.0f;
constexpr float TEMP_C_TO_F_MULTIPLIER = 9.0f / 5.0f;
constexpr float TEMP_C_TO_F_OFFSET = 32.0f;

// =============================================================================
// CRYPTO CONSTANTS
// =============================================================================

// Key sizes
constexpr size_t SHA256_DIGEST_SIZE = 32;  // SHA-256 produces 32-byte hash
constexpr size_t HMAC_RESULT_SIZE = 32;  // HMAC-SHA256 produces 32-byte result
constexpr size_t BASE64_BUFFER_SIZE = 64;  // Buffer for base64-encoded HMAC
constexpr size_t HEX_HASH_SIZE = 64;  // Hex-encoded SHA256 (32 bytes * 2)

// Device credentials
constexpr size_t DEVICE_SECRET_SIZE = 32;  // 256-bit secret
constexpr size_t DEVICE_SERIAL_LENGTH = 8;  // 8-character hex serial

// =============================================================================
// LOGGING CONSTANTS
// =============================================================================

// Log intervals (to prevent spam)
constexpr unsigned long LOG_INTERVAL_DEFAULT = 60000;  // 1 minute
constexpr unsigned long LOG_INTERVAL_HEAP = 30000;  // 30 seconds for heap status
constexpr unsigned long LOG_INTERVAL_MDNS = 5000;  // 5 seconds for mDNS checks

// Sample intervals
constexpr unsigned long HEAP_SAMPLE_INTERVAL = 5000;  // 5 seconds
constexpr size_t HEAP_SAMPLE_COUNT = 5;  // Number of samples to collect

// =============================================================================
// RECOVERY CONSTANTS
// =============================================================================

// Heap recovery durations
constexpr unsigned long RECOVERY_LOW_HEAP_DURATION = 10000;  // 10 seconds
constexpr unsigned long RECOVERY_CRITICAL_DURATION = 2000;  // 2 seconds
constexpr unsigned long RECOVERY_COOLDOWN = 30000;  // 30 seconds between actions

// =============================================================================
// UTILITY MACROS
// =============================================================================

// Convert milliseconds to seconds (for display/logging)
#define MS_TO_SEC(ms) ((ms) / 1000)

// Convert seconds to milliseconds
#define SEC_TO_MS(sec) ((sec) * 1000)

#endif // FIRMWARE_CONSTANTS_H
