/**
 * @file nvs_utils.cpp
 * @brief NVS (Non-Volatile Storage) Utility Class Implementation
 */

#include "nvs_utils.h"
#include <cstdarg>
#include <cstdio>

// ============== NvsScope Implementation ==============

NvsScope::NvsScope(const char* ns_name, bool readOnly, bool enableLogging)
    : _namespace(ns_name)
    , _opened(false)
    , _readonly(readOnly)
    , _logging(enableLogging)
    , _lastResult(NvsResult::OK)
{
    if (ns_name == nullptr || strlen(ns_name) == 0) {
        _lastResult = NvsResult::INVALID_ARGUMENT;
        log("Invalid namespace name");
        return;
    }
    
    if (strlen(ns_name) > NVS_MAX_KEY_LENGTH) {
        _lastResult = NvsResult::KEY_TOO_LONG;
        log("Namespace name too long: %s", ns_name);
        return;
    }
    
    _opened = _prefs.begin(ns_name, readOnly);
    
    if (!_opened) {
        _lastResult = NvsResult::NAMESPACE_ERROR;
        log("Failed to open namespace: %s", ns_name);
    } else {
        log("Opened namespace: %s (readonly=%s)", ns_name, readOnly ? "true" : "false");
    }
}

NvsScope::~NvsScope() {
    if (_opened) {
        _prefs.end();
        log("Closed namespace: %s", _namespace.c_str());
    }
}

NvsScope::NvsScope(NvsScope&& other) noexcept
    : _namespace(std::move(other._namespace))
    , _opened(other._opened)
    , _readonly(other._readonly)
    , _logging(other._logging)
    , _lastResult(other._lastResult)
{
    other._opened = false;  // Prevent other from closing
}

NvsScope& NvsScope::operator=(NvsScope&& other) noexcept {
    if (this != &other) {
        // Close current namespace if open
        if (_opened) {
            _prefs.end();
        }
        
        _namespace = std::move(other._namespace);
        _opened = other._opened;
        _readonly = other._readonly;
        _logging = other._logging;
        _lastResult = other._lastResult;
        
        other._opened = false;  // Prevent other from closing
    }
    return *this;
}

bool NvsScope::validateKey(const char* key) const {
    if (key == nullptr || strlen(key) == 0) {
        _lastResult = NvsResult::INVALID_ARGUMENT;
        return false;
    }
    
    if (strlen(key) > NVS_MAX_KEY_LENGTH) {
        _lastResult = NvsResult::KEY_TOO_LONG;
        log("Key too long: %s (max %d)", key, NVS_MAX_KEY_LENGTH);
        return false;
    }
    
    return true;
}

void NvsScope::log(const char* format, ...) const {
    if (!_logging) return;
    
    char buffer[256];
    va_list args;
    va_start(args, format);
    vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);
    
    Serial.printf("%s %s\n", NVS_LOG_TAG, buffer);
}

// ============== String Operations ==============

NvsResult NvsScope::putString(const char* key, const String& value) {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return _lastResult;
    }
    
    if (_readonly) {
        _lastResult = NvsResult::READ_ONLY;
        log("Cannot write in read-only mode: %s", key);
        return _lastResult;
    }
    
    if (!validateKey(key)) {
        return _lastResult;
    }
    
    size_t written = _prefs.putString(key, value);
    if (written == 0 && value.length() > 0) {
        _lastResult = NvsResult::WRITE_FAILED;
        log("Failed to write string: %s", key);
        return _lastResult;
    }
    
    log("Wrote string: %s = %s", key, value.c_str());
    _lastResult = NvsResult::OK;
    return _lastResult;
}

String NvsScope::getString(const char* key, const String& defaultValue) const {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return defaultValue;
    }
    
    if (!validateKey(key)) {
        return defaultValue;
    }
    
    // Check if key exists
    if (!_prefs.isKey(key)) {
        _lastResult = NvsResult::KEY_NOT_FOUND;
        return defaultValue;
    }
    
    String value = _prefs.getString(key, defaultValue);
    _lastResult = NvsResult::OK;
    log("Read string: %s = %s", key, value.c_str());
    return value;
}

// ============== Integer Operations ==============

NvsResult NvsScope::putUInt(const char* key, uint32_t value) {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return _lastResult;
    }
    
    if (_readonly) {
        _lastResult = NvsResult::READ_ONLY;
        log("Cannot write in read-only mode: %s", key);
        return _lastResult;
    }
    
    if (!validateKey(key)) {
        return _lastResult;
    }
    
    size_t written = _prefs.putUInt(key, value);
    if (written == 0) {
        _lastResult = NvsResult::WRITE_FAILED;
        log("Failed to write uint: %s", key);
        return _lastResult;
    }
    
    log("Wrote uint: %s = %u", key, value);
    _lastResult = NvsResult::OK;
    return _lastResult;
}

uint32_t NvsScope::getUInt(const char* key, uint32_t defaultValue) const {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return defaultValue;
    }
    
    if (!validateKey(key)) {
        return defaultValue;
    }
    
    uint32_t value = _prefs.getUInt(key, defaultValue);
    _lastResult = NvsResult::OK;
    log("Read uint: %s = %u", key, value);
    return value;
}

