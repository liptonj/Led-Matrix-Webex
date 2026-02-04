/**
 * @file Arduino.h
 * @brief Mock Arduino API for native simulation
 * 
 * Provides stub implementations of Arduino core functions for testing
 * firmware logic without actual hardware.
 */

#ifndef ARDUINO_H
#define ARDUINO_H

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstdarg>
#include <cstring>
#include <string>
#include <chrono>
#include <thread>
#include <iostream>
#include <cmath>

// Arduino type definitions
typedef uint8_t byte;
typedef bool boolean;

// Pin modes
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define INPUT_PULLDOWN 3

// Digital values
#define HIGH 1
#define LOW 0

// Math macros
#ifndef PI
#define PI 3.14159265358979323846
#endif
#define DEG_TO_RAD 0.017453292519943295
#define RAD_TO_DEG 57.29577951308232

// NOTE: Arduino's min/max implemented as templates to avoid conflicts with std::min/max
template<typename T>
T arduino_min(T a, T b) { return (a < b) ? a : b; }
template<typename T>
T arduino_max(T a, T b) { return (a > b) ? a : b; }
#ifndef abs
#define abs(x) ((x)>0?(x):-(x))
#endif
#ifndef constrain
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
#endif

// NOTE: Arduino's map() is implemented as a function to avoid conflicts with std::map
inline long arduino_map(long x, long in_min, long in_max, long out_min, long out_max) {
    return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

// PROGMEM is not needed on native - data goes in regular memory
#define PROGMEM

// Bit manipulation
#define bit(b) (1UL << (b))
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitWrite(value, bit, bitvalue) ((bitvalue) ? bitSet(value, bit) : bitClear(value, bit))

#define lowByte(w) ((uint8_t) ((w) & 0xff))
#define highByte(w) ((uint8_t) ((w) >> 8))

// ============================================================================
// String class - Arduino-compatible String implementation
// ============================================================================
class String {
public:
    String() : _buffer("") {}
    String(const char* cstr) : _buffer(cstr ? cstr : "") {}
    String(const String& str) : _buffer(str._buffer) {}
    String(String&& str) noexcept : _buffer(std::move(str._buffer)) {}
    String(int value, int base = 10) {
        char buf[34];
        if (base == 16) {
            snprintf(buf, sizeof(buf), "%x", value);
        } else if (base == 8) {
            snprintf(buf, sizeof(buf), "%o", value);
        } else if (base == 2) {
            // Binary conversion
            std::string result;
            unsigned int uval = static_cast<unsigned int>(value);
            if (uval == 0) result = "0";
            while (uval > 0) {
                result = (char)('0' + (uval & 1)) + result;
                uval >>= 1;
            }
            _buffer = result;
            return;
        } else {
            snprintf(buf, sizeof(buf), "%d", value);
        }
        _buffer = buf;
    }
    String(unsigned int value, int base = 10) : String(static_cast<int>(value), base) {}
    String(long value, int base = 10) {
        char buf[34];
        if (base == 16) {
            snprintf(buf, sizeof(buf), "%lx", value);
        } else {
            snprintf(buf, sizeof(buf), "%ld", value);
        }
        _buffer = buf;
    }
    String(unsigned long value, int base = 10) {
        char buf[34];
        if (base == 16) {
            snprintf(buf, sizeof(buf), "%lx", value);
        } else {
            snprintf(buf, sizeof(buf), "%lu", value);
        }
        _buffer = buf;
    }
    String(float value, int decimalPlaces = 2) {
        char buf[32];
        snprintf(buf, sizeof(buf), "%.*f", decimalPlaces, value);
        _buffer = buf;
    }
    String(double value, int decimalPlaces = 2) {
        char buf[32];
        snprintf(buf, sizeof(buf), "%.*f", decimalPlaces, value);
        _buffer = buf;
    }

    // Assignment
    String& operator=(const String& rhs) { _buffer = rhs._buffer; return *this; }
    String& operator=(const char* cstr) { _buffer = cstr ? cstr : ""; return *this; }
    String& operator=(String&& rhs) noexcept { _buffer = std::move(rhs._buffer); return *this; }

    // Concatenation
    String& operator+=(const String& rhs) { _buffer += rhs._buffer; return *this; }
    String& operator+=(const char* cstr) { if (cstr) _buffer += cstr; return *this; }
    String& operator+=(char c) { _buffer += c; return *this; }
    String& operator+=(int num) { _buffer += std::to_string(num); return *this; }
    String& operator+=(unsigned int num) { _buffer += std::to_string(num); return *this; }
    String& operator+=(long num) { _buffer += std::to_string(num); return *this; }
    String& operator+=(unsigned long num) { _buffer += std::to_string(num); return *this; }
    String& operator+=(float num) { char buf[32]; snprintf(buf, sizeof(buf), "%.2f", num); _buffer += buf; return *this; }

    friend String operator+(const String& lhs, const String& rhs) { String s(lhs); s += rhs; return s; }
    friend String operator+(const String& lhs, const char* rhs) { String s(lhs); s += rhs; return s; }
    friend String operator+(const char* lhs, const String& rhs) { String s(lhs); s += rhs; return s; }

    // Comparison
    bool operator==(const String& rhs) const { return _buffer == rhs._buffer; }
    bool operator==(const char* cstr) const { return _buffer == (cstr ? cstr : ""); }
    bool operator!=(const String& rhs) const { return !(*this == rhs); }
    bool operator!=(const char* cstr) const { return !(*this == cstr); }
    bool operator<(const String& rhs) const { return _buffer < rhs._buffer; }
    bool operator>(const String& rhs) const { return _buffer > rhs._buffer; }
    bool operator<=(const String& rhs) const { return _buffer <= rhs._buffer; }
    bool operator>=(const String& rhs) const { return _buffer >= rhs._buffer; }

    friend bool operator==(const char* lhs, const String& rhs) { return rhs == lhs; }
    friend bool operator!=(const char* lhs, const String& rhs) { return rhs != lhs; }

    // Accessors
    char charAt(unsigned int index) const { return index < _buffer.length() ? _buffer[index] : 0; }
    void setCharAt(unsigned int index, char c) { if (index < _buffer.length()) _buffer[index] = c; }
    char operator[](unsigned int index) const { return charAt(index); }
    char& operator[](unsigned int index) { return _buffer[index]; }

    // Conversion
    const char* c_str() const { return _buffer.c_str(); }
    unsigned int length() const { return static_cast<unsigned int>(_buffer.length()); }
    bool isEmpty() const { return _buffer.empty(); }
    
    // Modification
    void clear() { _buffer.clear(); }
    String substring(unsigned int beginIndex) const { 
        if (beginIndex >= _buffer.length()) return String();
        return String(_buffer.substr(beginIndex).c_str()); 
    }
    String substring(unsigned int beginIndex, unsigned int endIndex) const { 
        if (beginIndex >= _buffer.length()) return String();
        return String(_buffer.substr(beginIndex, endIndex - beginIndex).c_str()); 
    }
    
    void toLowerCase() { for (auto& c : _buffer) c = std::tolower(c); }
    void toUpperCase() { for (auto& c : _buffer) c = std::toupper(c); }
    void trim() {
        size_t start = _buffer.find_first_not_of(" \t\r\n");
        size_t end = _buffer.find_last_not_of(" \t\r\n");
        if (start == std::string::npos) _buffer.clear();
        else _buffer = _buffer.substr(start, end - start + 1);
    }
    
    int indexOf(char ch) const { 
        auto pos = _buffer.find(ch); 
        return pos == std::string::npos ? -1 : static_cast<int>(pos); 
    }
    int indexOf(char ch, unsigned int fromIndex) const { 
        auto pos = _buffer.find(ch, fromIndex); 
        return pos == std::string::npos ? -1 : static_cast<int>(pos); 
    }
    int indexOf(const String& str) const { 
        auto pos = _buffer.find(str._buffer); 
        return pos == std::string::npos ? -1 : static_cast<int>(pos); 
    }
    int lastIndexOf(char ch) const { 
        auto pos = _buffer.rfind(ch); 
        return pos == std::string::npos ? -1 : static_cast<int>(pos); 
    }
    
    bool startsWith(const String& prefix) const { 
        return _buffer.compare(0, prefix._buffer.length(), prefix._buffer) == 0; 
    }
    bool endsWith(const String& suffix) const {
        if (suffix._buffer.length() > _buffer.length()) return false;
        return _buffer.compare(_buffer.length() - suffix._buffer.length(), suffix._buffer.length(), suffix._buffer) == 0;
    }
    
    void replace(const String& find, const String& replace) {
        size_t pos = 0;
        while ((pos = _buffer.find(find._buffer, pos)) != std::string::npos) {
            _buffer.replace(pos, find._buffer.length(), replace._buffer);
            pos += replace._buffer.length();
        }
    }
    
    void remove(unsigned int index) { if (index < _buffer.length()) _buffer.erase(index); }
    void remove(unsigned int index, unsigned int count) { if (index < _buffer.length()) _buffer.erase(index, count); }
    
    int toInt() const { return std::atoi(_buffer.c_str()); }
    float toFloat() const { return std::atof(_buffer.c_str()); }
    double toDouble() const { return std::strtod(_buffer.c_str(), nullptr); }
    
    // Reserve memory for the string buffer
    void reserve(unsigned int size) { 
        _buffer.reserve(size); 
    }
    
    // Stream-like methods for ArduinoJson compatibility
    size_t write(uint8_t c) { _buffer += static_cast<char>(c); return 1; }
    size_t write(const uint8_t* s, size_t n) { 
        _buffer.append(reinterpret_cast<const char*>(s), n); 
        return n; 
    }
    int read() const { 
        if (_readPos >= _buffer.length()) return -1;
        return static_cast<int>(_buffer[_readPos++]);
    }
    int available() const { return static_cast<int>(_buffer.length() - _readPos); }
    void resetReadPos() { _readPos = 0; }

    bool equalsIgnoreCase(const String& s) const {
        if (_buffer.length() != s._buffer.length()) return false;
        for (size_t i = 0; i < _buffer.length(); i++) {
            if (std::tolower(_buffer[i]) != std::tolower(s._buffer[i])) return false;
        }
        return true;
    }

    // Implicit conversion to std::string_view for ArduinoJson compatibility
    operator std::string_view() const { return std::string_view(_buffer); }

private:
    std::string _buffer;
    mutable size_t _readPos = 0;
};

// ============================================================================
// Serial class - Mock serial output
// ============================================================================
class HardwareSerial {
public:
    void begin(unsigned long baud) {
        printf("[Serial] Initialized at %lu baud\n", baud);
    }
    
    void end() {}
    
    int available() { return 0; }
    int read() { return -1; }
    int peek() { return -1; }
    void flush() { fflush(stdout); }
    
    size_t print(const char* str) { printf("%s", str); return strlen(str); }
    size_t print(const String& str) { printf("%s", str.c_str()); return str.length(); }
    size_t print(char c) { printf("%c", c); return 1; }
    size_t print(int n, int base = 10) { 
        if (base == 16) printf("%x", n);
        else printf("%d", n); 
        return 1; 
    }
    size_t print(unsigned int n, int base = 10) { 
        if (base == 16) printf("%x", n);
        else printf("%u", n); 
        return 1; 
    }
    size_t print(long n, int base = 10) { 
        if (base == 16) printf("%lx", n);
        else printf("%ld", n); 
        return 1; 
    }
    size_t print(unsigned long n, int base = 10) { 
        if (base == 16) printf("%lx", n);
        else printf("%lu", n); 
        return 1; 
    }
    size_t print(float n, int digits = 2) { printf("%.*f", digits, n); return 1; }
    size_t print(double n, int digits = 2) { printf("%.*f", digits, n); return 1; }
    
    size_t println() { printf("\n"); return 1; }
    size_t println(const char* str) { printf("%s\n", str); return strlen(str) + 1; }
    size_t println(const String& str) { printf("%s\n", str.c_str()); return str.length() + 1; }
    size_t println(char c) { printf("%c\n", c); return 2; }
    size_t println(int n, int base = 10) { print(n, base); printf("\n"); return 1; }
    size_t println(unsigned int n, int base = 10) { print(n, base); printf("\n"); return 1; }
    size_t println(long n, int base = 10) { print(n, base); printf("\n"); return 1; }
    size_t println(unsigned long n, int base = 10) { print(n, base); printf("\n"); return 1; }
    size_t println(float n, int digits = 2) { printf("%.*f\n", digits, n); return 1; }
    size_t println(double n, int digits = 2) { printf("%.*f\n", digits, n); return 1; }
    
    size_t write(uint8_t c) { putchar(c); return 1; }
    size_t write(const uint8_t* buffer, size_t size) { 
        fwrite(buffer, 1, size, stdout); 
        return size; 
    }
    
    // Printf-style output
    size_t printf(const char* format, ...) {
        va_list args;
        va_start(args, format);
        int result = vprintf(format, args);
        va_end(args);
        return result > 0 ? result : 0;
    }
    
    operator bool() { return true; }
};

extern HardwareSerial Serial;

// ============================================================================
// Time functions
// ============================================================================
inline unsigned long millis() {
    static auto start = std::chrono::steady_clock::now();
    auto now = std::chrono::steady_clock::now();
    return static_cast<unsigned long>(
        std::chrono::duration_cast<std::chrono::milliseconds>(now - start).count()
    );
}

inline unsigned long micros() {
    static auto start = std::chrono::steady_clock::now();
    auto now = std::chrono::steady_clock::now();
    return static_cast<unsigned long>(
        std::chrono::duration_cast<std::chrono::microseconds>(now - start).count()
    );
}

inline void delay(unsigned long ms) {
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

inline void delayMicroseconds(unsigned int us) {
    std::this_thread::sleep_for(std::chrono::microseconds(us));
}

inline void yield() {
    std::this_thread::yield();
}

// ============================================================================
// GPIO functions (stubs)
// ============================================================================
inline void pinMode(uint8_t pin, uint8_t mode) {
    // No-op in simulation
}

inline void digitalWrite(uint8_t pin, uint8_t val) {
    // No-op in simulation
}

inline int digitalRead(uint8_t pin) {
    return LOW;
}

inline int analogRead(uint8_t pin) {
    return 0;
}

inline void analogWrite(uint8_t pin, int val) {
    // No-op in simulation
}

// ============================================================================
// Random functions
// ============================================================================
inline long random(long max) {
    if (max == 0) return 0;
    return std::rand() % max;
}

inline long random(long min, long max) {
    if (min >= max) return min;
    return min + (std::rand() % (max - min));
}

inline void randomSeed(unsigned long seed) {
    std::srand(static_cast<unsigned int>(seed));
}

// ============================================================================
// ESP32-specific stubs
// ============================================================================
class EspClass {
public:
    void restart() {
        printf("[ESP] Restart requested - exiting simulation\n");
        exit(0);
    }
    
    uint32_t getFreeHeap() { return 256 * 1024; }  // 256KB simulated
    uint32_t getHeapSize() { return 320 * 1024; }
    uint32_t getMinFreeHeap() { return 200 * 1024; }
    uint32_t getMaxAllocHeap() { return 128 * 1024; }
    uint32_t getChipId() { return 0x12345678; }
    uint32_t getCpuFreqMHz() { return 240; }
    const char* getSdkVersion() { return "simulation-1.0.0"; }
    uint32_t getFlashChipSize() { return 8 * 1024 * 1024; }
    uint32_t getFlashChipSpeed() { return 80000000; }
    uint8_t getFlashChipMode() { return 0; }
    uint32_t getSketchSize() { return 1024 * 1024; }
    uint32_t getFreeSketchSpace() { return 3 * 1024 * 1024; }
    String getSketchMD5() { return "simulation"; }
    
    // Chip model detection for board_utils.h
    // In simulation, return based on compile-time defines for testing
    const char* getChipModel() {
        #if defined(ESP32_S3_BOARD)
        return "ESP32-S3";
        #elif defined(ESP32_S2_BOARD)
        return "ESP32-S2";
        #else
        return "ESP32";
        #endif
    }
    
    // PSRAM detection (simulation has no PSRAM)
    uint32_t getPsramSize() { return 0; }
};

extern EspClass ESP;

// ============================================================================
// IPAddress class
// ============================================================================
class IPAddress {
public:
    IPAddress() : _address{0, 0, 0, 0} {}
    IPAddress(uint8_t a, uint8_t b, uint8_t c, uint8_t d) : _address{a, b, c, d} {}
    
    String toString() const {
        char buf[16];
        snprintf(buf, sizeof(buf), "%d.%d.%d.%d", _address[0], _address[1], _address[2], _address[3]);
        return String(buf);
    }
    
    uint8_t operator[](int index) const { return _address[index]; }
    uint8_t& operator[](int index) { return _address[index]; }
    
    bool operator==(const IPAddress& other) const {
        return memcmp(_address, other._address, 4) == 0;
    }
    
    operator uint32_t() const {
        return (_address[0]) | (_address[1] << 8) | (_address[2] << 16) | (_address[3] << 24);
    }

private:
    uint8_t _address[4];
};

#endif // ARDUINO_H
