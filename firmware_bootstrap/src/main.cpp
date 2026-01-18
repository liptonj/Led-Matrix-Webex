/**
 * @file main.cpp
 * @brief ESP32-S3 Webex Status Display - Bootstrap Firmware
 *
 * Minimal bootstrap firmware that handles:
 * - WiFi provisioning (AP mode + SmartConfig)
 * - OTA download of the full firmware from GitHub Releases
 *
 * This firmware is designed to be small and stable. Once WiFi is configured
 * and the full firmware is downloaded, the device reboots into the main
 * application.
 */

#include <Arduino.h>
#include <WiFi.h>

#include "config_store.h"
#include "wifi_provisioner.h"
#include "ota_downloader.h"
#include "web_setup.h"

// Bootstrap version
#ifndef BOOTSTRAP_VERSION
#define BOOTSTRAP_VERSION "1.0.2"
#endif

// Global instances
ConfigStore config_store;
WiFiProvisioner wifi_provisioner;
OTADownloader ota_downloader;
WebSetup web_setup;

// State
bool initial_connection_attempted = false;
bool ota_in_progress = false;
unsigned long last_status_print = 0;

// Forward declarations
void print_startup_banner();
void attempt_stored_wifi_connection();
void start_provisioning_mode();
void handle_pending_actions();
void print_status();

/**
 * @brief Arduino setup function
 */
void setup() {
    // Initialize serial
    Serial.begin(115200);
    delay(1000);  // Wait for serial to stabilize

    print_startup_banner();

    // Initialize configuration store
    Serial.println("[BOOT] Initializing configuration...");
    if (!config_store.begin()) {
        Serial.println("[BOOT] WARNING: Failed to initialize config store");
    }

    // Initialize components
    wifi_provisioner.begin(&config_store);
    ota_downloader.begin(&config_store);

    // Set up connection callback
    wifi_provisioner.setConnectionCallback([](bool connected) {
        if (connected) {
            Serial.println("[BOOT] WiFi connected via callback");
        }
    });

    // Check if we have stored WiFi credentials
    if (config_store.hasWiFi()) {
        Serial.println("[BOOT] Found stored WiFi credentials");
        attempt_stored_wifi_connection();
    } else {
        Serial.println("[BOOT] No WiFi credentials stored");
        start_provisioning_mode();
    }
}

/**
 * @brief Arduino main loop
 */
void loop() {
    // Process WiFi provisioner (SmartConfig events)
    wifi_provisioner.loop();

    // Process web server
    web_setup.loop();

    // Handle pending actions from web interface
    handle_pending_actions();

    // Periodic status print
    if (millis() - last_status_print >= 30000) {
        print_status();
        last_status_print = millis();
    }

    // Small delay to prevent watchdog issues
    delay(10);
}

/**
 * @brief Print startup banner
 */
void print_startup_banner() {
    Serial.println();
    Serial.println("=============================================");
    Serial.println("  Webex Display - Bootstrap Firmware");
    Serial.printf("  Version: %s\n", BOOTSTRAP_VERSION);
    Serial.println("=============================================");
    Serial.println();
    Serial.println("This bootstrap firmware will:");
    Serial.println("  1. Connect to WiFi (or start AP for config)");
    Serial.println("  2. Download the full firmware via OTA");
    Serial.println("  3. Reboot into the main application");
    Serial.println();
}

/**
 * @brief Attempt connection with stored WiFi credentials
 */
