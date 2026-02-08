/**
 * @file serial_commands.cpp
 * @brief Serial Command Handler Implementation
 *
 * Provides a comprehensive set of serial commands for device setup,
 * diagnostics, and remote support troubleshooting.
 */

#include "serial_commands.h"
#include "../app_state.h"
#include "../config/config_manager.h"
#include "../core/dependencies.h"
#include "../debug/log_system.h"
#include "../device/device_info.h"
#include "../display/matrix_display.h"
#include "../meraki/mqtt_client.h"
#include "../ota/ota_manager.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../sync/sync_manager.h"
#include <WiFi.h>

#ifdef ARDUINO_ARCH_ESP32
#include <esp_system.h>
#include <esp_chip_info.h>
#include <esp_flash.h>
#include <esp_heap_caps.h>
#include <esp_partition.h>
#include <esp_ota_ops.h>
#endif

// Firmware version from build
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

static const char* TAG = "SERIAL_CMD";

// Serial command state
static String serial_buffer = "";
static bool wifi_pending = false;
static String pending_ssid = "";
static String pending_password = "";
static String provision_token = "";  // RAM-only, non-persistent

// Forward declarations -- setup
static void handle_wifi_command(const String& command);
static void handle_scan_command();
static void handle_factory_reset_command();
static void handle_provision_token_command(const String& command);

// Forward declarations -- info & diagnostics
static void handle_status_command();
static void handle_info_command();
static void handle_heap_command();
static void handle_uptime_command();
static void handle_version_command();
static void handle_config_command();
static void handle_tasks_command();

// Forward declarations -- network & services
static void handle_network_command();
static void handle_supabase_command();
static void handle_realtime_command();
static void handle_mqtt_command();
static void handle_webex_command();
static void handle_sensor_command();