NvsResult NvsScope::putInt(const char* key, int32_t value) {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return _lastResult;
    }
    
    if (_readonly) {
        _lastResult = NvsResult::READ_ONLY;
        log("Cannot write in read-only mode: %s", key);
        return _lastResult;
    }
    
    if (!validateKey(key)) {
        return _lastResult;
    }
    
    size_t written = _prefs.putInt(key, value);
    if (written == 0) {
        _lastResult = NvsResult::WRITE_FAILED;
        log("Failed to write int: %s", key);
        return _lastResult;
    }
    
    log("Wrote int: %s = %d", key, value);
    _lastResult = NvsResult::OK;
    return _lastResult;
}

int32_t NvsScope::getInt(const char* key, int32_t defaultValue) const {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return defaultValue;
    }
    
    if (!validateKey(key)) {
        return defaultValue;
    }
    
    int32_t value = _prefs.getInt(key, defaultValue);
    _lastResult = NvsResult::OK;
    log("Read int: %s = %d", key, value);
    return value;
}

// ============== Boolean Operations ==============

NvsResult NvsScope::putBool(const char* key, bool value) {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return _lastResult;
    }
    
    if (_readonly) {
        _lastResult = NvsResult::READ_ONLY;
        log("Cannot write in read-only mode: %s", key);
        return _lastResult;
    }
    
    if (!validateKey(key)) {
        return _lastResult;
    }
    
    size_t written = _prefs.putBool(key, value);
    if (written == 0) {
        _lastResult = NvsResult::WRITE_FAILED;
        log("Failed to write bool: %s", key);
        return _lastResult;
    }
    
    log("Wrote bool: %s = %s", key, value ? "true" : "false");
    _lastResult = NvsResult::OK;
    return _lastResult;
}

bool NvsScope::getBool(const char* key, bool defaultValue) const {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return defaultValue;
    }
    
    if (!validateKey(key)) {
        return defaultValue;
    }
    
    bool value = _prefs.getBool(key, defaultValue);
    _lastResult = NvsResult::OK;
    log("Read bool: %s = %s", key, value ? "true" : "false");
    return value;
}

// ============== Bytes Operations ==============

NvsResult NvsScope::putBytes(const char* key, const void* data, size_t length) {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return _lastResult;
    }
    
    if (_readonly) {
        _lastResult = NvsResult::READ_ONLY;
        log("Cannot write in read-only mode: %s", key);
        return _lastResult;
    }
    
    if (!validateKey(key)) {
        return _lastResult;
    }
    
    if (data == nullptr && length > 0) {
        _lastResult = NvsResult::INVALID_ARGUMENT;
        log("Invalid data pointer for: %s", key);
        return _lastResult;
    }
    
    size_t written = _prefs.putBytes(key, data, length);
    if (written != length) {
        _lastResult = NvsResult::WRITE_FAILED;
        log("Failed to write bytes: %s (wrote %zu of %zu)", key, written, length);
        return _lastResult;
    }
    
    log("Wrote bytes: %s (%zu bytes)", key, length);
    _lastResult = NvsResult::OK;
    return _lastResult;
}

size_t NvsScope::getBytes(const char* key, void* buffer, size_t maxLength) const {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return 0;
    }
    
    if (!validateKey(key)) {
        return 0;
    }
    
    if (buffer == nullptr || maxLength == 0) {
        _lastResult = NvsResult::INVALID_ARGUMENT;
        log("Invalid buffer for: %s", key);
        return 0;
    }
    
    size_t storedLen = _prefs.getBytesLength(key);
    if (storedLen == 0) {
        _lastResult = NvsResult::KEY_NOT_FOUND;
        return 0;
    }
    
    size_t readLen = _prefs.getBytes(key, buffer, maxLength);
    _lastResult = NvsResult::OK;
    log("Read bytes: %s (%zu bytes)", key, readLen);
    return readLen;
}

size_t NvsScope::getBytesLength(const char* key) const {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return 0;
    }
    
    if (!validateKey(key)) {
        return 0;
    }
    
    size_t length = _prefs.getBytesLength(key);
    _lastResult = NvsResult::OK;
    return length;
}

// ============== Key Management ==============

bool NvsScope::hasKey(const char* key) const {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return false;
    }
    
    if (!validateKey(key)) {
        return false;
    }
    
    bool exists = _prefs.isKey(key);
    _lastResult = NvsResult::OK;
    return exists;
}

NvsResult NvsScope::remove(const char* key) {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return _lastResult;
    }
    
    if (_readonly) {
        _lastResult = NvsResult::READ_ONLY;
        log("Cannot remove in read-only mode: %s", key);
        return _lastResult;
    }
    
    if (!validateKey(key)) {
        return _lastResult;
    }
    
    bool removed = _prefs.remove(key);
    if (!removed) {
        _lastResult = NvsResult::KEY_NOT_FOUND;
        log("Key not found for removal: %s", key);
        return _lastResult;
    }
    
    log("Removed key: %s", key);
    _lastResult = NvsResult::OK;
    return _lastResult;
}

NvsResult NvsScope::clear() {
    if (!_opened) {
        _lastResult = NvsResult::NOT_INITIALIZED;
        return _lastResult;
    }
    
    if (_readonly) {
        _lastResult = NvsResult::READ_ONLY;
        log("Cannot clear in read-only mode");
        return _lastResult;
    }
    
    bool cleared = _prefs.clear();
    if (!cleared) {
        _lastResult = NvsResult::WRITE_FAILED;
        log("Failed to clear namespace: %s", _namespace.c_str());
        return _lastResult;
    }
    
    log("Cleared namespace: %s", _namespace.c_str());
    _lastResult = NvsResult::OK;
    return _lastResult;
}
