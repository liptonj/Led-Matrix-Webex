/**
 * @file remote_logger.h
 * @brief Remote Debug Logger
 *
 * Streams debug logs to the bridge server when debug mode is enabled.
 * Logs are also written to Serial for local debugging.
 */

#ifndef REMOTE_LOGGER_H
#define REMOTE_LOGGER_H

#include <Arduino.h>
#include <ArduinoJson.h>

// Log levels
enum LogLevel {
    LOG_DEBUG = 0,
    LOG_INFO = 1,
    LOG_WARN = 2,
    LOG_ERROR = 3
};

// Forward declaration
class BridgeClient;
class SupabaseClient;

/**
 * @brief Remote Debug Logger Class
 *
 * Provides debug logging that can be streamed to the bridge server
 * for remote troubleshooting.
 */
class RemoteLogger {
public:
    RemoteLogger();

    /**
     * @brief Initialize the remote logger
     * @param bridge Pointer to the bridge client for sending logs
     */
    void begin(BridgeClient* bridge, SupabaseClient* supabase = nullptr);

    /**
     * @brief Enable or disable remote logging
     * @param enabled Whether to stream logs to bridge
     */
    void setRemoteEnabled(bool enabled);

    /**
     * @brief Check if remote logging is enabled
     * @return true if remote logging is active
     */
    bool isRemoteEnabled() const { return _remoteEnabled && (_bridge != nullptr || _supabase != nullptr); }

    /**
     * @brief Set minimum log level for remote streaming
     * @param level Minimum level to stream
     */
    void setMinLevel(LogLevel level) { _minLevel = level; }

    /**
     * @brief Log a debug message
     */
    void debug(const char* tag, const char* format, ...);

    /**
     * @brief Log an info message
     */
    void info(const char* tag, const char* format, ...);

    /**
     * @brief Log a warning message
     */
    void warn(const char* tag, const char* format, ...);

    /**
     * @brief Log an error message
     */
    void error(const char* tag, const char* format, ...);

    /**
     * @brief Generic log function
     */
    void log(LogLevel level, const char* tag, const char* format, va_list args);

private:
    BridgeClient* _bridge;
    SupabaseClient* _supabase;
    bool _remoteEnabled;
    LogLevel _minLevel;

    /**
     * @brief Convert log level to string
     */
    static const char* levelToString(LogLevel level);

    /**
     * @brief Send log to bridge server
     */
    void sendRemote(LogLevel level, const char* tag, const char* message);
    void sendToSupabase(LogLevel level, const char* tag, const char* message);
};

// Global instance
extern RemoteLogger remoteLogger;

// Convenience macros
#define RLOG_DEBUG(tag, ...) remoteLogger.debug(tag, __VA_ARGS__)
#define RLOG_INFO(tag, ...) remoteLogger.info(tag, __VA_ARGS__)
#define RLOG_WARN(tag, ...) remoteLogger.warn(tag, __VA_ARGS__)
#define RLOG_ERROR(tag, ...) remoteLogger.error(tag, __VA_ARGS__)

#endif // REMOTE_LOGGER_H
