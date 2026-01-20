/**
 * @file main.cpp
 * @brief ESP32-S3 Webex Status Display - Bootstrap Firmware
 *
 * Minimal bootstrap firmware that handles:
 * - WiFi provisioning (AP mode)
 * - OTA download of the full firmware from GitHub Releases
 * - Display IP address and mDNS hostname on LED matrix
 *
 * This firmware is designed to be small and stable. Once WiFi is configured
 * and the full firmware is downloaded, the device reboots into the main
 * application.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <esp_system.h>

#include "debug.h"
#include "config_store.h"
#include "wifi_provisioner.h"
#include "ota_downloader.h"
#include "web_setup.h"
#include "bootstrap_display.h"

// Bootstrap version - defined in platformio.ini [version] section
#ifndef BOOTSTRAP_VERSION
#define BOOTSTRAP_VERSION "0.0.0-dev"
#endif

// mDNS hostname (without .local)
#ifndef MDNS_HOSTNAME
#define MDNS_HOSTNAME "webex-display"
#endif

// Global instances
ConfigStore config_store;
WiFiProvisioner wifi_provisioner;
OTADownloader ota_downloader;
WebSetup web_setup;
BootstrapDisplay display;

// State
bool ota_in_progress = false;
unsigned long last_status_print = 0;
unsigned long last_ip_print = 0;
String mdns_hostname = MDNS_HOSTNAME;
bool releases_fetch_in_progress = false;
bool mdns_started = false;
bool wifi_connected_handled = false;
unsigned long last_releases_fetch_attempt = 0;
int releases_fetch_retry_count = 0;
const int MAX_FETCH_RETRIES = 3;
unsigned long wifi_connected_time = 0;
bool releases_cached_message_shown = false;  // Only show message once

// Forward declarations
void print_startup_banner();
void attempt_stored_wifi_connection();
void start_provisioning_mode();
void handle_pending_actions();
void print_status();
void print_connection_info();
void start_mdns();
void ota_progress_callback(int progress, const char* message);
void fetch_releases_task(void* param);
void ensure_releases_fetch_started();
void handle_connected_state();

/**
 * @brief Background task to fetch releases from GitHub
 */
void fetch_releases_task(void* param) {
    releases_fetch_in_progress = true;
    unsigned long start_time = millis();
    
    Serial.println("[TASK] ========================================");
    Serial.println("[TASK] Background fetch of releases starting...");
    Serial.printf("[TASK] Free heap before: %d bytes\n", ESP.getFreeHeap());
    Serial.printf("[TASK] Stack high water mark: %d bytes\n", uxTaskGetStackHighWaterMark(NULL));
    
    // Wait for network/DNS to fully stabilize - increased from 1s to 3s
    // This helps with inconsistent DNS resolution on some routers
    Serial.println("[TASK] Waiting for network/DNS stabilization (3s)...");
    delay(3000);
    
    // Verify internet connectivity before attempting fetch
    Serial.println("[TASK] Verifying internet connectivity...");
    IPAddress github_ip;
    if (!WiFi.hostByName("api.github.com", github_ip)) {
        Serial.println("[TASK] ✗ DNS resolution failed for api.github.com");
        Serial.println("[TASK] Network may not have internet access or DNS is not working");
        releases_fetch_retry_count++;
        releases_fetch_in_progress = false;
        vTaskDelete(NULL);
        return;
    }
    Serial.printf("[TASK] ✓ DNS resolved api.github.com to %s\n", github_ip.toString().c_str());
    
    int count = ota_downloader.fetchAvailableReleases(true);
    
    unsigned long elapsed = millis() - start_time;
    
    if (count > 0) {
        Serial.printf("[TASK] ✓ Successfully fetched %d releases in %lu ms\n", count, elapsed);
        Serial.printf("[TASK] Releases are now cached and available\n");
        releases_fetch_retry_count = 0;  // Reset retry counter on success
    } else {
        String error = ota_downloader.getReleaseFetchError();
        Serial.printf("[TASK] ✗ Failed to fetch releases (took %lu ms)\n", elapsed);
        if (!error.isEmpty()) {
            Serial.printf("[TASK] Error: %s\n", error.c_str());
        }
        releases_fetch_retry_count++;
        Serial.printf("[TASK] Retry attempt %d/%d\n", releases_fetch_retry_count, MAX_FETCH_RETRIES);
    }
    
    Serial.printf("[TASK] Free heap after: %d bytes\n", ESP.getFreeHeap());
    Serial.printf("[TASK] Stack high water mark: %d bytes\n", uxTaskGetStackHighWaterMark(NULL));
    Serial.println("[TASK] ========================================");
    
    releases_fetch_in_progress = false;
    vTaskDelete(NULL);  // Task complete, delete self
}

