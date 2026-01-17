/**
 * @file esp32FOTA.h
 * @brief Mock esp32FOTA for native simulation
 */

#ifndef ESP32FOTA_H
#define ESP32FOTA_H

#include "Arduino.h"

class esp32FOTA {
public:
    esp32FOTA(const char* firmwareType, int firmwareVersion) 
        : _type(firmwareType), _version(firmwareVersion), _available(false) {
        printf("[OTA] Initialized: type=%s, version=%d\n", firmwareType, firmwareVersion);
    }
    
    esp32FOTA(const char* firmwareType, const char* firmwareVersion)
        : _type(firmwareType), _versionStr(firmwareVersion), _version(0), _available(false) {
        printf("[OTA] Initialized: type=%s, version=%s\n", firmwareType, firmwareVersion);
    }
    
    void setManifestURL(const String& url) {
        _manifestUrl = url;
        printf("[OTA] Manifest URL set: %s\n", url.c_str());
    }
    
    void setManifestURL(const char* url) {
        setManifestURL(String(url));
    }
    
    bool execHTTPcheck() {
        printf("[OTA] Checking for updates at: %s\n", _manifestUrl.c_str());
        printf("[OTA] No updates available (simulation)\n");
        return _available;
    }
    
    void execOTA() {
        printf("[OTA] Would perform update (simulation - no actual update)\n");
    }
    
    String getPayloadVersion() {
        return _newVersion;
    }
    
    void setCheckURL(const String& url) {
        _checkUrl = url;
    }
    
    void forceUpdate(const String& firmwareURL, bool validate = true) {
        printf("[OTA] Force update from: %s (simulation)\n", firmwareURL.c_str());
    }
    
    void setCertFileSystem(void* fs) {}
    void setRootCA(const char* cert) {}
    void setProgressCb(std::function<void(size_t, size_t)> cb) {}
    void setUpdateBeginFailCb(std::function<void(int)> cb) {}
    void setUpdateCheckFailCb(std::function<void(int, int)> cb) {}
    void setUpdateFinishedCb(std::function<void(int, bool)> cb) {}
    
    // For testing: simulate update availability
    void simulateUpdateAvailable(const String& version) {
        _available = true;
        _newVersion = version;
        printf("[OTA] Simulating update available: %s\n", version.c_str());
    }

private:
    String _type;
    String _versionStr;
    int _version;
    String _manifestUrl;
    String _checkUrl;
    bool _available;
    String _newVersion;
};

#endif // ESP32FOTA_H
