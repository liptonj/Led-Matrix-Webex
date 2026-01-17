/**
 * @file globals.cpp
 * @brief Global instance definitions for mock classes
 */

#include "Arduino.h"
#include "WiFi.h"
#include "ESPmDNS.h"
#include "Preferences.h"
#include "LittleFS.h"

// Global instances
HardwareSerial Serial;
EspClass ESP;
WiFiClass WiFi;
MDNSResponder MDNS;
LittleFSFS LittleFS;

// Preferences static storage
std::map<std::string, std::map<std::string, std::string>> Preferences::_storage;
std::map<std::string, std::map<std::string, uint32_t>> Preferences::_intStorage;
std::map<std::string, std::map<std::string, int64_t>> Preferences::_int64Storage;
std::map<std::string, std::map<std::string, float>> Preferences::_floatStorage;
std::map<std::string, std::map<std::string, std::string>> Preferences::_bytesStorage;