/**
 * @brief Arduino setup function
 */
void setup() {
    // Initialize serial
    Serial.begin(115200);
    delay(1000);  // Wait for serial to stabilize
    
    Serial.println("\n\n[BOOT] ========================================");
    Serial.println("[BOOT] ESP32-S3 Bootstrap Firmware Starting");
    Serial.println("[BOOT] ========================================\n");
    Serial.printf("[BOOT] Reset reason: %d\n", static_cast<int>(esp_reset_reason()));

    print_startup_banner();

    // Initialize LED matrix display
    Serial.println("[BOOT] Initializing display...");
    if (display.begin()) {
        display.showBootstrap(BOOTSTRAP_VERSION);
    }

    // Initialize configuration store
    Serial.println("[BOOT] Initializing configuration...");
    Serial.flush();  // Ensure output before potential hang
    if (!config_store.begin()) {
        Serial.println("[BOOT] WARNING: Failed to initialize config store");
    }
    config_store.ensureDefaults();
    Serial.println("[BOOT] Configuration initialized successfully");
    Serial.flush();

    // Initialize components
    wifi_provisioner.begin(&config_store);
    ota_downloader.begin(&config_store);

    // Set up OTA progress callback to update display
    ota_downloader.setProgressCallback(ota_progress_callback);

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
    // Process WiFi provisioner
    wifi_provisioner.loop();

    // Process web server
    web_setup.loop();

    // Handle pending actions from web interface
    handle_pending_actions();

    // Handle post-connection setup for any connection path
    handle_connected_state();

    // Surface OTA errors on the display if OTA fails
    if (ota_in_progress) {
        OTAStatus status = ota_downloader.getStatus();
        if (status >= OTAStatus::ERROR_NO_URL) {
            display.showError(ota_downloader.getStatusMessage());
            ota_in_progress = false;
        }
    }

    // Update display animations (scrolling text)
    display.update();

    // Print connection info every 10 seconds (so it's visible when serial connects)
    if (millis() - last_ip_print >= 10000) {
        print_connection_info();
        last_ip_print = millis();
    }

    // Full status print every 30 seconds
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
    String ssid = config_store.getWiFiSSID();
    Serial.printf("[BOOT] Attempting to connect to '%s'...\n", ssid.c_str());

    // Check if the configured network was found in the initial scan
    if (!wifi_provisioner.isNetworkInScanResults(ssid)) {
        Serial.println("[BOOT] Configured WiFi network not found!");
        Serial.println("[BOOT] Starting provisioning mode for reconfiguration...");
        display.showError("WiFi Not Found");
        delay(2000);
        
        // List available networks
        Serial.println("[BOOT] Available networks:");
        for (int i = 0; i < wifi_provisioner.getScannedNetworkCount(); i++) {
            Serial.printf("  %d. %s (%d dBm)%s\n", 
                          i + 1,
                          wifi_provisioner.getScannedSSID(i).c_str(),
                          wifi_provisioner.getScannedRSSI(i),
                          wifi_provisioner.isScannedNetworkEncrypted(i) ? " [encrypted]" : "");
        }
        
        start_provisioning_mode();
        return;
    }

    // Show connecting status on display
    display.showConnecting(ssid);

    if (wifi_provisioner.connectWithStoredCredentials()) {
        Serial.println("[BOOT] WiFi connected successfully!");
        Serial.printf("[BOOT] IP Address: %s\n", WiFi.localIP().toString().c_str());

        // Start mDNS
        start_mdns();

        // Show connected status with IP and hostname on display
        display.showConnected(WiFi.localIP().toString(), mdns_hostname);
        delay(3000);  // Show connection info for 3 seconds

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
                // Show connection info again since OTA failed
                display.showConnected(WiFi.localIP().toString(), mdns_hostname);
                Serial.printf("[BOOT] Web UI: http://%s or http://%s.local\n", 
                              WiFi.localIP().toString().c_str(), mdns_hostname.c_str());
                Serial.println("[BOOT] Use web interface to retry OTA or reconfigure");
                
                // Start background task to fetch releases for web UI
                ensure_releases_fetch_started();
            }
        } else {
            // Start web server for configuration
            web_setup.begin(&config_store, &wifi_provisioner, &ota_downloader);
            Serial.println("[BOOT] No OTA URL configured");
            Serial.println("[BOOT] Use web interface to configure and install firmware");
            Serial.printf("[BOOT] Web UI: http://%s or http://%s.local\n", 
                          WiFi.localIP().toString().c_str(), mdns_hostname.c_str());
            
            // Start background task to fetch releases
            ensure_releases_fetch_started();
        }
    } else {
        Serial.println("[BOOT] WiFi connection failed");
        display.showError("WiFi Failed");
        delay(2000);
        start_provisioning_mode();
    }
}