// Forward declarations -- actions
static void handle_reboot_command();
static void handle_ota_command(bool apply);
static void handle_sync_command();
static void handle_telemetry_command();
static void handle_log_command(bool enable);
static void handle_log_level_command(const String& level);
static void handle_ping_command();
static void handle_help_command();

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
                
                // Uppercase the command for case-insensitive matching
                // (preserve original for commands with payloads)
                String cmd_upper = serial_buffer;
                cmd_upper.toUpperCase();

                // Process command
                if (cmd_upper.startsWith("WIFI:")) {
                    handle_wifi_command(serial_buffer);  // preserve case for SSID/password
                } else if (cmd_upper.startsWith("PROVISION_TOKEN:")) {
                    handle_provision_token_command(serial_buffer);
                // --- Setup ---
                } else if (cmd_upper == "SCAN") {
                    handle_scan_command();
                } else if (cmd_upper == "FACTORY_RESET") {
                    handle_factory_reset_command();
                // --- Info & Diagnostics ---
                } else if (cmd_upper == "STATUS") {
                    handle_status_command();
                } else if (cmd_upper == "INFO") {
                    handle_info_command();
                } else if (cmd_upper == "HEAP") {
                    handle_heap_command();
                } else if (cmd_upper == "UPTIME") {
                    handle_uptime_command();
                } else if (cmd_upper == "VERSION") {
                    handle_version_command();
                } else if (cmd_upper == "CONFIG") {
                    handle_config_command();
                } else if (cmd_upper == "TASKS") {
                    handle_tasks_command();
                // --- Network & Services ---
                } else if (cmd_upper == "NETWORK") {
                    handle_network_command();
                } else if (cmd_upper == "SUPABASE") {
                    handle_supabase_command();
                } else if (cmd_upper == "REALTIME") {
                    handle_realtime_command();
                } else if (cmd_upper == "MQTT") {
                    handle_mqtt_command();
                } else if (cmd_upper == "WEBEX") {
                    handle_webex_command();
                } else if (cmd_upper == "SENSOR") {
                    handle_sensor_command();
                // --- Actions ---
                } else if (cmd_upper == "REBOOT") {
                    handle_reboot_command();
                } else if (cmd_upper == "OTA") {
                    handle_ota_command(false);
                } else if (cmd_upper == "OTA_UPDATE") {
                    handle_ota_command(true);
                } else if (cmd_upper == "SYNC") {
                    handle_sync_command();
                } else if (cmd_upper == "TELEMETRY") {
                    handle_telemetry_command();
                } else if (cmd_upper == "LOG_ON") {
                    handle_log_command(true);
                } else if (cmd_upper == "LOG_OFF") {
                    handle_log_command(false);
                } else if (cmd_upper == "LOG_NONE" || cmd_upper == "QUIET") {
                    handle_log_level_command("NONE");
                } else if (cmd_upper == "LOG_ERROR") {
                    handle_log_level_command("ERROR");
                } else if (cmd_upper == "LOG_WARN") {
                    handle_log_level_command("WARN");
                } else if (cmd_upper == "LOG_INFO") {
                    handle_log_level_command("INFO");
                } else if (cmd_upper == "LOG_DEBUG") {
                    handle_log_level_command("DEBUG");
                } else if (cmd_upper == "LOG_VERBOSE") {
                    handle_log_level_command("VERBOSE");
                } else if (cmd_upper == "PING") {
                    handle_ping_command();
                } else if (cmd_upper == "HELP") {
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
 * @brief Handle STATUS command -- connection summary (quick overview)
 */
static void handle_status_command() {
    auto& deps = getDependencies();
    Serial.println();
    Serial.println("============================");

    char buf[128];
    snprintf(buf, sizeof(buf), "Firmware: %s | Heap: %lu | Uptime: %lus",
             FIRMWARE_VERSION, (unsigned long)ESP.getFreeHeap(), millis() / 1000);
    Serial.println(buf);

    // WiFi
    if (WiFi.status() == WL_CONNECTED) {
        snprintf(buf, sizeof(buf), "WiFi: %s (%d dBm) | IP: %s",
                 WiFi.SSID().c_str(), WiFi.RSSI(), WiFi.localIP().toString().c_str());
        Serial.println(buf);
    } else {
        Serial.println("WiFi: Not connected");
    }

    // Services
    snprintf(buf, sizeof(buf), "Supabase: %s | App: %s | Webex Source: %s",
             deps.supabase.isAuthenticated() ? "Yes" : "No",
             deps.supabase.isAppConnected() ? "Yes" : "No",
             deps.app_state.webex_status_source.c_str());
    Serial.println(buf);

    snprintf(buf, sizeof(buf), "Realtime: %s | MQTT: %s | Webex: %s (%s)",
             deps.realtime.isConnected() ? "Yes" : "No",
             (deps.mqtt.isInitialized() && deps.mqtt.isConnected()) ? "Yes" : "No",
             deps.app_state.webex_status.c_str(),
             deps.app_state.webex_authenticated ? "auth" : "no-auth");
    Serial.println(buf);

#ifdef ARDUINO_ARCH_ESP32
    // Hardware
    snprintf(buf, sizeof(buf), "Hardware: %s (PSRAM%s) | Board: %s",
             CONFIG_IDF_TARGET,
             ESP.getPsramSize() > 0 ? "" : " N/A",
             ARDUINO_BOARD);
    Serial.println(buf);
#endif

    Serial.println("============================");
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

// =============================================================================
// INFO & DIAGNOSTICS
// =============================================================================

/**
 * @brief Handle INFO command -- chip, board, flash, PSRAM details
 */
static void handle_info_command() {
#ifdef ARDUINO_ARCH_ESP32
    esp_chip_info_t chip;
    esp_chip_info(&chip);

    uint32_t flash_size = 0;
    esp_flash_get_size(NULL, &flash_size);

    Serial.println();
    Serial.println("=== DEVICE INFO ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Chip: %s  rev %d  cores %d",
             CONFIG_IDF_TARGET, chip.revision, chip.cores);
    Serial.println(buf);

    snprintf(buf, sizeof(buf), "Flash: %lu KB  (mode %s)",
             (unsigned long)(flash_size / 1024),
             chip.features & CHIP_FEATURE_EMB_FLASH ? "embedded" : "external");
    Serial.println(buf);

    snprintf(buf, sizeof(buf), "PSRAM: %s  (%lu KB free)",
             chip.features & CHIP_FEATURE_EMB_PSRAM ? "Yes (embedded)" :
             (esp_spiram_get_size() > 0 ? "Yes (external)" : "No"),
             (unsigned long)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024));
    Serial.println(buf);

    snprintf(buf, sizeof(buf), "MAC: %s", WiFi.macAddress().c_str());
    Serial.println(buf);

    snprintf(buf, sizeof(buf), "SDK: %s", esp_get_idf_version());
    Serial.println(buf);

    snprintf(buf, sizeof(buf), "CPU Freq: %lu MHz", (unsigned long)getCpuFrequencyMhz());
    Serial.println(buf);

    Serial.println("===================");
    Serial.println();
#else
    Serial.println("INFO: Only available on ESP32 hardware");
#endif
}

/**
 * @brief Handle HEAP command -- memory diagnostics
 */
static void handle_heap_command() {
    Serial.println();
    Serial.println("=== HEAP STATUS ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Free Heap:       %lu bytes", (unsigned long)ESP.getFreeHeap());
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Min Free Heap:   %lu bytes (all-time low)", (unsigned long)ESP.getMinFreeHeap());
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Max Alloc:       %lu bytes (largest block)", (unsigned long)ESP.getMaxAllocHeap());
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Total Heap:      %lu bytes", (unsigned long)ESP.getHeapSize());
    Serial.println(buf);

    // PSRAM
    if (ESP.getPsramSize() > 0) {
        snprintf(buf, sizeof(buf), "PSRAM Total:     %lu bytes", (unsigned long)ESP.getPsramSize());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "PSRAM Free:      %lu bytes", (unsigned long)ESP.getFreePsram());
        Serial.println(buf);
    } else {
        Serial.println("PSRAM:           Not available");
    }

    // Internal vs 8-bit accessible
    snprintf(buf, sizeof(buf), "Internal Free:   %lu bytes",
             (unsigned long)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "8-bit Free:      %lu bytes",
             (unsigned long)heap_caps_get_free_size(MALLOC_CAP_8BIT));
    Serial.println(buf);

    Serial.println("===================");
    Serial.println();
}

