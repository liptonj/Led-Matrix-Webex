/**
 * @file LittleFS.h
 * @brief Mock LittleFS for native simulation
 */

#ifndef LITTLEFS_H
#define LITTLEFS_H

#include "Arduino.h"
#include "FS.h"

class LittleFSFS : public fs::FS {
public:
    LittleFSFS() : _mounted(false) {}
    
    bool begin(bool formatOnFail = false) {
        _mounted = true;
        printf("[LittleFS] Mounted (simulation)\n");
        return true;
    }
    
    bool format() {
        printf("[LittleFS] Formatted\n");
        return true;
    }
    
    void end() {
        _mounted = false;
        printf("[LittleFS] Unmounted\n");
    }
    
    bool exists(const char* path) {
        return false;  // Simulate no files
    }
    
    bool exists(const String& path) {
        return exists(path.c_str());
    }
    
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
    
    size_t totalBytes() { return 1024 * 1024; }  // 1MB simulated
    size_t usedBytes() { return 256 * 1024; }    // 256KB simulated

private:
    bool _mounted;
};

extern LittleFSFS LittleFS;

#endif // LITTLEFS_H