/**
 * @brief Start WiFi provisioning mode (AP)
 */
void start_provisioning_mode() {
    Serial.println("[BOOT] Starting provisioning mode...");

    // Start AP (this will use cached scan results)
    wifi_provisioner.startAPWithSmartConfig();

    // Show AP mode on display
    display.showAPMode(AP_SSID, WiFi.softAPIP().toString());

    // Start web server
    web_setup.begin(&config_store, &wifi_provisioner, &ota_downloader);

    Serial.println();
    Serial.println("=============================================");
    Serial.println("  SETUP MODE ACTIVE");
    Serial.println("=============================================");
    Serial.printf("  WiFi AP: %s (open network)\n", AP_SSID);
    Serial.printf("  Web UI: http://%s\n", WiFi.softAPIP().toString().c_str());
    Serial.println();
    
    // Print available networks (from cached scan)
    int network_count = wifi_provisioner.getScannedNetworkCount();
    if (network_count > 0) {
        Serial.printf("  Available networks (%d found):\n", network_count);
        for (int i = 0; i < min(network_count, 10); i++) {  // Show top 10
            Serial.printf("    - %s (%d dBm)\n", 
                          wifi_provisioner.getScannedSSID(i).c_str(),
                          wifi_provisioner.getScannedRSSI(i));
        }
        if (network_count > 10) {
            Serial.printf("    ... and %d more\n", network_count - 10);
        }
    }
    
    Serial.println();
    Serial.println("  Connect to WiFi - captive portal will open");
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
        display.showConnecting(config_store.getWiFiSSID());

        // Stop current provisioning
        wifi_provisioner.stopProvisioning();

        // Try to connect with new credentials
        if (wifi_provisioner.connectWithStoredCredentials()) {
            Serial.println("[BOOT] Connected with new credentials!");
            Serial.printf("[BOOT] IP: %s\n", WiFi.localIP().toString().c_str());

            // Start mDNS
            start_mdns();

            // Show connected status
            display.showConnected(WiFi.localIP().toString(), mdns_hostname);

            // Start background task to fetch releases for web UI
            ensure_releases_fetch_started();

            // Stay in station mode but keep web server running
            // User can trigger OTA via web interface
        } else {
            Serial.println("[BOOT] Connection failed, restarting provisioning...");
            display.showError("Connect Failed");
            delay(2000);
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
        
        bool ota_success = false;
        int selected_index = web_setup.getSelectedReleaseIndex();
        
        if (selected_index >= 0) {
            // User selected a specific release (including beta)
            Serial.printf("[BOOT] Installing selected release index: %d\n", selected_index);
            ota_success = ota_downloader.installRelease(selected_index);
        } else {
            // Auto-install latest stable (checkAndInstall skips betas)
            ota_success = ota_downloader.checkAndInstall();
        }

        if (ota_success) {
            // This won't return if successful
            Serial.println("[BOOT] OTA in progress...");
        } else {
            Serial.println("[BOOT] OTA failed");
            ota_in_progress = false;
        }
    }
}

/**
 * @brief Ensure releases fetch runs with backoff and retry limits
 */