/**
 * @brief Handle UPTIME command -- uptime, reset reason, boot count
 */
static void handle_uptime_command() {
    unsigned long ms = millis();
    unsigned long secs = ms / 1000;
    unsigned long mins = secs / 60;
    unsigned long hrs  = mins / 60;
    unsigned long days = hrs / 24;

    Serial.println();
    Serial.println("=== UPTIME ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Uptime: %lud %luh %lum %lus (%lu ms)",
             days, hrs % 24, mins % 60, secs % 60, ms);
    Serial.println(buf);

#ifdef ARDUINO_ARCH_ESP32
    // Reset reason
    esp_reset_reason_t reason = esp_reset_reason();
    const char* reason_str;
    switch (reason) {
        case ESP_RST_POWERON:  reason_str = "Power-on";     break;
        case ESP_RST_SW:       reason_str = "Software";     break;
        case ESP_RST_PANIC:    reason_str = "Panic/crash";  break;
        case ESP_RST_INT_WDT:  reason_str = "Int watchdog"; break;
        case ESP_RST_TASK_WDT: reason_str = "Task watchdog"; break;
        case ESP_RST_WDT:      reason_str = "Other watchdog"; break;
        case ESP_RST_DEEPSLEEP: reason_str = "Deep sleep";  break;
        case ESP_RST_BROWNOUT: reason_str = "Brownout";     break;
        case ESP_RST_SDIO:     reason_str = "SDIO";         break;
        default:               reason_str = "Unknown";      break;
    }
    snprintf(buf, sizeof(buf), "Reset Reason: %s (%d)", reason_str, (int)reason);
    Serial.println(buf);
#endif

    Serial.println("==============");
    Serial.println();
}

/**
 * @brief Handle VERSION command -- firmware version & OTA partition info
 */
