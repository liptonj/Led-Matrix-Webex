/**
 * @file remote_logger.h
 * @brief Remote Debug Logger
 *
 * Streams debug logs to Supabase when debug mode is enabled.
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
class SupabaseClient;

/**
 * @brief Remote Debug Logger Class
 *
 * Provides debug logging that can be streamed to Supabase
 * for remote troubleshooting.
 */
class RemoteLogger {
public:
    RemoteLogger();

    /**
     * @brief Initialize the remote logger
     * @param supabase Pointer to the Supabase client for sending logs
     */
    void begin(SupabaseClient* supabase = nullptr);

    /**
     * @brief Enable or disable remote logging
     * @param enabled Whether to stream logs to Supabase
     */
    void setRemoteEnabled(bool enabled);

    /**
     * @brief Check if remote logging is enabled
     * @return true if remote logging is active
     */
    bool isRemoteEnabled() const { return _remoteEnabled && (_supabase != nullptr); }

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
    SupabaseClient* _supabase;
    bool _remoteEnabled;
    LogLevel _minLevel;

    /**
     * @brief Convert log level to string
     */
    static const char* levelToString(LogLevel level);

    /**
     * @brief Send log to Supabase
     */
    void sendRemote(LogLevel level, const char* tag, const char* message);
    void sendToSupabase(LogLevel level, const char* tag, const char* message);
};

// Global instance
extern RemoteLogger remoteLogger;

// Convenience macros
#ifdef NATIVE_BUILD
// Native builds: stub out remote logging (just prints to Serial)
#define RLOG_DEBUG(tag, ...) do { (void)(tag); } while(0)
#define RLOG_INFO(tag, ...) do { (void)(tag); } while(0)
#define RLOG_WARN(tag, ...) do { (void)(tag); } while(0)
#define RLOG_ERROR(tag, ...) do { (void)(tag); } while(0)
#else
#define RLOG_DEBUG(tag, ...) remoteLogger.debug(tag, __VA_ARGS__)
#define RLOG_INFO(tag, ...) remoteLogger.info(tag, __VA_ARGS__)
#define RLOG_WARN(tag, ...) remoteLogger.warn(tag, __VA_ARGS__)
#define RLOG_ERROR(tag, ...) remoteLogger.error(tag, __VA_ARGS__)
#endif

#endif // REMOTE_LOGGER_H