void ensure_releases_fetch_started() {
    if (!wifi_provisioner.isConnected()) {
        Serial.println("[TASK] Cannot start release fetch - WiFi not connected");
        return;
    }

    // Check if we've exceeded maximum retries
    if (releases_fetch_retry_count >= MAX_FETCH_RETRIES && !ota_downloader.hasReleasesCached()) {
        Serial.printf("[TASK] Maximum retry attempts reached (%d/%d), giving up\n", 
                      releases_fetch_retry_count, MAX_FETCH_RETRIES);
        Serial.println("[TASK] User can manually trigger fetch via web UI");
        return;
    }

    if (ota_downloader.hasReleasesCached()) {
        if (!releases_cached_message_shown) {
            Serial.printf("[TASK] Releases already cached (%d available)\n", 
                          ota_downloader.getReleaseCount());
            releases_cached_message_shown = true;
        }
        return;
    }

    unsigned long now = millis();
    if (releases_fetch_in_progress) {
        unsigned long elapsed = now - last_releases_fetch_attempt;
        Serial.printf("[TASK] Release fetch already in progress (elapsed: %lu ms)\n", elapsed);
        return;
    }

    // Exponential backoff based on retry count
    unsigned long backoff_time = 10000 * (1 << min(releases_fetch_retry_count, 2));  // 10s, 20s, 40s
    if (last_releases_fetch_attempt != 0 && (now - last_releases_fetch_attempt) < backoff_time) {
        unsigned long wait_time = backoff_time - (now - last_releases_fetch_attempt);
        Serial.printf("[TASK] Waiting %lu ms before next fetch attempt (backoff)\n", wait_time);
        return;
    }

    // Verify we have enough heap memory for the task
    size_t free_heap = ESP.getFreeHeap();
    if (free_heap < 30000) {  // Need at least 30KB free
        Serial.printf("[TASK] ERROR: Insufficient heap memory (%d bytes), cannot create fetch task\n", free_heap);
        Serial.println("[TASK] Will retry after memory is freed");
        return;
    }

    last_releases_fetch_attempt = now;
    
    Serial.printf("[TASK] Creating release fetch task (stack: 12288 bytes, free heap: %d)\n", free_heap);
    
    // Increased stack from 8192 to 12288 bytes for larger JSON parsing
    BaseType_t result = xTaskCreate(fetch_releases_task, "FetchReleases", 12288, NULL, 1, NULL);
    
    if (result != pdPASS) {
        Serial.println("[TASK] ERROR: Failed to create release fetch task!");
        Serial.println("[TASK] FreeRTOS may be out of resources");
        releases_fetch_in_progress = false;
        releases_fetch_retry_count++;
    } else {
        Serial.println("[TASK] Release fetch task created successfully");
    }
}

/**
 * @brief Handle actions once WiFi is connected
 */
void handle_connected_state() {
    if (wifi_provisioner.isConnected()) {
        // Track when WiFi first connected
        if (wifi_connected_time == 0) {
            wifi_connected_time = millis();
        }
        
        if (!mdns_started) {
            start_mdns();
        }

        if (!wifi_connected_handled && !ota_in_progress) {
            display.showConnected(WiFi.localIP().toString(), mdns_hostname);
            wifi_connected_handled = true;
        }

        // Only try fetching releases after WiFi has been stable for at least 2 seconds
        // This prevents premature fetch attempts during DHCP/DNS setup
        if (millis() - wifi_connected_time > 2000) {
            ensure_releases_fetch_started();
        }
        return;
    }

    // Reset flags on disconnect so we re-run setup on reconnect
    mdns_started = false;
    wifi_connected_handled = false;
    wifi_connected_time = 0;  // Reset connection time
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
        Serial.printf("  mDNS: %s.local\n", mdns_hostname.c_str());
    }

    if (wifi_provisioner.isAPActive()) {
        Serial.printf("  AP Active: Yes (IP: %s)\n", WiFi.softAPIP().toString().c_str());
    }

    Serial.printf("  Free Heap: %d bytes\n", ESP.getFreeHeap());
    Serial.printf("  Uptime: %lu seconds\n", millis() / 1000);
    Serial.println("--------------");
    Serial.println();
}

/**
 * @brief Print connection info (short version for serial monitoring)
 * This prints every 10 seconds so users can see IP when they connect serial
 */
void print_connection_info() {
    Serial.println();
    Serial.println("=== WEBEX DISPLAY BOOTSTRAP ===");
    
    if (wifi_provisioner.isConnected()) {
        Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("Web UI: http://%s or http://%s.local\n", 
                      WiFi.localIP().toString().c_str(), mdns_hostname.c_str());
    }
    
    if (wifi_provisioner.isAPActive()) {
        Serial.printf("Setup WiFi: %s\n", AP_SSID);
        Serial.printf("Setup URL: http://%s\n", WiFi.softAPIP().toString().c_str());
    }
    
    if (!wifi_provisioner.isConnected() && !wifi_provisioner.isAPActive()) {
        Serial.println("Status: Initializing...");
    }
    
    Serial.println("===============================");
}

/**
 * @brief Start mDNS service
 */
void start_mdns() {
    mdns_hostname = MDNS_HOSTNAME;

    // Retry a few times to avoid transient failures
    for (int attempt = 1; attempt <= 3; attempt++) {
        if (MDNS.begin(MDNS_HOSTNAME)) {
            mdns_started = true;
            Serial.printf("[BOOT] mDNS started: %s.local\n", mdns_hostname.c_str());
            MDNS.addService("http", "tcp", 80);
            return;
        }
        Serial.printf("[BOOT] mDNS start failed (attempt %d/3)\n", attempt);
        delay(300);
    }

    Serial.println("[BOOT] mDNS failed to start (no fallback)");
}

/**
 * @brief OTA progress callback - updates display
 */
void ota_progress_callback(int progress, const char* message) {
    display.showOTAProgress(progress, String(message));
}