static void handle_version_command() {
    Serial.println();
    Serial.println("=== VERSION ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Firmware: %s", FIRMWARE_VERSION);
    Serial.println(buf);

#ifdef ARDUINO_ARCH_ESP32
    snprintf(buf, sizeof(buf), "SDK: %s", esp_get_idf_version());
    Serial.println(buf);

    // Running partition
    const esp_partition_t* running = esp_ota_get_running_partition();
    if (running) {
        snprintf(buf, sizeof(buf), "Running Partition: %s (0x%lx, %lu KB)",
                 running->label, (unsigned long)running->address,
                 (unsigned long)(running->size / 1024));
        Serial.println(buf);
    }

    // Next OTA partition
    const esp_partition_t* next = esp_ota_get_next_update_partition(NULL);
    if (next) {
        snprintf(buf, sizeof(buf), "Next OTA Partition: %s (0x%lx, %lu KB)",
                 next->label, (unsigned long)next->address,
                 (unsigned long)(next->size / 1024));
        Serial.println(buf);
    }
#endif

    // OTA manager info
    auto& deps = getDependencies();
    if (deps.ota.isUpdateAvailable()) {
        snprintf(buf, sizeof(buf), "Update Available: %s", deps.ota.getLatestVersion().c_str());
        Serial.println(buf);
    }

    Serial.println("===============");
    Serial.println();
}

/**
 * @brief Handle CONFIG command -- dump current configuration as JSON
 */
static void handle_config_command() {
    Serial.println();
    Serial.println("=== CONFIGURATION ===");
    String json = DeviceInfo::buildConfigJson();
    Serial.println(json);
    Serial.println("=====================");
    Serial.println();
}

/**
 * @brief Handle TASKS command -- FreeRTOS task list
 */
static void handle_tasks_command() {
#ifdef ARDUINO_ARCH_ESP32
    Serial.println();
    Serial.println("=== FREERTOS TASKS ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Active tasks: %lu",
             (unsigned long)uxTaskGetNumberOfTasks());
    Serial.println(buf);

    // Current task info
    snprintf(buf, sizeof(buf), "Current task: %s  (stack HWM: %lu words)",
             pcTaskGetName(NULL),
             (unsigned long)uxTaskGetStackHighWaterMark(NULL));
    Serial.println(buf);

    // Try to get task list if vTaskList is available
    // Note: requires configUSE_TRACE_FACILITY and configUSE_STATS_FORMATTING_FUNCTIONS
    #if configUSE_TRACE_FACILITY == 1 && configUSE_STATS_FORMATTING_FUNCTIONS == 1
    Serial.println();
    Serial.println("Name               State  Prio  Stack(HWM)  Num");
    Serial.println("----               -----  ----  ----------  ---");
    // Allocate buffer for vTaskList output (~40 chars per task)
    size_t buf_size = uxTaskGetNumberOfTasks() * 48;
    char* task_buf = (char*)malloc(buf_size);
    if (task_buf) {
        vTaskList(task_buf);
        Serial.print(task_buf);
        free(task_buf);
    } else {
        Serial.println("(insufficient memory for task list)");
    }
    #else
    Serial.println("(detailed task list requires TRACE_FACILITY)");
    #endif

    Serial.println("======================");
    Serial.println();
#else
    Serial.println("TASKS: Only available on ESP32 hardware");
#endif
}

// =============================================================================
// NETWORK & SERVICES
// =============================================================================

/**
 * @brief Handle NETWORK command -- WiFi/IP/DNS details
 */
static void handle_network_command() {
    Serial.println();
    Serial.println("=== NETWORK ===");

    char buf[128];
    if (WiFi.status() == WL_CONNECTED) {
        snprintf(buf, sizeof(buf), "WiFi: Connected to '%s'", WiFi.SSID().c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "BSSID: %s  Channel: %d", WiFi.BSSIDstr().c_str(), WiFi.channel());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "RSSI: %d dBm", WiFi.RSSI());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "IP: %s", WiFi.localIP().toString().c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Subnet: %s", WiFi.subnetMask().toString().c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Gateway: %s", WiFi.gatewayIP().toString().c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "DNS 1: %s", WiFi.dnsIP(0).toString().c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "DNS 2: %s", WiFi.dnsIP(1).toString().c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "MAC: %s", WiFi.macAddress().c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Hostname: %s", WiFi.getHostname());
        Serial.println(buf);
    } else {
        Serial.println("WiFi: Not connected");
        snprintf(buf, sizeof(buf), "Status: %d", (int)WiFi.status());
        Serial.println(buf);
        if (WiFi.getMode() & WIFI_AP) {
            snprintf(buf, sizeof(buf), "AP Mode: Active  IP: %s", WiFi.softAPIP().toString().c_str());
            Serial.println(buf);
        }
    }

    Serial.println("===============");
    Serial.println();
}

