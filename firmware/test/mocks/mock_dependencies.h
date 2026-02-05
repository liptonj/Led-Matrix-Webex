/**
 * @file mock_dependencies.h
 * @brief Mock dependencies for unit testing
 *
 * Provides mock implementations of external dependencies for isolated testing.
 */

#ifndef MOCK_DEPENDENCIES_H
#define MOCK_DEPENDENCIES_H

#include <string>
#include <functional>
#include <Arduino.h>
#include <ArduinoJson.h>

// Mock NVS config storage
struct MockConfigManager {
    char device_uuid[37] = "";
    char user_uuid[37] = "";
    char display_name[64] = "";
    char last_webex_status[128] = "";
    
    void setDeviceUuid(const char* uuid) {
        strncpy(device_uuid, uuid, 36);
        device_uuid[36] = '\0';
    }
    
    void setUserUuid(const char* uuid) {
        strncpy(user_uuid, uuid, 36);
        user_uuid[36] = '\0';
    }
    
    void setDisplayName(const char* name) {
        strncpy(display_name, name, 63);
        display_name[63] = '\0';
    }
    
    void setLastWebexStatus(const char* status) {
        strncpy(last_webex_status, status, 127);
        last_webex_status[127] = '\0';
    }
    
    const char* getDeviceUuid() const { return device_uuid; }
    const char* getUserUuid() const { return user_uuid; }
    const char* getDisplayName() const { return display_name; }
    const char* getLastWebexStatus() const { return last_webex_status; }
    
    void clear() {
        memset(device_uuid, 0, sizeof(device_uuid));
        memset(user_uuid, 0, sizeof(user_uuid));
        memset(display_name, 0, sizeof(display_name));
        memset(last_webex_status, 0, sizeof(last_webex_status));
    }
};

// Global mock instance
inline MockConfigManager mockConfig;

// Mock realtime channel subscription tracking
struct MockRealtimeChannel {
    std::string channelName;
    bool subscribed = false;
    
    void subscribe(const std::string& name) {
        channelName = name;
        subscribed = true;
    }
    
    void unsubscribe() {
        subscribed = false;
    }
    
    void clear() {
        channelName.clear();
        subscribed = false;
    }
};

inline MockRealtimeChannel mockUserChannel;
inline MockRealtimeChannel mockDeviceChannel;

// Mock LED display update tracking
struct MockDisplayUpdate {
    std::string lastStatus;
    bool inCall = false;
    bool cameraOn = false;
    bool micMuted = false;
    std::string displayName;
    int updateCount = 0;
    
    void update(const char* status, bool call, bool camera, bool mic, const char* name) {
        lastStatus = status ? status : "";
        inCall = call;
        cameraOn = camera;
        micMuted = mic;
        displayName = name ? name : "";
        updateCount++;
    }
    
    void clear() {
        lastStatus.clear();
        inCall = false;
        cameraOn = false;
        micMuted = false;
        displayName.clear();
        updateCount = 0;
    }
};

inline MockDisplayUpdate mockDisplay;

// Mock functions for the handlers
inline void mockHandleWebexStatusUpdate(JsonObject& payload) {
    const char* status = payload["webex_status"];
    bool call = payload["in_call"] | false;
    bool camera = payload["camera_on"] | false;
    bool mic = payload["mic_muted"] | false;
    const char* name = payload["display_name"];
    
    mockDisplay.update(status, call, camera, mic, name);
    
    if (name && strlen(name) > 0) {
        mockConfig.setDisplayName(name);
    }
    if (status) {
        mockConfig.setLastWebexStatus(status);
    }
}

inline void mockHandleUserAssigned(JsonObject& payload) {
    const char* user_uuid = payload["user_uuid"];
    if (user_uuid && strlen(user_uuid) > 0) {
        mockConfig.setUserUuid(user_uuid);
    }
}

inline bool mockFilterByDeviceUuid(JsonObject& payload, const char* expectedDeviceUuid) {
    const char* device_uuid = payload["device_uuid"];
    if (!device_uuid || !expectedDeviceUuid) return false;
    return strcmp(device_uuid, expectedDeviceUuid) == 0;
}

// Reset all mocks
inline void resetAllMocks() {
    mockConfig.clear();
    mockUserChannel.clear();
    mockDeviceChannel.clear();
    mockDisplay.clear();
}

#endif // MOCK_DEPENDENCIES_H
