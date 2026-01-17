/**
 * @file ArduinoJson.h
 * @brief Redirect to actual ArduinoJson library
 * 
 * When using PlatformIO, ArduinoJson is installed as a library and included
 * automatically. For standalone compilation, you may need to install it
 * separately or use this mock.
 * 
 * For full functionality, install ArduinoJson:
 *   - PlatformIO: Added automatically via lib_deps
 *   - Manual: https://arduinojson.org/
 * 
 * This file provides minimal stub definitions for syntax checking only.
 */

#ifndef ARDUINOJSON_H
#define ARDUINOJSON_H

// Try to include the real ArduinoJson if available
#if __has_include(<ArduinoJson/ArduinoJson.hpp>)
    #include <ArduinoJson/ArduinoJson.hpp>
#elif __has_include("ArduinoJson/ArduinoJson.hpp")
    #include "ArduinoJson/ArduinoJson.hpp"
#else

// Minimal stub implementation for compilation checking
// This is NOT a full implementation - just enough to compile

#include "Arduino.h"
#include <string>
#include <map>
#include <vector>

namespace ArduinoJson {

class JsonVariant;
class JsonObject;
class JsonArray;

/**
 * @brief Minimal JsonDocument stub
 */
class JsonDocument {
public:
    JsonDocument() {}
    
    template<typename T>
    JsonVariant operator[](T key);
    
    void clear() { _data.clear(); }
    size_t memoryUsage() const { return 0; }
    size_t capacity() const { return 16384; }
    bool overflowed() const { return false; }
    
    // Internal storage
    std::map<std::string, std::string> _data;
    std::map<std::string, int> _intData;
    std::map<std::string, bool> _boolData;
    std::map<std::string, double> _floatData;
};

/**
 * @brief Minimal JsonVariant stub
 */
class JsonVariant {
public:
    JsonVariant() : _doc(nullptr), _key("") {}
    JsonVariant(JsonDocument* doc, const std::string& key) : _doc(doc), _key(key) {}
    
    // Assignment operators
    JsonVariant& operator=(const char* value) {
        if (_doc) _doc->_data[_key] = value;
        return *this;
    }
    JsonVariant& operator=(const String& value) {
        if (_doc) _doc->_data[_key] = value.c_str();
        return *this;
    }
    JsonVariant& operator=(int value) {
        if (_doc) _doc->_intData[_key] = value;
        return *this;
    }
    JsonVariant& operator=(bool value) {
        if (_doc) _doc->_boolData[_key] = value;
        return *this;
    }
    JsonVariant& operator=(double value) {
        if (_doc) _doc->_floatData[_key] = value;
        return *this;
    }
    JsonVariant& operator=(float value) {
        return *this = static_cast<double>(value);
    }
    
    // Type checking
    template<typename T>
    bool is() const { return true; }
    
    // Conversion
    template<typename T>
    T as() const;
    
    // Subscript for nested access
    JsonVariant operator[](const char* key) {
        return JsonVariant(_doc, _key + "." + key);
    }
    
    // For iteration
    bool isNull() const { return _doc == nullptr; }
    
private:
    JsonDocument* _doc;
    std::string _key;
};

// Template specializations
template<>
inline String JsonVariant::as<String>() const {
    if (_doc && _doc->_data.count(_key)) {
        return String(_doc->_data[_key].c_str());
    }
    return "";
}

template<>
inline int JsonVariant::as<int>() const {
    if (_doc && _doc->_intData.count(_key)) {
        return _doc->_intData[_key];
    }
    return 0;
}

template<>
inline uint8_t JsonVariant::as<uint8_t>() const {
    return static_cast<uint8_t>(as<int>());
}

template<>
inline uint16_t JsonVariant::as<uint16_t>() const {
    return static_cast<uint16_t>(as<int>());
}

template<>
inline bool JsonVariant::as<bool>() const {
    if (_doc && _doc->_boolData.count(_key)) {
        return _doc->_boolData[_key];
    }
    return false;
}

template<>
inline double JsonVariant::as<double>() const {
    if (_doc && _doc->_floatData.count(_key)) {
        return _doc->_floatData[_key];
    }
    return 0.0;
}

template<>
inline float JsonVariant::as<float>() const {
    return static_cast<float>(as<double>());
}

template<typename T>
JsonVariant JsonDocument::operator[](T key) {
    return JsonVariant(this, std::string(key));
}

/**
 * @brief Minimal JsonArray stub
 */
class JsonArray {
public:
    JsonArray() {}
    
    template<typename T>
    JsonVariant add() { return JsonVariant(); }
    
    size_t size() const { return 0; }
};

/**
 * @brief Minimal JsonObject stub
 */
class JsonObject {
public:
    JsonObject() {}
    
    JsonVariant operator[](const char* key) { return JsonVariant(); }
};

/**
 * @brief Deserialization error
 */
class DeserializationError {
public:
    enum Code {
        Ok = 0,
        EmptyInput,
        IncompleteInput,
        InvalidInput,
        NoMemory,
        TooDeep
    };
    
    DeserializationError(Code c = Ok) : _code(c) {}
    
    explicit operator bool() const { return _code != Ok; }
    const char* c_str() const {
        switch (_code) {
            case Ok: return "Ok";
            case EmptyInput: return "EmptyInput";
            case IncompleteInput: return "IncompleteInput";
            case InvalidInput: return "InvalidInput";
            case NoMemory: return "NoMemory";
            case TooDeep: return "TooDeep";
            default: return "Unknown";
        }
    }
    
private:
    Code _code;
};

} // namespace ArduinoJson

// Bring types into global namespace (Arduino style)
using ArduinoJson::JsonDocument;
using ArduinoJson::JsonVariant;
using ArduinoJson::JsonArray;
using ArduinoJson::JsonObject;
using ArduinoJson::DeserializationError;

/**
 * @brief Serialize JSON to string
 */
template<typename T>
size_t serializeJson(const JsonDocument& doc, T& output) {
    output = "{}";  // Minimal stub
    return 2;
}

/**
 * @brief Deserialize JSON from string
 */
inline DeserializationError deserializeJson(JsonDocument& doc, const String& input) {
    // Minimal stub - doesn't actually parse
    if (input.isEmpty()) {
        return DeserializationError(DeserializationError::EmptyInput);
    }
    return DeserializationError(DeserializationError::Ok);
}

inline DeserializationError deserializeJson(JsonDocument& doc, const char* input) {
    return deserializeJson(doc, String(input));
}

#endif // __has_include

#endif // ARDUINOJSON_H
