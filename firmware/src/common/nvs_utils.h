/**
 * @file nvs_utils.h
 * @brief NVS (Non-Volatile Storage) Utility Class
 * 
 * Provides a consistent, type-safe interface for NVS operations across
 * the firmware. This utility wraps the ESP32 Preferences library with
 * additional error handling, logging, and type safety.
 * 
 * IMPORTANT: Key names and namespaces must be preserved exactly as-is
 * for backward compatibility with existing device configurations.
 * 
 * Known NVS Namespaces (DO NOT CHANGE):
 * - "webex-display" - Main configuration (ConfigManager)
 * - "boot"          - Boot validation (BootValidator)
 * - "device_auth"   - Device credentials (DeviceCredentials)
 * - "pairing"       - Pairing codes (PairingManager)
 */

#ifndef NVS_UTILS_H
#define NVS_UTILS_H

#include <Arduino.h>
#include <Preferences.h>

// Maximum key length for NVS (ESP32 limitation is 15 characters)
#define NVS_MAX_KEY_LENGTH 15

// Log tag for NVS operations
#define NVS_LOG_TAG "[NVS]"

/**
 * @brief Result codes for NVS operations
 */
enum class NvsResult {
    OK = 0,              // Operation successful
    NOT_INITIALIZED,     // NVS namespace not opened
    READ_ONLY,           // Attempted write on read-only namespace
    KEY_NOT_FOUND,       // Key does not exist
    TYPE_MISMATCH,       // Value type doesn't match stored type
    WRITE_FAILED,        // Failed to write value
    READ_FAILED,         // Failed to read value
    NAMESPACE_ERROR,     // Failed to open namespace
    KEY_TOO_LONG,        // Key exceeds maximum length
    INVALID_ARGUMENT     // Invalid argument provided
};

/**
 * @brief Convert NvsResult to human-readable string
 * @param result The result code
 * @return String representation
 */
inline const char* nvsResultToString(NvsResult result) {
    switch (result) {
        case NvsResult::OK:              return "OK";
        case NvsResult::NOT_INITIALIZED: return "Not initialized";
        case NvsResult::READ_ONLY:       return "Read-only mode";
        case NvsResult::KEY_NOT_FOUND:   return "Key not found";
        case NvsResult::TYPE_MISMATCH:   return "Type mismatch";
        case NvsResult::WRITE_FAILED:    return "Write failed";
        case NvsResult::READ_FAILED:     return "Read failed";
        case NvsResult::NAMESPACE_ERROR: return "Namespace error";
        case NvsResult::KEY_TOO_LONG:    return "Key too long";
        case NvsResult::INVALID_ARGUMENT: return "Invalid argument";
        default:                         return "Unknown error";
    }
}

/**
 * @brief NVS Utility Class
 * 
 * Provides a scoped, RAII-style interface for NVS operations.
 * The namespace is automatically closed when the object is destroyed.
 * 
 * Usage:
 * @code
 * {
 *     NvsScope nvs("my_namespace");
 *     if (nvs.isOpen()) {
 *         String value = nvs.getString("key", "default");
 *         nvs.putString("key", "new_value");
 *     }
 * } // Namespace automatically closed
 * @endcode
 */
class NvsScope {
public:
    /**
     * @brief Construct and open an NVS namespace
     * @param ns_name Namespace name (max 15 characters)
     * @param readOnly Open in read-only mode
     * @param enableLogging Enable debug logging (default: false)
     */
    explicit NvsScope(const char* ns_name, bool readOnly = false, bool enableLogging = false);
    
    /**
     * @brief Destructor - automatically closes the namespace
     */
    ~NvsScope();
    
    // Prevent copying
    NvsScope(const NvsScope&) = delete;
    NvsScope& operator=(const NvsScope&) = delete;
    
    // Allow moving
    NvsScope(NvsScope&& other) noexcept;
    NvsScope& operator=(NvsScope&& other) noexcept;
    
    /**
     * @brief Check if namespace is open and ready
     * @return true if namespace is open
     */
    bool isOpen() const { return _opened; }
    
    /**
     * @brief Check if opened in read-only mode
     * @return true if read-only
     */
    bool isReadOnly() const { return _readonly; }
    
    /**
     * @brief Get the namespace name
     * @return Namespace name
     */
    const char* getNamespace() const { return _namespace.c_str(); }
    
    /**
     * @brief Get the last error result
     * @return Last operation result
     */
    NvsResult getLastResult() const { return _lastResult; }
    
    // ============== String Operations ==============
    
    /**
     * @brief Store a string value
     * @param key Key name (max 15 characters)
     * @param value String value to store
     * @return NvsResult::OK on success
     */
    NvsResult putString(const char* key, const String& value);
    
    /**
     * @brief Retrieve a string value
     * @param key Key name
     * @param defaultValue Value to return if key not found
     * @return Stored value or default
     */
    String getString(const char* key, const String& defaultValue = "") const;
    
    // ============== Integer Operations ==============
    
    /**
     * @brief Store an unsigned 32-bit integer
     * @param key Key name
     * @param value Value to store
     * @return NvsResult::OK on success
     */
    NvsResult putUInt(const char* key, uint32_t value);
    
    /**
     * @brief Retrieve an unsigned 32-bit integer
     * @param key Key name
     * @param defaultValue Value to return if key not found
     * @return Stored value or default
     */
    uint32_t getUInt(const char* key, uint32_t defaultValue = 0) const;
    
