/**
 * @file Preferences.h
 * @brief Mock ESP32 Preferences (NVS) for native simulation
 * 
 * Stores preferences in memory for simulation purposes.
 * Data is not persisted between runs.
 */

#ifndef PREFERENCES_H
#define PREFERENCES_H

#include "Arduino.h"
#include <map>
#include <string>

class Preferences {
public:
    Preferences() : _opened(false), _readonly(false) {}
    
    bool begin(const char* name, bool readOnly = false) {
        _namespace = name;
        _opened = true;
        _readonly = readOnly;
        printf("[Preferences] Opened namespace '%s' (readonly=%s)\n", 
               name, readOnly ? "true" : "false");
        return true;
    }
    
    void end() {
        _opened = false;
        printf("[Preferences] Closed namespace '%s'\n", _namespace.c_str());
    }
    
    bool clear() {
        if (_readonly) return false;
        _storage[_namespace].clear();
        _intStorage[_namespace].clear();
        _int64Storage[_namespace].clear();
        _floatStorage[_namespace].clear();
        _bytesStorage[_namespace].clear();
        printf("[Preferences] Cleared namespace '%s'\n", _namespace.c_str());
        return true;
    }
    
    // Static method to clear all storage across all namespaces (for testing)
    static void clearAll() {
        _storage.clear();
        _intStorage.clear();
        _int64Storage.clear();
        _floatStorage.clear();
        _bytesStorage.clear();
        printf("[Preferences] Cleared all static storage\n");
    }
    
    bool remove(const char* key) {
        if (_readonly) return false;
        _storage[_namespace].erase(key);
        return true;
    }
    
    // String operations
    size_t putString(const char* key, const String& value) {
        if (_readonly) return 0;
        _storage[_namespace][key] = value.c_str();
        return value.length();
    }
    
    size_t putString(const char* key, const char* value) {
        return putString(key, String(value));
    }
    
    String getString(const char* key, const String& defaultValue = "") const {
        auto ns_it = _storage.find(_namespace);
        if (ns_it == _storage.end()) return defaultValue;
        auto it = ns_it->second.find(key);
        if (it == ns_it->second.end()) return defaultValue;
        return String(it->second.c_str());
    }
    
    // Integer operations
    size_t putUInt(const char* key, uint32_t value) {
        if (_readonly) return 0;
        _intStorage[_namespace][key] = value;
        return sizeof(value);
    }
    
    uint32_t getUInt(const char* key, uint32_t defaultValue = 0) const {
        auto ns_it = _intStorage.find(_namespace);
        if (ns_it == _intStorage.end()) return defaultValue;
        auto it = ns_it->second.find(key);
        if (it == ns_it->second.end()) return defaultValue;
        return it->second;
    }
    
    size_t putInt(const char* key, int32_t value) {
        return putUInt(key, static_cast<uint32_t>(value));
    }
    
    int32_t getInt(const char* key, int32_t defaultValue = 0) const {
        return static_cast<int32_t>(getUInt(key, static_cast<uint32_t>(defaultValue)));
    }
    
    size_t putUChar(const char* key, uint8_t value) {
        return putUInt(key, value);
    }
    
    uint8_t getUChar(const char* key, uint8_t defaultValue = 0) const {
        return static_cast<uint8_t>(getUInt(key, defaultValue));
    }
    
    size_t putChar(const char* key, int8_t value) {
        return putUInt(key, static_cast<uint32_t>(value));
    }
    
    int8_t getChar(const char* key, int8_t defaultValue = 0) const {
        return static_cast<int8_t>(getUInt(key, static_cast<uint32_t>(defaultValue)));
    }
    
    size_t putUShort(const char* key, uint16_t value) {
        return putUInt(key, value);
    }
    
    uint16_t getUShort(const char* key, uint16_t defaultValue = 0) const {
        return static_cast<uint16_t>(getUInt(key, defaultValue));
    }
    
    size_t putShort(const char* key, int16_t value) {
        return putUInt(key, static_cast<uint32_t>(value));
    }
    
    int16_t getShort(const char* key, int16_t defaultValue = 0) const {
        return static_cast<int16_t>(getUInt(key, static_cast<uint32_t>(defaultValue)));
    }
    
    size_t putLong(const char* key, int32_t value) {
        return putInt(key, value);
    }
    
