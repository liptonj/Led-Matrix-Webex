/**
 * @file globals.cpp
 * @brief Global instance definitions for mock classes
 */

#include "Arduino.h"
#include "WiFi.h"
#include "ESPmDNS.h"
#include "LittleFS.h"

// Global instances
HardwareSerial Serial;
EspClass ESP;
WiFiClass WiFi;
MDNSResponder MDNS;
LittleFSFS LittleFS;

// Note: Preferences static storage is now defined inline in Preferences.h using C++17 inline static

// ============================================================================
// Mock serial_commands functions for native tests
// ============================================================================
// These functions are used by provision_helpers.cpp but serial_commands.cpp
// is not included in test builds, so we provide mock implementations here.

#ifdef NATIVE_BUILD
// Static storage for provision token (matches serial_commands.cpp implementation)
static String g_mock_provision_token = "";

void set_provision_token(const String& token) {
    g_mock_provision_token = token;
}

String get_provision_token() {
    return g_mock_provision_token;
}

void clear_provision_token() {
    g_mock_provision_token = "";
}

// Mock millis for native tests
unsigned long g_mock_millis = 0;

#endif // NATIVE_BUILD