void attempt_stored_wifi_connection() {
    initial_connection_attempted = true;

    String ssid = config_store.getWiFiSSID();
    Serial.printf("[BOOT] Attempting to connect to '%s'...\n", ssid.c_str());

    if (wifi_provisioner.connectWithStoredCredentials()) {
        Serial.println("[BOOT] WiFi connected successfully!");
        Serial.printf("[BOOT] IP Address: %s\n", WiFi.localIP().toString().c_str());

        // Check if we should auto-install firmware
        String ota_url = config_store.getOTAUrl();
        if (!ota_url.isEmpty()) {
            Serial.println("[BOOT] OTA URL configured, checking for firmware...");

            // Start web server for status monitoring (STA mode, no captive portal)
            web_setup.begin(&config_store, &wifi_provisioner, &ota_downloader);

            // Short delay to allow web server to start
            delay(2000);

            // Attempt OTA install
            ota_in_progress = true;
            if (ota_downloader.checkAndInstall()) {
                // This won't return if successful (device reboots)
                Serial.println("[BOOT] OTA started...");
            } else {
                Serial.println("[BOOT] OTA check failed, will use web interface");
                ota_in_progress = false;
                // Don't restart provisioning - just stay in STA mode with web UI
                Serial.printf("[BOOT] Web UI: http://%s\n", WiFi.localIP().toString().c_str());
                Serial.println("[BOOT] Use web interface to retry OTA or reconfigure");
            }
        } else {
            // Start web server for configuration
            web_setup.begin(&config_store, &wifi_provisioner, &ota_downloader);
            Serial.println("[BOOT] No OTA URL configured");
            Serial.println("[BOOT] Use web interface to configure and install firmware");
            Serial.printf("[BOOT] Web UI: http://%s\n", WiFi.localIP().toString().c_str());
        }
    } else {
        Serial.println("[BOOT] WiFi connection failed");
        start_provisioning_mode();
    }
}

/**
 * @brief Start WiFi provisioning mode (AP + SmartConfig)
 */
void start_provisioning_mode() {
    Serial.println("[BOOT] Starting provisioning mode...");

    // Start AP with SmartConfig listener
    wifi_provisioner.startAPWithSmartConfig();

    // Start web server
    web_setup.begin(&config_store, &wifi_provisioner, &ota_downloader);

    Serial.println();
    Serial.println("=============================================");
    Serial.println("  SETUP MODE ACTIVE");
    Serial.println("=============================================");
    Serial.printf("  WiFi AP: %s (open network)\n", AP_SSID);
    Serial.printf("  Web UI: http://%s\n", WiFi.softAPIP().toString().c_str());
    Serial.println();
    Serial.println("  Connect to WiFi - captive portal will open");
    Serial.println("  Or use ESP Touch app for SmartConfig");
    Serial.println("=============================================");
    Serial.println();
}

/**
 * @brief Handle pending actions from web interface
 */
void handle_pending_actions() {
    // Skip if OTA already in progress
    if (ota_in_progress) {
        return;
    }

    // Check for pending WiFi connection
    if (web_setup.isWiFiPending()) {
        web_setup.clearWiFiPending();

        Serial.println("[BOOT] WiFi credentials updated, connecting...");

        // Stop current provisioning
        wifi_provisioner.stopProvisioning();

        // Try to connect with new credentials
        if (wifi_provisioner.connectWithStoredCredentials()) {
            Serial.println("[BOOT] Connected with new credentials!");
            Serial.printf("[BOOT] IP: %s\n", WiFi.localIP().toString().c_str());

            // Stay in station mode but keep web server running
            // User can trigger OTA via web interface
        } else {
            Serial.println("[BOOT] Connection failed, restarting provisioning...");
            start_provisioning_mode();
        }
    }

    // Check for pending OTA request
    if (web_setup.isOTAPending()) {
        web_setup.clearOTAPending();

        if (!wifi_provisioner.isConnected()) {
            Serial.println("[BOOT] Cannot start OTA - WiFi not connected");
            return;
        }

        Serial.println("[BOOT] OTA requested via web interface");
        ota_in_progress = true;

        if (ota_downloader.checkAndInstall()) {
            // This won't return if successful
            Serial.println("[BOOT] OTA in progress...");
        } else {
            Serial.println("[BOOT] OTA failed");
            ota_in_progress = false;
        }
    }
}

/**
 * @brief Print current status
 */
void print_status() {
    Serial.println();
    Serial.println("--- Status ---");
    Serial.printf("  WiFi Connected: %s\n", wifi_provisioner.isConnected() ? "Yes" : "No");

    if (wifi_provisioner.isConnected()) {
        Serial.printf("  IP Address: %s\n", WiFi.localIP().toString().c_str());
    }

    if (wifi_provisioner.isAPActive()) {
        Serial.printf("  AP Active: Yes (IP: %s)\n", WiFi.softAPIP().toString().c_str());
    }

    if (wifi_provisioner.isSmartConfigActive()) {
        Serial.println("  SmartConfig: Listening");
    }

    Serial.printf("  Free Heap: %d bytes\n", ESP.getFreeHeap());
    Serial.printf("  Uptime: %lu seconds\n", millis() / 1000);
    Serial.println("--------------");
    Serial.println();
}