    /**
     * @brief Store a signed 32-bit integer
     * @param key Key name
     * @param value Value to store
     * @return NvsResult::OK on success
     */
    NvsResult putInt(const char* key, int32_t value);
    
    /**
     * @brief Retrieve a signed 32-bit integer
     * @param key Key name
     * @param defaultValue Value to return if key not found
     * @return Stored value or default
     */
    int32_t getInt(const char* key, int32_t defaultValue = 0) const;
    
    // ============== Boolean Operations ==============
    
    /**
     * @brief Store a boolean value
     * @param key Key name
     * @param value Value to store
     * @return NvsResult::OK on success
     */
    NvsResult putBool(const char* key, bool value);
    
    /**
     * @brief Retrieve a boolean value
     * @param key Key name
     * @param defaultValue Value to return if key not found
     * @return Stored value or default
     */
    bool getBool(const char* key, bool defaultValue = false) const;
    
    // ============== Bytes Operations ==============
    
    /**
     * @brief Store raw bytes
     * @param key Key name
     * @param data Pointer to data
     * @param length Length of data in bytes
     * @return NvsResult::OK on success
     */
    NvsResult putBytes(const char* key, const void* data, size_t length);
    
    /**
     * @brief Retrieve raw bytes
     * @param key Key name
     * @param buffer Buffer to store data
     * @param maxLength Maximum buffer size
     * @return Number of bytes read, or 0 on error
     */
    size_t getBytes(const char* key, void* buffer, size_t maxLength) const;
    
    /**
     * @brief Get the length of stored bytes
     * @param key Key name
     * @return Length in bytes, or 0 if not found
     */
    size_t getBytesLength(const char* key) const;
    
    // ============== Key Management ==============
    
    /**
     * @brief Check if a key exists
     * @param key Key name
     * @return true if key exists
     */
    bool hasKey(const char* key) const;
    
    /**
     * @brief Remove a key
     * @param key Key name
     * @return NvsResult::OK on success
     */
    NvsResult remove(const char* key);
    
    /**
     * @brief Clear all keys in the namespace
     * @return NvsResult::OK on success
     */
    NvsResult clear();

private:
    mutable Preferences _prefs;
    String _namespace;
    bool _opened;
    bool _readonly;
    bool _logging;
    mutable NvsResult _lastResult;
    
    /**
     * @brief Validate key length
     * @param key Key to validate
     * @return true if valid
     */
    bool validateKey(const char* key) const;
    
    /**
     * @brief Log a message if logging is enabled
     * @param format Printf-style format string
     */
    void log(const char* format, ...) const;
};

// ============== Convenience Functions ==============

/**
 * @brief Read a string from NVS (one-shot operation)
 * @param ns_name Namespace name
 * @param key Key name
 * @param defaultValue Default value if not found
 * @return Stored value or default
 */
inline String nvsReadString(const char* ns_name, const char* key, const String& defaultValue = "") {
    NvsScope nvs(ns_name, true);
    if (!nvs.isOpen()) return defaultValue;
    return nvs.getString(key, defaultValue);
}

/**
 * @brief Write a string to NVS (one-shot operation)
 * @param ns_name Namespace name
 * @param key Key name
 * @param value Value to write
 * @return NvsResult::OK on success
 */
inline NvsResult nvsWriteString(const char* ns_name, const char* key, const String& value) {
    NvsScope nvs(ns_name, false);
    if (!nvs.isOpen()) return NvsResult::NAMESPACE_ERROR;
    return nvs.putString(key, value);
}

/**
 * @brief Read an unsigned integer from NVS (one-shot operation)
 * @param ns_name Namespace name
 * @param key Key name
 * @param defaultValue Default value if not found
 * @return Stored value or default
 */
inline uint32_t nvsReadUInt(const char* ns_name, const char* key, uint32_t defaultValue = 0) {
    NvsScope nvs(ns_name, true);
    if (!nvs.isOpen()) return defaultValue;
    return nvs.getUInt(key, defaultValue);
}

/**
 * @brief Write an unsigned integer to NVS (one-shot operation)
 * @param ns_name Namespace name
 * @param key Key name
 * @param value Value to write
 * @return NvsResult::OK on success
 */
inline NvsResult nvsWriteUInt(const char* ns_name, const char* key, uint32_t value) {
    NvsScope nvs(ns_name, false);
    if (!nvs.isOpen()) return NvsResult::NAMESPACE_ERROR;
    return nvs.putUInt(key, value);
}

/**
 * @brief Read a boolean from NVS (one-shot operation)
 * @param ns_name Namespace name
 * @param key Key name
 * @param defaultValue Default value if not found
 * @return Stored value or default
 */
inline bool nvsReadBool(const char* ns_name, const char* key, bool defaultValue = false) {
    NvsScope nvs(ns_name, true);
    if (!nvs.isOpen()) return defaultValue;
    return nvs.getBool(key, defaultValue);
}

/**
 * @brief Write a boolean to NVS (one-shot operation)
 * @param ns_name Namespace name
 * @param key Key name
 * @param value Value to write
 * @return NvsResult::OK on success
 */
inline NvsResult nvsWriteBool(const char* ns_name, const char* key, bool value) {
    NvsScope nvs(ns_name, false);
    if (!nvs.isOpen()) return NvsResult::NAMESPACE_ERROR;
    return nvs.putBool(key, value);
}

#endif // NVS_UTILS_H
