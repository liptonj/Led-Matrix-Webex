/**
 * @file serial_commands.cpp
 * @brief Serial Command Handler Implementation
 */

#include "serial_commands.h"
#include "../config/config_manager.h"
#include <WiFi.h>
#include <Preferences.h>

// External references
extern ConfigManager config_manager;

// Serial command state
static String serial_buffer = "";
static bool wifi_pending = false;
static String pending_ssid = "";
static String pending_password = "";

// Forward declarations
static void handle_wifi_command(const String& command);
static void handle_scan_command();
static void handle_status_command();
static void handle_factory_reset_command();
static void handle_help_command();

void serial_commands_begin() {
    serial_buffer = "";
    wifi_pending = false;
    pending_ssid = "";
    pending_password = "";
    Serial.println("[SERIAL] Command handler initialized");
}

void serial_commands_loop() {
    while (Serial.available()) {
        char c = Serial.read();
        
        if (c == '\n' || c == '\r') {
            if (serial_buffer.length() > 0) {
                serial_buffer.trim();
                
                // Log received command (mask password)
                if (serial_buffer.startsWith("WIFI:")) {
                    Serial.println("[SERIAL] Received WiFi configuration command");
                } else {
                    Serial.printf("[SERIAL] Received: %s\n", serial_buffer.c_str());
                }
                
                // Process command
                if (serial_buffer.startsWith("WIFI:")) {
                    handle_wifi_command(serial_buffer);
                } else if (serial_buffer == "STATUS") {
                    handle_status_command();
                } else if (serial_buffer == "SCAN") {
                    handle_scan_command();
                } else if (serial_buffer == "FACTORY_RESET") {
                    handle_factory_reset_command();
                } else if (serial_buffer == "HELP") {
                    handle_help_command();
                } else {
                    Serial.printf("[SERIAL] Unknown command: %s\n", serial_buffer.c_str());
                    Serial.println("[SERIAL] Type HELP for available commands");
                }
                
                serial_buffer = "";
            }
        } else {
            serial_buffer += c;
            
            // Prevent buffer overflow
            if (serial_buffer.length() > 256) {
                Serial.println("[SERIAL] Buffer overflow, clearing");
                serial_buffer = "";
            }
        }
    }
}

bool serial_wifi_pending() {
    return wifi_pending;
}

void serial_wifi_clear_pending() {
    wifi_pending = false;
    pending_ssid = "";
    pending_password = "";
}

String serial_wifi_get_ssid() {
    return pending_ssid;
}

String serial_wifi_get_password() {
    return pending_password;
}

/**
 * @brief Handle WIFI serial command
 * Format: WIFI:<ssid>:<password>
 */
static void handle_wifi_command(const String& command) {
    // Parse command: WIFI:<ssid>:<password>
    // Find first colon after "WIFI:"
    int first_colon = command.indexOf(':', 5);
    if (first_colon < 0) {
        Serial.println("[SERIAL] Invalid WIFI command format");
        Serial.println("[SERIAL] Usage: WIFI:<ssid>:<password>");
        return;
    }
    
    // Rest is password (may contain colons)
    String ssid = command.substring(5, first_colon);
    String password = command.substring(first_colon + 1);
    
    // Remove trailing flags if present (backwards compatibility with bootstrap format)
    // WIFI:ssid:password:1 -> ignore the :1
    int last_colon = password.lastIndexOf(':');
    if (last_colon >= 0) {
        String suffix = password.substring(last_colon + 1);
        if (suffix == "0" || suffix == "1" || suffix == "true" || suffix == "false") {
            password = password.substring(0, last_colon);
        }
    }
    
    if (ssid.isEmpty()) {
        Serial.println("[SERIAL] Error: SSID cannot be empty");
        return;
    }
    
    Serial.printf("[SERIAL] Configuring WiFi: SSID='%s'\n", ssid.c_str());
    
    // Save credentials using config manager
    config_manager.setWiFiCredentials(ssid, password);
    
    // Set pending flag for main loop to handle connection
    wifi_pending = true;
    pending_ssid = ssid;
    pending_password = password;
    
    Serial.println("[SERIAL] WiFi credentials saved, connecting...");
}

/**
 * @brief Handle SCAN command - list available WiFi networks
 */
static void handle_scan_command() {
    Serial.println("[SERIAL] Scanning WiFi networks...");
    
    // Perform a fresh scan
    int n = WiFi.scanNetworks(false, false);  // Sync scan, no hidden networks
    
    Serial.println("[SERIAL] Available networks:");
    if (n == 0) {
        Serial.println("[SERIAL] No networks found");
    } else {
        for (int i = 0; i < n; i++) {
            Serial.printf("  %d. %s (%d dBm)%s\n",
                          i + 1,
                          WiFi.SSID(i).c_str(),
                          WiFi.RSSI(i),
                          WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "" : " [secured]");
        }
    }
    Serial.println("[SERIAL] Scan complete");
    
    // Clean up scan results
    WiFi.scanDelete();
}

/**
 * @brief Handle STATUS command - print device status
 */
static void handle_status_command() {
    Serial.println();
    Serial.println("=== DEVICE STATUS ===");
    
    // WiFi status
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("WiFi: Connected to '%s'\n", WiFi.SSID().c_str());
        Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("Signal: %d dBm\n", WiFi.RSSI());
    } else {
        Serial.println("WiFi: Not connected");
        if (WiFi.getMode() & WIFI_AP) {
            Serial.printf("AP Mode: Active (IP: %s)\n", WiFi.softAPIP().toString().c_str());
        }
    }
    
    // System info
    Serial.printf("Free Heap: %d bytes\n", ESP.getFreeHeap());
    Serial.printf("Uptime: %lu seconds\n", millis() / 1000);
    
    // Firmware version
    #ifdef FIRMWARE_VERSION
    Serial.printf("Firmware: %s\n", FIRMWARE_VERSION);
    #endif
    
    Serial.println("=====================");
    Serial.println();
}

/**
 * @brief Handle FACTORY_RESET command - clear all settings
 */
static void handle_factory_reset_command() {
    Serial.println("[SERIAL] ⚠️  FACTORY RESET requested!");
    Serial.println("[SERIAL] This will erase all settings (WiFi, Webex, etc.)");
    Serial.println("[SERIAL] Device will reboot in 3 seconds...");
    
    delay(1000);
    Serial.println("[SERIAL] 2...");
    delay(1000);
    Serial.println("[SERIAL] 1...");
    delay(1000);
    
    // Clear all preferences
    Preferences prefs;
    prefs.begin("config", false);
    prefs.clear();
    prefs.end();
    
    prefs.begin("wifi", false);
    prefs.clear();
    prefs.end();
    
    prefs.begin("webex", false);
    prefs.clear();
    prefs.end();
    
    Serial.println("[SERIAL] Settings cleared. Rebooting...");
    delay(500);
    
    ESP.restart();
}

/**
 * @brief Handle HELP command - show available commands
 */
static void handle_help_command() {
    Serial.println();
    Serial.println("=== SERIAL COMMANDS ===");
    Serial.println("  WIFI:<ssid>:<password> - Configure WiFi credentials");
    Serial.println("  SCAN                   - List available WiFi networks");
    Serial.println("  STATUS                 - Print device status");
    Serial.println("  FACTORY_RESET          - Clear all settings and reboot");
    Serial.println("  HELP                   - Show this help");
    Serial.println("=======================");
    Serial.println();
}