/**
 * @brief Handle SUPABASE command -- auth & app connection status
 */
static void handle_supabase_command() {
    auto& deps = getDependencies();
    Serial.println();
    Serial.println("=== SUPABASE ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Authenticated: %s", deps.supabase.isAuthenticated() ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "App Connected: %s", deps.supabase.isAppConnected() ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Request In-Flight: %s", deps.supabase.isRequestInFlight() ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Pairing Code: %s", deps.supabase.getPairingCode().c_str());
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Remote Debug: %s", deps.supabase.isRemoteDebugEnabled() ? "ON" : "OFF");
    Serial.println(buf);

    String target_fw = deps.supabase.getTargetFirmwareVersion();
    if (target_fw.length() > 0) {
        snprintf(buf, sizeof(buf), "Target FW: %s", target_fw.c_str());
        Serial.println(buf);
    }

    // App state flags
    snprintf(buf, sizeof(buf), "Connected: %s  App: %s  Approval Pending: %s",
             deps.app_state.supabase_connected ? "Y" : "N",
             deps.app_state.supabase_app_connected ? "Y" : "N",
             deps.app_state.supabase_approval_pending ? "Y" : "N");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Disabled: %s  Blacklisted: %s  Deleted: %s",
             deps.app_state.supabase_disabled ? "Y" : "N",
             deps.app_state.supabase_blacklisted ? "Y" : "N",
             deps.app_state.supabase_deleted ? "Y" : "N");
    Serial.println(buf);

    if (deps.app_state.last_supabase_sync > 0) {
        unsigned long ago = (millis() - deps.app_state.last_supabase_sync) / 1000;
        snprintf(buf, sizeof(buf), "Last Sync: %lus ago", ago);
        Serial.println(buf);
    }

    Serial.println("================");
    Serial.println();
}

/**
 * @brief Handle REALTIME command -- WebSocket connection status
 */
static void handle_realtime_command() {
    auto& deps = getDependencies();
    Serial.println();
    Serial.println("=== REALTIME ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Socket Connected: %s", deps.realtime.isSocketConnected() ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Channel Subscribed: %s", deps.realtime.isConnected() ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Connecting: %s", deps.realtime.isConnecting() ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Ever Connected: %s", deps.realtime.hasEverConnected() ? "Yes" : "No");
    Serial.println(buf);

    if (deps.realtime.isConnecting()) {
        snprintf(buf, sizeof(buf), "Connecting For: %lu ms", (unsigned long)deps.realtime.connectingDurationMs());
        Serial.println(buf);
    }

    snprintf(buf, sizeof(buf), "Min Heap Required: %lu bytes", (unsigned long)deps.realtime.minHeapRequired());
    Serial.println(buf);

    // Realtime errors
    if (deps.app_state.realtime_error.length() > 0) {
        snprintf(buf, sizeof(buf), "Last Error: %s", deps.app_state.realtime_error.c_str());
        Serial.println(buf);
    }
    if (deps.app_state.realtime_defer_until > millis()) {
        unsigned long defer_secs = (deps.app_state.realtime_defer_until - millis()) / 1000;
        snprintf(buf, sizeof(buf), "Deferred For: %lus", defer_secs);
        Serial.println(buf);
    }

    Serial.println("================");
    Serial.println();
}

/**
 * @brief Handle MQTT command -- MQTT broker & sensor status
 */
static void handle_mqtt_command() {
    auto& deps = getDependencies();
    Serial.println();
    Serial.println("=== MQTT ===");

    char buf[128];
    if (!deps.mqtt.isInitialized()) {
        Serial.println("MQTT: Not initialized (no config)");
    } else {
        snprintf(buf, sizeof(buf), "Connected: %s", deps.mqtt.isConnected() ? "Yes" : "No");
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Broker: %s:%d",
                 deps.config.getMQTTBroker().c_str(),
                 deps.config.getMQTTPort());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Topic: %s", deps.config.getMQTTTopic().c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Has Update: %s", deps.mqtt.hasUpdate() ? "Yes" : "No");
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Latest Sensor: %s", deps.mqtt.getLatestSensorId().c_str());
        Serial.println(buf);
    }

    Serial.println("============");
    Serial.println();
}

