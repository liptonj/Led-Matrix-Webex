/**
 * @file log_system.cpp
 * @brief Unified Logging System Implementation
 *
 * Implements the custom vprintf hook for ESP-IDF logging and background
 * task for remote log delivery via Supabase Realtime/HTTP.
 */

#ifndef NATIVE_BUILD

#include "log_system.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../config/config_manager.h"
#include "../auth/device_credentials.h"
#include <ArduinoJson.h>
#include <esp_heap_caps.h>
#include <time.h>

// ============================================================================
// Module-level state
// ============================================================================

static SupabaseClient* _s_supabase = nullptr;
static SupabaseRealtime* _s_realtime = nullptr;
static ConfigManager* _s_config = nullptr;
static bool _s_remoteEnabled = false;
static bool _s_suppressed = false;
static QueueHandle_t _s_queue = nullptr;
static int (*_s_origVprintf)(const char*, va_list) = nullptr;

// Throttling for low-heap warnings (max once per 10 seconds)
static unsigned long _s_lastHeapWarning = 0;
static const unsigned long HEAP_WARNING_INTERVAL_MS = 10000;

// ============================================================================
// Helper functions
// ============================================================================

/**
 * @brief Convert LogQueueLevel to string for Supabase
 */
static const char* levelToString(LogQueueLevel level) {
    switch (level) {
        case LOG_Q_ERROR:   return "error";
        case LOG_Q_WARN:    return "warn";
        case LOG_Q_INFO:    return "info";
        case LOG_Q_DEBUG:   return "debug";
        case LOG_Q_VERBOSE: return "verbose";
        default:            return "unknown";
    }
}

/**
 * @brief Parse log level from ESP-IDF formatted output
 *
 * ESP-IDF format examples:
 * - With color: "\033[0;31mE (12345) TAG: message\033[0m"
 * - Without color: "E (12345) TAG: message"
 *
 * The first non-ANSI-escape character is the level letter (E/W/I/D/V).
 */
static LogQueueLevel parseLogLevel(const char* formatted) {
    if (!formatted || formatted[0] == '\0') {
        return LOG_Q_UNKNOWN;
    }

    const char* p = formatted;
    
    // Skip ANSI escape sequences (e.g., "\033[0;31m")
    while (*p == '\033' || (*p >= 0x1B && *p <= 0x1F)) {
        // Skip to 'm' (end of ANSI escape)
        while (*p != '\0' && *p != 'm') {
            p++;
        }
        if (*p == 'm') {
            p++; // Skip the 'm'
        }
    }

    // First character after ANSI escapes should be the level letter
    char levelChar = *p;
    switch (levelChar) {
        case 'E': return LOG_Q_ERROR;
        case 'W': return LOG_Q_WARN;
        case 'I': return LOG_Q_INFO;
        case 'D': return LOG_Q_DEBUG;
        case 'V': return LOG_Q_VERBOSE;
        default:  return LOG_Q_UNKNOWN;
    }
}

// ============================================================================
// Custom vprintf hook
// ============================================================================

/**
 * @brief Custom vprintf hook for ESP-IDF logging
 *
 * This function:
 * 1. Always calls the original vprintf for Serial output
 * 2. If remote is enabled (or error level), queues message for remote delivery
 * 3. Parses log level from ESP-IDF formatted output
 * 4. Non-blocking: uses zero timeout for queue send
 */
static int remote_log_vprintf(const char* fmt, va_list args) {
    // Always call original vprintf for Serial output
    int result = _s_origVprintf ? _s_origVprintf(fmt, args) : vprintf(fmt, args);

    // If suppressed, don't queue anything (not even errors)
    if (_s_suppressed) {
        return result;
    }

    // If queue not initialized, skip remote logging
    if (_s_queue == nullptr) {
        return result;
    }

    // Format message to a temporary buffer to parse level
    char tempBuf[LOG_QUEUE_MSG_LEN + 64]; // Extra space for formatting
    int formattedLen = vsnprintf(tempBuf, sizeof(tempBuf), fmt, args);
    
    if (formattedLen < 0 || formattedLen >= (int)sizeof(tempBuf)) {
        // Formatting failed or truncated - skip remote logging
        return result;
    }

    // Parse log level from formatted output
    LogQueueLevel level = parseLogLevel(tempBuf);

    // Errors are ALWAYS queued (even if remote_enabled is false)
    // Other levels only if remote_enabled is true
    bool shouldQueue = (level == LOG_Q_ERROR) || _s_remoteEnabled;
    
    if (!shouldQueue || level == LOG_Q_UNKNOWN) {
        return result;
    }

    // Prepare queue message
    LogQueueMessage msg;
    msg.level = level;
    
    // Copy message (truncate if too long)
    size_t copyLen = formattedLen < LOG_QUEUE_MSG_LEN ? formattedLen : LOG_QUEUE_MSG_LEN - 1;
    memcpy(msg.message, tempBuf, copyLen);
    msg.message[copyLen] = '\0';

    // Non-blocking send (zero timeout)
    BaseType_t sent = xQueueSend(_s_queue, &msg, pdMS_TO_TICKS(0));
    
    // If queue is full, message is dropped (non-blocking design)
    // This prevents logging from blocking the calling task
    (void)sent; // Suppress unused warning

    return result;
}

// ============================================================================
// Background task
// ============================================================================

/**
 * @brief FreeRTOS background task for remote log delivery
 *
 * This task:
 * 1. Blocks on queue receive (wakes on new message)
 * 2. Checks heap before sending (prevents OOM)
 * 3. Tries Supabase Realtime broadcast first
 * 4. Falls back to HTTP if broadcast fails or realtime not connected
 */