    int32_t getLong(const char* key, int32_t defaultValue = 0) const {
        return getInt(key, defaultValue);
    }
    
    size_t putULong(const char* key, uint32_t value) {
        return putUInt(key, value);
    }
    
    uint32_t getULong(const char* key, uint32_t defaultValue = 0) const {
        return getUInt(key, defaultValue);
    }
    
    // 64-bit operations
    size_t putLong64(const char* key, int64_t value) {
        if (_readonly) return 0;
        _int64Storage[_namespace][key] = value;
        return sizeof(value);
    }
    
    int64_t getLong64(const char* key, int64_t defaultValue = 0) const {
        auto ns_it = _int64Storage.find(_namespace);
        if (ns_it == _int64Storage.end()) return defaultValue;
        auto it = ns_it->second.find(key);
        if (it == ns_it->second.end()) return defaultValue;
        return it->second;
    }
    
    size_t putULong64(const char* key, uint64_t value) {
        return putLong64(key, static_cast<int64_t>(value));
    }
    
    uint64_t getULong64(const char* key, uint64_t defaultValue = 0) const {
        return static_cast<uint64_t>(getLong64(key, static_cast<int64_t>(defaultValue)));
    }
    
    // Float operations
    size_t putFloat(const char* key, float value) {
        if (_readonly) return 0;
        _floatStorage[_namespace][key] = value;
        return sizeof(value);
    }
    
    float getFloat(const char* key, float defaultValue = 0.0f) const {
        auto ns_it = _floatStorage.find(_namespace);
        if (ns_it == _floatStorage.end()) return defaultValue;
        auto it = ns_it->second.find(key);
        if (it == ns_it->second.end()) return defaultValue;
        return it->second;
    }
    
    size_t putDouble(const char* key, double value) {
        return putFloat(key, static_cast<float>(value));
    }
    
    double getDouble(const char* key, double defaultValue = 0.0) const {
        return static_cast<double>(getFloat(key, static_cast<float>(defaultValue)));
    }
    
    // Bool operations
    size_t putBool(const char* key, bool value) {
        return putUInt(key, value ? 1 : 0);
    }
    
    bool getBool(const char* key, bool defaultValue = false) const {
        return getUInt(key, defaultValue ? 1 : 0) != 0;
    }
    
    // Bytes operations
    size_t putBytes(const char* key, const void* value, size_t len) {
        if (_readonly) return 0;
        std::string data(static_cast<const char*>(value), len);
        _bytesStorage[_namespace][key] = data;
        return len;
    }
    
    size_t getBytes(const char* key, void* buf, size_t maxLen) const {
        auto ns_it = _bytesStorage.find(_namespace);
        if (ns_it == _bytesStorage.end()) return 0;
        auto it = ns_it->second.find(key);
        if (it == ns_it->second.end()) return 0;
        size_t copyLen = std::min(maxLen, it->second.length());
        memcpy(buf, it->second.data(), copyLen);
        return copyLen;
    }
    
    size_t getBytesLength(const char* key) const {
        auto ns_it = _bytesStorage.find(_namespace);
        if (ns_it == _bytesStorage.end()) return 0;
        auto it = ns_it->second.find(key);
        if (it == ns_it->second.end()) return 0;
        return it->second.length();
    }
    
    bool isKey(const char* key) const {
        auto ns_it = _storage.find(_namespace);
        if (ns_it != _storage.end() && ns_it->second.find(key) != ns_it->second.end()) return true;
        auto int_it = _intStorage.find(_namespace);
        if (int_it != _intStorage.end() && int_it->second.find(key) != int_it->second.end()) return true;
        return false;
    }
    
    size_t freeEntries() const { return 100; }  // Simulated

private:
    bool _opened;
    bool _readonly;
    std::string _namespace;
    
    // Static storage shared across all instances
    static std::map<std::string, std::map<std::string, std::string>> _storage;
    static std::map<std::string, std::map<std::string, uint32_t>> _intStorage;
    static std::map<std::string, std::map<std::string, int64_t>> _int64Storage;
    static std::map<std::string, std::map<std::string, float>> _floatStorage;
    static std::map<std::string, std::map<std::string, std::string>> _bytesStorage;
};

#endif // PREFERENCES_H