/**
 * @brief Handle WEBEX command -- Webex auth & status
 */
static void handle_webex_command() {
    auto& deps = getDependencies();
    Serial.println();
    Serial.println("=== WEBEX ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Authenticated: %s", deps.app_state.webex_authenticated ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Status: %s", deps.app_state.webex_status.c_str());
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Source: %s", deps.app_state.webex_status_source.c_str());
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Status Received: %s", deps.app_state.webex_status_received ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Has Credentials: %s", deps.config.hasWebexCredentials() ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Has Tokens: %s", deps.config.hasWebexTokens() ? "Yes" : "No");
    Serial.println(buf);
    snprintf(buf, sizeof(buf), "Token Missing: %s", deps.supabase.isWebexTokenMissing() ? "Yes" : "No");
    Serial.println(buf);

    if (deps.app_state.embedded_app_display_name.length() > 0) {
        snprintf(buf, sizeof(buf), "Display Name: %s", deps.app_state.embedded_app_display_name.c_str());
        Serial.println(buf);
    }

    snprintf(buf, sizeof(buf), "In Call: %s  Camera: %s  Mic Muted: %s",
             deps.app_state.in_call ? "Yes" : "No",
             deps.app_state.camera_on ? "ON" : "OFF",
             deps.app_state.mic_muted ? "Yes" : "No");
    Serial.println(buf);

    Serial.println("=============");
    Serial.println();
}

/**
 * @brief Handle SENSOR command -- latest sensor readings
 */
static void handle_sensor_command() {
    auto& deps = getDependencies();
    Serial.println();
    Serial.println("=== SENSOR DATA ===");

    char buf[128];
    snprintf(buf, sizeof(buf), "Valid: %s", deps.app_state.sensor_data_valid ? "Yes" : "No");
    Serial.println(buf);

    if (deps.app_state.sensor_data_valid) {
        snprintf(buf, sizeof(buf), "Temperature: %.1f C", deps.app_state.temperature);
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Humidity: %.1f %%", deps.app_state.humidity);
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Door: %s", deps.app_state.door_status.c_str());
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Air Quality: %d  TVOC: %.1f ppb",
                 deps.app_state.air_quality_index, deps.app_state.tvoc);
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "CO2: %.0f ppm  PM2.5: %.1f",
                 deps.app_state.co2_ppm, deps.app_state.pm2_5);
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Ambient Noise: %.1f dB", deps.app_state.ambient_noise);
        Serial.println(buf);
        snprintf(buf, sizeof(buf), "Sensor MAC: %s", deps.app_state.sensor_mac.c_str());
        Serial.println(buf);

        if (deps.app_state.last_sensor_update > 0) {
            unsigned long ago = (millis() - deps.app_state.last_sensor_update) / 1000;
            snprintf(buf, sizeof(buf), "Last Update: %lus ago", ago);
            Serial.println(buf);
        }
    } else {
        Serial.println("No sensor data available");
    }

    Serial.println("===================");
    Serial.println();
}

// =============================================================================
// ACTIONS
// =============================================================================

/**
 * @brief Handle REBOOT command -- restart the device
 */
static void handle_reboot_command() {
    ESP_LOGW(TAG, "REBOOT requested via serial");
    Serial.println("Rebooting in 2 seconds...");
    Serial.flush();
    delay(2000);
    ESP.restart();
}

/**
 * @brief Handle OTA / OTA_UPDATE command -- check (and optionally apply) OTA update
 */
