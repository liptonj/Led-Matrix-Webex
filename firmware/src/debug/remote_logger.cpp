/**
 * @file remote_logger.cpp
 * @brief Remote Debug Logger Implementation
 */

#include "remote_logger.h"
#include "../supabase/supabase_client.h"
#include "esp_heap_caps.h"
#include <stdarg.h>

// Global instance
RemoteLogger remoteLogger;

RemoteLogger::RemoteLogger()
    : _supabase(nullptr), _remoteEnabled(false), _minLevel(LOG_DEBUG) {
}

void RemoteLogger::begin(SupabaseClient* supabase) {
    _supabase = supabase;
    Serial.println("[RLOG] Remote logger initialized");
}

void RemoteLogger::setRemoteEnabled(bool enabled) {
    if (_remoteEnabled == enabled) {
        return;  // avoid spamming status when value unchanged
    }

    _remoteEnabled = enabled;
    if (enabled) {
        Serial.println("[RLOG] Remote logging ENABLED - logs will stream to Supabase");
    } else {
        Serial.println("[RLOG] Remote logging disabled");
    }
}

void RemoteLogger::debug(const char* tag, const char* format, ...) {
    va_list args;
    va_start(args, format);
    log(LOG_DEBUG, tag, format, args);
    va_end(args);
}

void RemoteLogger::info(const char* tag, const char* format, ...) {
    va_list args;
    va_start(args, format);
    log(LOG_INFO, tag, format, args);
    va_end(args);
}

void RemoteLogger::warn(const char* tag, const char* format, ...) {
    va_list args;
    va_start(args, format);
    log(LOG_WARN, tag, format, args);
    va_end(args);
}

void RemoteLogger::error(const char* tag, const char* format, ...) {
    va_list args;
    va_start(args, format);
    log(LOG_ERROR, tag, format, args);
    va_end(args);
}

void RemoteLogger::log(LogLevel level, const char* tag, const char* format, va_list args) {
    // Format message
    char message[512];
    vsnprintf(message, sizeof(message), format, args);

    // Always print to Serial
    const char* levelStr = levelToString(level);
    Serial.printf("[%s][%s] %s\n", levelStr, tag, message);

    // Send to Supabase if enabled and level meets threshold
    if (_remoteEnabled && level >= _minLevel) {
        sendRemote(level, tag, message);
    }
}

const char* RemoteLogger::levelToString(LogLevel level) {
    switch (level) {
        case LOG_DEBUG: return "DEBUG";
        case LOG_INFO:  return "INFO";
        case LOG_WARN:  return "WARN";
        case LOG_ERROR: return "ERROR";
        default:        return "UNKNOWN";
    }
}

void RemoteLogger::sendRemote(LogLevel level, const char* tag, const char* message) {
    // Check supabase client conditions
    if (_supabase == nullptr) {
        static unsigned long last_null_log = 0;
        unsigned long now = millis();
        if (now - last_null_log > 30000) {
            last_null_log = now;
            Serial.println("[RLOG] Cannot send: Supabase client is null");
        }
        return;
    }
    if (!_supabase->isInitialized()) {
        static unsigned long last_init_log = 0;
        unsigned long now = millis();
        if (now - last_init_log > 30000) {
            last_init_log = now;
            Serial.println("[RLOG] Cannot send: Supabase client not initialized");
        }
        return;
    }
    if (!_supabase->isAuthenticated()) {
        static unsigned long last_auth_log = 0;
        unsigned long now = millis();
        if (now - last_auth_log > 30000) {
            last_auth_log = now;
            Serial.println("[RLOG] Cannot send: Supabase client not authenticated");
        }
        return;
    }

    // Check heap conditions
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t largestBlock = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    if (freeHeap < 65000 || largestBlock < 40000) {
        static unsigned long last_skip_log = 0;
        unsigned long now = millis();
        if (now - last_skip_log > 10000) {
            last_skip_log = now;
            Serial.printf("[RLOG] Skipping remote log (low heap free=%u block=%u)\n",
                          freeHeap, largestBlock);
        }
        return;
    }

    sendToSupabase(level, tag, message);
}

void RemoteLogger::sendToSupabase(LogLevel level, const char* tag, const char* message) {
    if (_supabase == nullptr || !_supabase->isInitialized() || !_supabase->isAuthenticated()) {
        return;
    }

    // Build metadata JSON
    JsonDocument metaDoc;
    metaDoc["tag"] = tag;
    metaDoc["uptime_ms"] = millis();
    metaDoc["free_heap"] = ESP.getFreeHeap();
    metaDoc["min_free_heap"] = ESP.getMinFreeHeap();

    String metadata;
    serializeJson(metaDoc, metadata);

    // Format full message with tag
    String fullMessage = String("[") + tag + "] " + message;

    _supabase->insertDeviceLog(levelToString(level), fullMessage, metadata);
}
