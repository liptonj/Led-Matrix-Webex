/**
 * @file serial_commands.h
 * @brief Serial Command Handler for Web Installer and Remote Support Console
 * 
 * Provides serial commands for the website's Web Serial interface and
 * remote support console. Commands are grouped by function:
 * 
 * Setup:
 *   WIFI:<ssid>:<password>       - Configure WiFi credentials
 *   PROVISION_TOKEN:<token>      - Set provision token (32 alphanumeric chars)
 *   SCAN                         - Scan available WiFi networks
 *   FACTORY_RESET                - Erase all settings and reboot
 * 
 * Info & Diagnostics:
 *   STATUS                       - Connection summary
 *   INFO                         - Chip/board/flash/PSRAM details
 *   HEAP                         - Memory diagnostics
 *   UPTIME                       - Uptime, reset reason, boot count
 *   VERSION                      - Firmware version & partition info
 *   CONFIG                       - Dump current configuration (JSON)
 *   TASKS                        - FreeRTOS task list
 * 
 * Network & Services:
 *   NETWORK                      - WiFi/IP/DNS/gateway details
 *   SUPABASE                     - Supabase auth & app status
 *   REALTIME                     - Realtime WebSocket status
 *   MQTT                         - MQTT broker & sensor status
 *   WEBEX                        - Webex auth & status details
 *   SENSOR                       - Latest sensor readings
 * 
 * Actions:
 *   REBOOT                       - Restart the device
 *   OTA                          - Check for OTA update
 *   OTA_UPDATE                   - Check + apply OTA update
 *   SYNC                         - Force Supabase state sync
 *   TELEMETRY                    - Force send telemetry
 *   LOG_ON                       - Enable remote debug logging
 *   LOG_OFF                      - Disable remote debug logging
 *   PING                         - Echo "PONG" (connection test)
 * 
 * Log Verbosity (controls serial output level):
 *   QUIET / LOG_NONE             - Silence all log output
 *   LOG_ERROR                    - Errors only
 *   LOG_WARN                     - Errors + warnings
 *   LOG_INFO                     - Normal output (default)
 *   LOG_DEBUG                    - Include debug messages
 *   LOG_VERBOSE                  - Everything
 * 
 *   HELP                         - Show all commands
 */

#ifndef SERIAL_COMMANDS_H
#define SERIAL_COMMANDS_H

#include <Arduino.h>

/**
 * @brief Initialize serial command handler
 */
void serial_commands_begin();

/**
 * @brief Process incoming serial commands
 * Call this in the main loop
 */
void serial_commands_loop();

/**
 * @brief Check if WiFi configuration is pending from serial command
 * @return true if WIFI command was received and needs processing
 */
bool serial_wifi_pending();

/**
 * @brief Clear the pending WiFi flag after processing
 */
void serial_wifi_clear_pending();

/**
 * @brief Get the SSID from pending WiFi command
 * @return SSID string
 */
String serial_wifi_get_ssid();

/**
 * @brief Get the password from pending WiFi command
 * @return Password string
 */
String serial_wifi_get_password();

/**
 * @brief Set the provision token (RAM-only, non-persistent)
 * @param token Provision token string (should be 32 alphanumeric characters)
 */
void set_provision_token(const String& token);

/**
 * @brief Get the current provision token
 * @return Provision token string (empty if not set)
 */
String get_provision_token();

/**
 * @brief Clear the provision token
 */
void clear_provision_token();

#endif // SERIAL_COMMANDS_H