static void handle_ota_command(bool apply) {
    auto& deps = getDependencies();
    Serial.println();

    ESP_LOGI(TAG, "OTA %s requested via serial", apply ? "update" : "check");

    // Disconnect realtime to free heap for TLS
    bool realtime_was_active = deps.realtime.isConnected() || deps.realtime.isConnecting();
    if (realtime_was_active) {
        Serial.println("Pausing realtime for OTA...");
        deps.realtime.disconnect();
    }
    deps.app_state.realtime_defer_until = millis() + 30000UL;

    Serial.println("Checking for updates...");
    if (!deps.ota.checkForUpdate()) {
        Serial.println("ERROR: Failed to check for updates");
        if (realtime_was_active) {
            deps.app_state.supabase_realtime_resubscribe = true;
        }
        return;
    }

    char buf[128];
    snprintf(buf, sizeof(buf), "Current: %s  Latest: %s",
             deps.ota.getCurrentVersion().c_str(),
             deps.ota.getLatestVersion().c_str());
    Serial.println(buf);

    if (!deps.ota.isUpdateAvailable()) {
        Serial.println("Already on latest version.");
        if (realtime_was_active) {
            deps.app_state.supabase_realtime_resubscribe = true;
        }
        return;
    }

    Serial.println("Update available!");

    if (!apply) {
        Serial.println("Run OTA_UPDATE to download and install.");
        if (realtime_was_active) {
            deps.app_state.supabase_realtime_resubscribe = true;
        }
        return;
    }

    // Apply the update
    Serial.println("Downloading and installing firmware...");
    deps.display.showUpdating(deps.ota.getLatestVersion());
    deps.config.clearFailedOTAVersion();

    // Extend realtime defer for download duration
    deps.app_state.realtime_defer_until = millis() + 600000UL;  // 10 minutes

    if (deps.ota.performUpdate()) {
        Serial.println("Update successful! Rebooting...");
        // ESP.restart() called inside performUpdate on success
    } else {
        Serial.println("ERROR: Update failed!");
        deps.display.unlockFromOTA();
        deps.config.setFailedOTAVersion(deps.ota.getLatestVersion());
        if (realtime_was_active) {
            deps.app_state.supabase_realtime_resubscribe = true;
        }
    }
}

/**
 * @brief Handle SYNC command -- force Supabase state sync
 */
static void handle_sync_command() {
    auto& deps = getDependencies();
    ESP_LOGI(TAG, "Forcing sync via serial");
    Serial.println("Forcing Supabase sync...");
    deps.sync.forceSyncNow();
    Serial.println("Sync triggered. Check STATUS for results.");
}

/**
 * @brief Handle TELEMETRY command -- force send telemetry
 */
static void handle_telemetry_command() {
    auto& deps = getDependencies();
    ESP_LOGI(TAG, "Forcing telemetry via serial");

    if (!deps.supabase.isAuthenticated()) {
        Serial.println("ERROR: Not authenticated with Supabase");
        return;
    }

    Serial.println("Sending telemetry...");
    int rssi = WiFi.RSSI();
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t uptime = millis() / 1000;
    float temp = deps.app_state.temperature;

    SupabaseAppState appState = deps.supabase.postDeviceState(
        rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);

    if (appState.valid) {
        DeviceInfo::applyAppState(appState);
        Serial.println("Telemetry sent successfully.");
        String json = DeviceInfo::buildTelemetryJson();
        Serial.println(json);
    } else {
        Serial.println("ERROR: Telemetry send failed");
    }
}

/**
 * @brief Handle LOG_ON / LOG_OFF command -- enable/disable remote logging
 */
static void handle_log_command(bool enable) {
    auto& deps = getDependencies();
    deps.supabase.setRemoteDebugEnabled(enable);
    log_system_set_remote_enabled(enable);

    char buf[64];
    snprintf(buf, sizeof(buf), "Remote debug logging: %s", enable ? "ENABLED" : "DISABLED");
    Serial.println(buf);
    ESP_LOGI(TAG, "Remote debug %s via serial", enable ? "ENABLED" : "DISABLED");
}

