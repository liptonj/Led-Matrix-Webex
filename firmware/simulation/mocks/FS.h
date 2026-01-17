/**
 * @file FS.h
 * @brief Mock filesystem base classes for native simulation
 */

#ifndef FS_H
#define FS_H

#include "Arduino.h"

namespace fs {

enum SeekMode {
    SeekSet = 0,
    SeekCur = 1,
    SeekEnd = 2
};

class File {
public:
    File() : _valid(false) {}
    
    operator bool() const { return _valid; }
    
    size_t write(uint8_t data) { return 1; }
    size_t write(const uint8_t* buf, size_t size) { return size; }
    
    int available() { return 0; }
    int read() { return -1; }
    size_t read(uint8_t* buf, size_t size) { return 0; }
    
    bool seek(uint32_t pos, SeekMode mode = SeekSet) { return true; }
    size_t position() { return 0; }
    size_t size() { return 0; }
    
    void close() { _valid = false; }
    
    const char* name() { return ""; }
    const char* path() { return ""; }
    
    bool isDirectory() { return false; }
    File openNextFile() { return File(); }
    void rewindDirectory() {}
    
    time_t getLastWrite() { return 0; }
    
    size_t print(const char* str) { return strlen(str); }
    size_t print(const String& str) { return str.length(); }
    size_t println(const char* str = "") { return strlen(str) + 1; }
    size_t println(const String& str) { return str.length() + 1; }

private:
    bool _valid;
};

class FS {
public:
    File open(const char* path, const char* mode = "r") {
        printf("[FS] Open: %s (mode=%s) - simulated empty\n", path, mode);
        return File();
    }
    
    File open(const String& path, const char* mode = "r") {
        return open(path.c_str(), mode);
    }
    
    bool exists(const char* path) { return false; }
    bool exists(const String& path) { return exists(path.c_str()); }
    
    bool remove(const char* path) { return true; }
    bool remove(const String& path) { return remove(path.c_str()); }
    
    bool rename(const char* pathFrom, const char* pathTo) { return true; }
    bool rename(const String& pathFrom, const String& pathTo) {
        return rename(pathFrom.c_str(), pathTo.c_str());
    }
    
    bool mkdir(const char* path) { return true; }
    bool mkdir(const String& path) { return mkdir(path.c_str()); }
    
    bool rmdir(const char* path) { return true; }
    bool rmdir(const String& path) { return rmdir(path.c_str()); }
};

} // namespace fs

using fs::File;
using fs::FS;
using fs::SeekMode;

#endif // FS_H
