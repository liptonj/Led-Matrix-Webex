/**
 * @file improv_provisioner.h
 * @brief Improv WiFi provisioning initialization
 *
 * Handles Improv WiFi provisioning with detection windows and recovery mode support.
 */

#ifndef IMPROV_PROVISIONER_H
#define IMPROV_PROVISIONER_H

#include <Arduino.h>
#include "config/config_manager.h"
#include "app_state.h"
#include "display/matrix_display.h"
#include "discovery/mdns_manager.h"
#include "wifi/wifi_manager.h"
#include "boot_validator.h"
#include "improv/improv_handler.h"
#include "time/time_manager.h"

/**
 * @brief Initialize WiFi and handle Improv provisioning
 *
 * This function handles:
 * - WiFi initialization in STA mode
 * - Improv handler setup
 * - Detection windows (normal vs recovery mode)
 * - WiFi provisioning via Improv protocol
 * - Post-provisioning WiFi setup
 * - mDNS initialization
 * - NTP time sync
 *
 * @param config_manager Config manager instance
 * @param app_state Application state
 * @param matrix_display Display instance (may be nullptr)
 * @param mdns_manager mDNS manager instance
 * @param wifi_manager WiFi manager instance
 * @param display_ok Whether display initialization succeeded
 */
void initWiFiAndImprov(
    ConfigManager& config_manager,
    AppState& app_state,
    MatrixDisplay* matrix_display,
    MDNSManager& mdns_manager,
    WiFiManager& wifi_manager,
    bool display_ok
);

#endif // IMPROV_PROVISIONER_H