static void remote_log_task(void* param) {
    (void)param; // Unused
    
    LogQueueMessage msg;
    
    while (true) {
        // Block until message arrives
        if (xQueueReceive(_s_queue, &msg, portMAX_DELAY) != pdTRUE) {
            continue;
        }

        // Check if Supabase components are ready
        if (_s_supabase == nullptr || _s_config == nullptr) {
            // Components not ready yet - drop message
            continue;
        }

        // Check heap before attempting to send
        uint32_t freeHeap = ESP.getFreeHeap();
        size_t largestBlock = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
        
        if (freeHeap < LOG_MIN_FREE_HEAP || largestBlock < LOG_MIN_FREE_BLOCK) {
            // Low heap - log warning (throttled) and drop message
            unsigned long now = millis();
            unsigned long elapsed = now - _s_lastHeapWarning;
            if (elapsed > HEAP_WARNING_INTERVAL_MS || now < _s_lastHeapWarning) {
                Serial.printf("[LOG_SYSTEM] Low heap, dropping remote log: free=%u, block=%u\n",
                             freeHeap, largestBlock);
                _s_lastHeapWarning = now;
            }
            continue;
        }

        // Get device info from config
        String deviceUuid = _s_config->getDeviceUuid();
        
        // Note: serial_number is not available from ConfigManager
        // DeviceCredentials provides it, but we don't have access here
        // device_uuid is sufficient for identification, so we'll omit serial_number
        
        // Build JSON document for broadcast/HTTP
        JsonDocument doc;
        doc["device_uuid"] = deviceUuid;
        doc["level"] = levelToString(msg.level);
        doc["message"] = msg.message;
        
        // Build metadata object
        JsonDocument metadata;
        // Extract tag from message (format: "LEVEL (timestamp) TAG: message")
        // Try to parse tag from ESP-IDF format
        const char* msgPtr = msg.message;
        // Skip level and timestamp: "E (12345) "
        while (*msgPtr != '\0' && (*msgPtr == ' ' || *msgPtr == '(' || (*msgPtr >= '0' && *msgPtr <= '9'))) {
            msgPtr++;
        }
        // Skip level letter if still present
        if (*msgPtr == 'E' || *msgPtr == 'W' || *msgPtr == 'I' || *msgPtr == 'D' || *msgPtr == 'V') {
            msgPtr++;
            while (*msgPtr == ' ' || *msgPtr == '(') msgPtr++;
            while (*msgPtr >= '0' && *msgPtr <= '9') msgPtr++;
            while (*msgPtr == ' ' || *msgPtr == ')') msgPtr++;
        }
        
        // Extract tag (everything up to ':')
        String tag = "";
        const char* tagStart = msgPtr;
        while (*msgPtr != '\0' && *msgPtr != ':') {
            msgPtr++;
        }
        if (*msgPtr == ':') {
            tag = String(tagStart, msgPtr - tagStart);
            tag.trim();
        }
        
        metadata["tag"] = tag.isEmpty() ? "unknown" : tag;
        metadata["uptime_ms"] = millis();
        metadata["free_heap"] = freeHeap;
        metadata["min_free_heap"] = ESP.getMinFreeHeap();
        
        doc["metadata"] = metadata;
        
        // Add timestamp
        time_t now;
        time(&now);
        doc["ts"] = (unsigned long)now;

        // Try Realtime broadcast first (if realtime is available and connected)
        bool broadcastSent = false;
        if (_s_realtime != nullptr && _s_realtime->isConnected()) {
            broadcastSent = _s_realtime->sendBroadcast("debug_log", doc);
        }

        // If broadcast failed or realtime not available, fall back to HTTP
        if (!broadcastSent) {
            // Convert metadata to JSON string for HTTP call
            String metadataJson;
            serializeJson(metadata, metadataJson);
            
            // Call HTTP endpoint
            _s_supabase->insertDeviceLog(levelToString(msg.level), msg.message, metadataJson);
        }
    }
}

// ============================================================================
// Public API implementation
// ============================================================================

void log_system_init() {
    // Create FreeRTOS queue
    _s_queue = xQueueCreate(LOG_QUEUE_SIZE, sizeof(LogQueueMessage));
    if (_s_queue == nullptr) {
        Serial.println("[LOG_SYSTEM] Failed to create log queue");
        return;
    }

    // Create background task
    BaseType_t taskCreated = xTaskCreate(
        remote_log_task,
        "log_remote",
        LOG_TASK_STACK_SIZE,
        nullptr,
        LOG_TASK_PRIORITY,
        nullptr
    );

    if (taskCreated != pdPASS) {
        Serial.println("[LOG_SYSTEM] Failed to create log task");
        vQueueDelete(_s_queue);
        _s_queue = nullptr;
        return;
    }

    // Register custom vprintf hook and save original
    _s_origVprintf = esp_log_set_vprintf(remote_log_vprintf);
    
    Serial.println("[LOG_SYSTEM] Initialized");
}

void log_system_set_remote_ready(SupabaseClient* supabase,
                                  SupabaseRealtime* realtime,
                                  ConfigManager* config) {
    _s_supabase = supabase;
    _s_realtime = realtime;
    _s_config = config;
}

void log_system_set_remote_enabled(bool enabled) {
    _s_remoteEnabled = enabled;
}

bool log_system_is_remote_enabled() {
    return _s_remoteEnabled;
}

void log_system_set_suppressed(bool suppressed) {
    _s_suppressed = suppressed;
}

bool log_system_is_suppressed() {
    return _s_suppressed;
}

#endif // NATIVE_BUILD
