/**
 * @file serial_commands.cpp
 * @brief Serial Command Handler Implementation
 */

#include "serial_commands.h"
#include "../config/config_manager.h"
#include "../core/dependencies.h"
#include "../debug/log_system.h"
#include <WiFi.h>

static const char* TAG = "SERIAL_CMD";

// Serial command state
static String serial_buffer = "";
static bool wifi_pending = false;
static String pending_ssid = "";
static String pending_password = "";
static String provision_token = "";  // RAM-only, non-persistent

// Forward declarations
static void handle_wifi_command(const String& command);
static void handle_scan_command();
static void handle_status_command();
static void handle_factory_reset_command();
static void handle_help_command();
static void handle_provision_token_command(const String& command);

void serial_commands_begin() {
    serial_buffer = "";
    wifi_pending = false;
    pending_ssid = "";
    pending_password = "";
    ESP_LOGI(TAG, "Command handler initialized");
}

void serial_commands_loop() {
    while (Serial.available()) {
        char c = Serial.read();
        
        if (c == '\n' || c == '\r') {
            if (serial_buffer.length() > 0) {
                serial_buffer.trim();
                
                // Log received command (mask password)
                if (serial_buffer.startsWith("WIFI:")) {
                    ESP_LOGI(TAG, "Received WiFi configuration command");
                } else {
                    ESP_LOGI(TAG, "Received: %s", serial_buffer.c_str());
                }
                
                // Process command
                if (serial_buffer.startsWith("WIFI:")) {
                    handle_wifi_command(serial_buffer);
                } else if (serial_buffer.startsWith("PROVISION_TOKEN:")) {
                    handle_provision_token_command(serial_buffer);
                } else if (serial_buffer == "STATUS") {
                    handle_status_command();
                } else if (serial_buffer == "SCAN") {
                    handle_scan_command();
                } else if (serial_buffer == "FACTORY_RESET") {
                    handle_factory_reset_command();
                } else if (serial_buffer == "HELP") {
                    handle_help_command();
                } else {
                    ESP_LOGW(TAG, "Unknown command: %s", serial_buffer.c_str());
                    ESP_LOGI(TAG, "Type HELP for available commands");
                }
                
                serial_buffer = "";
            }
        } else {
            serial_buffer += c;
            
            // Prevent buffer overflow
            if (serial_buffer.length() > 256) {
                ESP_LOGW(TAG, "Buffer overflow, clearing");
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
        ESP_LOGE(TAG, "Invalid WIFI command format");
        ESP_LOGI(TAG, "Usage: WIFI:<ssid>:<password>");
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
    
    // Security: Validate SSID length (WiFi standard: max 32 bytes)
    if (ssid.isEmpty()) {
        ESP_LOGE(TAG, "Error: SSID cannot be empty");
        return;
    }
    if (ssid.length() > 32) {
        ESP_LOGE(TAG, "Error: SSID too long (%d bytes, max 32)", ssid.length());
        return;
    }
    
    // Security: Validate password length (WiFi WPA2: 8-63 characters, WEP/Open: 0-63)
    // Allow empty password for open networks
    if (password.length() > 63) {
        ESP_LOGE(TAG, "Error: Password too long (%d chars, max 63)", password.length());
        return;
    }
    
    // Security: Check for null bytes in SSID/password (command injection)
    for (size_t i = 0; i < ssid.length(); i++) {
        if (ssid.charAt(i) == '\0') {
            ESP_LOGE(TAG, "Error: SSID contains null byte");
            return;
        }
    }
    for (size_t i = 0; i < password.length(); i++) {
        if (password.charAt(i) == '\0') {
            ESP_LOGE(TAG, "Error: Password contains null byte");
            return;
        }
    }
    
    ESP_LOGI(TAG, "Configuring WiFi: SSID='%s' (len=%d)", ssid.c_str(), ssid.length());
    
    // Save credentials using config manager
    auto& deps = getDependencies();
    deps.config.setWiFiCredentials(ssid, password);
    
    // Set pending flag for main loop to handle connection
    wifi_pending = true;
    pending_ssid = ssid;
    pending_password = password;
    
    ESP_LOGI(TAG, "WiFi credentials saved, connecting...");
}

/**
 * @brief Handle SCAN command - list available WiFi networks
 */
static void handle_scan_command() {
    ESP_LOGI(TAG, "Scanning WiFi networks...");
    
    // Perform a fresh scan
    int n = WiFi.scanNetworks(false, false);  // Sync scan, no hidden networks
    
    ESP_LOGI(TAG, "Available networks:");
    if (n == 0) {
        ESP_LOGI(TAG, "No networks found");
    } else {
        for (int i = 0; i < n; i++) {
            ESP_LOGI(TAG, "  %d. %s (%d dBm)%s",
                          i + 1,
                          WiFi.SSID(i).c_str(),
                          WiFi.RSSI(i),
                          WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "" : " [secured]");
        }
    }
    ESP_LOGI(TAG, "Scan complete");
    
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
    ESP_LOGW(TAG, "FACTORY RESET requested!");
    ESP_LOGW(TAG, "This will erase all settings and partitions.");
    ESP_LOGW(TAG, "Device will reboot in 3 seconds...");
    
    delay(1000);
    ESP_LOGI(TAG, "2...");
    delay(1000);
    ESP_LOGI(TAG, "1...");
    delay(1000);
    
    // Use ConfigManager's factory reset (clears correct namespace + partitions)
    auto& deps = getDependencies();
    deps.config.factoryReset();
    
    ESP_LOGI(TAG, "Rebooting...");
    delay(500);
    
    ESP.restart();
}

/**
 * @brief Handle PROVISION_TOKEN command
 * Format: PROVISION_TOKEN:<token>
 * Validates token is exactly 32 alphanumeric characters
 */
static void handle_provision_token_command(const String& command) {
    // Extract token after "PROVISION_TOKEN:" prefix (16 characters)
    const int prefix_len = 16;  // "PROVISION_TOKEN:"
    if (command.length() <= prefix_len) {
        ESP_LOGE(TAG, "Error: Invalid provision token length");
        Serial.println("ACK:PROVISION_TOKEN:error:invalid_length");
        return;
    }
    
    String token = command.substring(prefix_len);
    token.trim();  // Remove any whitespace
    
    // Validate token length (exactly 32 characters)
    if (token.length() != 32) {
        ESP_LOGE(TAG, "Error: Invalid provision token length (%d, expected 32)", token.length());
        Serial.println("ACK:PROVISION_TOKEN:error:invalid_length");
        return;
    }
    
    // Validate token is alphanumeric only (for security)
    bool is_valid = true;
    for (size_t i = 0; i < token.length(); i++) {
        char c = token.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
            is_valid = false;
            break;
        }
    }
    
    if (!is_valid) {
        ESP_LOGE(TAG, "Error: Provision token must be alphanumeric only");
        Serial.println("ACK:PROVISION_TOKEN:error:invalid_format");
        return;
    }
    
    // Store token in RAM-only variable (non-persistent)
    provision_token = token;
    
    ESP_LOGI(TAG, "Provision token received (32 chars)");
    Serial.println("ACK:PROVISION_TOKEN:success");
}

/**
 * @brief Handle HELP command - show available commands
 */
static void handle_help_command() {
    Serial.println();
    Serial.println("=== SERIAL COMMANDS ===");
    Serial.println("  WIFI:<ssid>:<password> - Configure WiFi credentials");
    Serial.println("  PROVISION_TOKEN:<token> - Set provision token (32 alphanumeric chars)");
    Serial.println("  SCAN                   - List available WiFi networks");
    Serial.println("  STATUS                 - Print device status");
    Serial.println("  FACTORY_RESET          - Clear all settings and reboot");
    Serial.println("  HELP                   - Show this help");
    Serial.println("=======================");
    Serial.println();
}

// Public API functions for provision token

void set_provision_token(const String& token) {
    provision_token = token;
}

String get_provision_token() {
    return provision_token;
}

void clear_provision_token() {
    provision_token = "";
}