/**
 * @brief Handle LOG_NONE / LOG_ERROR / LOG_WARN / LOG_INFO / LOG_DEBUG / LOG_VERBOSE
 *
 * Sets the global serial log verbosity level using esp_log_level_set("*", ...).
 * This controls what appears on the serial terminal in real time.
 * Use LOG_NONE (or QUIET) to silence all output while running commands,
 * then LOG_INFO to restore normal output.
 */
static void handle_log_level_command(const String& level) {
    esp_log_level_t esp_level;
    const char* label;

    if (level == "NONE") {
        esp_level = ESP_LOG_NONE;
        label = "NONE (silent)";
    } else if (level == "ERROR") {
        esp_level = ESP_LOG_ERROR;
        label = "ERROR";
    } else if (level == "WARN") {
        esp_level = ESP_LOG_WARN;
        label = "WARN";
    } else if (level == "INFO") {
        esp_level = ESP_LOG_INFO;
        label = "INFO (default)";
    } else if (level == "DEBUG") {
        esp_level = ESP_LOG_DEBUG;
        label = "DEBUG";
    } else if (level == "VERBOSE") {
        esp_level = ESP_LOG_VERBOSE;
        label = "VERBOSE";
    } else {
        Serial.println("Unknown log level. Use: NONE, ERROR, WARN, INFO, DEBUG, VERBOSE");
        return;
    }

    esp_log_level_set("*", esp_level);

    // Always print this confirmation (bypasses log level since it's Serial.println)
    char buf[64];
    snprintf(buf, sizeof(buf), "Log level set to: %s", label);
    Serial.println(buf);
}

/**
 * @brief Handle PING command -- echo back (connection test)
 */
static void handle_ping_command() {
    Serial.println("PONG");
}

/**
 * @brief Handle HELP command -- show all available commands
 */
static void handle_help_command() {
    Serial.println();
    Serial.println("=== SERIAL COMMANDS ===");
    Serial.println();
    Serial.println("-- Setup --");
    Serial.println("  WIFI:<ssid>:<password>  Configure WiFi credentials");
    Serial.println("  PROVISION_TOKEN:<tok>   Set provision token (32 chars)");
    Serial.println("  SCAN                    List available WiFi networks");
    Serial.println("  FACTORY_RESET           Erase all settings and reboot");
    Serial.println();
    Serial.println("-- Info & Diagnostics --");
    Serial.println("  STATUS                  Connection summary");
    Serial.println("  INFO                    Chip/board/flash/PSRAM details");
    Serial.println("  HEAP                    Memory diagnostics");
    Serial.println("  UPTIME                  Uptime & reset reason");
    Serial.println("  VERSION                 Firmware version & partitions");
    Serial.println("  CONFIG                  Dump current config (JSON)");
    Serial.println("  TASKS                   FreeRTOS task list");
    Serial.println();
    Serial.println("-- Network & Services --");
    Serial.println("  NETWORK                 WiFi/IP/DNS/gateway details");
    Serial.println("  SUPABASE                Supabase auth & app status");
    Serial.println("  REALTIME                Realtime WebSocket status");
    Serial.println("  MQTT                    MQTT broker & sensor status");
    Serial.println("  WEBEX                   Webex auth & status");
    Serial.println("  SENSOR                  Latest sensor readings");
    Serial.println();
    Serial.println("-- Actions --");
    Serial.println("  REBOOT                  Restart the device");
    Serial.println("  OTA                     Check for firmware update");
    Serial.println("  OTA_UPDATE              Check + apply firmware update");
    Serial.println("  SYNC                    Force Supabase state sync");
    Serial.println("  TELEMETRY               Force send telemetry");
    Serial.println("  LOG_ON / LOG_OFF        Enable/disable remote logging");
    Serial.println("  PING                    Echo PONG (connection test)");
    Serial.println();
    Serial.println("-- Log Verbosity --");
    Serial.println("  QUIET (or LOG_NONE)     Silence all log output");
    Serial.println("  LOG_ERROR               Errors only");
    Serial.println("  LOG_WARN                Errors + warnings");
    Serial.println("  LOG_INFO                Normal output (default)");
    Serial.println("  LOG_DEBUG               Include debug messages");
    Serial.println("  LOG_VERBOSE             Everything");
    Serial.println();
    Serial.println("  HELP                    Show this help");
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
