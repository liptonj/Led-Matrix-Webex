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
