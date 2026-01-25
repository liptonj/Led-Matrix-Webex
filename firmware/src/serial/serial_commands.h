/**
 * @file serial_commands.h
 * @brief Serial Command Handler for Web Installer WiFi Configuration
 * 
 * Provides serial commands for the website's Web Serial interface:
 * - WIFI:<ssid>:<password> - Configure WiFi credentials
 * - SCAN - Scan and list available WiFi networks
 * - STATUS - Print current device status
 * - FACTORY_RESET - Clear all settings and reboot
 * - HELP - Show available commands
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

#endif // SERIAL_COMMANDS_H
