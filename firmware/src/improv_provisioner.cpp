/**
 * @file improv_provisioner.cpp
 * @brief Improv WiFi provisioning implementation
 */

#include "improv_provisioner.h"
#include "time/time_manager.h"

// External global instances from main.cpp
extern ImprovHandler improv_handler;

/**
 * @brief Detect Improv activity during detection window
 *
 * @param detect_timeout Detection timeout in milliseconds
 * @param display_ok Whether display is available
 * @param matrix_display Display instance (may be nullptr)
 * @return true if activity was detected
 */
static bool detectImprovActivity(
    unsigned long detect_timeout,
    bool display_ok,
    MatrixDisplay* matrix_display
) {
    unsigned long detect_start = millis();
    
    while (millis() - detect_start < detect_timeout) {
        if (Serial.available() > 0) {
            Serial.println("[IMPROV] Serial activity detected! Extending window for provisioning...");
            if (display_ok && matrix_display) {
                matrix_display->showImprovProvisioning();
            }
            return true;
        }
        
        improv_handler.loop();
        
        if (improv_handler.wasConfiguredViaImprov() || WiFi.status() == WL_CONNECTED) {
            Serial.println("[IMPROV] WiFi configured successfully!");
            return false;  // Already configured, no need for extended provisioning
        }
        
        delay(10);
    }
    
    return false;
}

/**
 * @brief Wait for Improv provisioning to complete
 *
 * @param provision_timeout Provisioning timeout in milliseconds
 */
static void waitForImprovProvisioning(unsigned long provision_timeout) {
    Serial.printf("[IMPROV] Waiting for WiFi provisioning (%lu seconds)...\n",
                  provision_timeout / 1000);
    
    unsigned long provision_start = millis();
    unsigned long last_status = 0;
    
    while (millis() - provision_start < provision_timeout) {
        improv_handler.loop();
        
        if (improv_handler.wasConfiguredViaImprov() || WiFi.status() == WL_CONNECTED) {
            Serial.println("[IMPROV] WiFi configured successfully!");
            return;
        }
        
        unsigned long elapsed = millis() - provision_start;
        if (elapsed - last_status >= 5000) {
            last_status = elapsed;
            Serial.printf("[IMPROV] Waiting... %lu seconds remaining\n",
                          (provision_timeout - elapsed) / 1000);
        }
        
        delay(10);
    }
}

void initWiFiAndImprov(
    ConfigManager& config_manager,
    AppState& app_state,
    MatrixDisplay* matrix_display,
    MDNSManager& mdns_manager,
    WiFiManager& wifi_manager,
    bool display_ok
) {
    // Initialize WiFi in STA mode (required for scanning)
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(WIFI_PS_NONE);  // Disable power save (prevents display interference)
    Serial.println("[INIT] WiFi initialized in STA mode");

    Serial.println("[IMPROV] Initializing Improv Wi-Fi handler...");
    improv_handler.begin(&Serial, &config_manager, &app_state, display_ok ? matrix_display : nullptr);

    // Check if WiFi is already configured
    bool wifi_configured = config_manager.hasWiFiCredentials();
    
    // Check boot count - if high, we're in a boot loop and need extended timeouts
    // This allows recovery via website firmware installer even during boot loops
    int boot_count = boot_validator.getBootCount();
    bool recovery_mode = (boot_count > MAX_BOOT_FAILURES);
    
    // Improv detection strategy:
    // - WiFi configured + normal boot: Skip Improv entirely (fast boot)
    // - WiFi configured + recovery mode: Brief 30-second window for firmware installer
    // - No WiFi configured + normal boot: 10-second detection window
    // - No WiFi configured + recovery mode: Extended 5-minute detection window
    
    bool improv_activity_detected = false;
    
    if (wifi_configured && !recovery_mode) {
        // Normal boot with WiFi configured - skip Improv entirely for fast boot
        Serial.println("[IMPROV] WiFi already configured, skipping provisioning window");
    } else if (wifi_configured && recovery_mode) {
        // Recovery mode with WiFi configured - brief window for firmware installer
        Serial.println("[IMPROV] Recovery mode: Brief Improv window (30 sec) for firmware installer...");
        Serial.printf("[IMPROV] Boot count: %d (threshold: %d)\n", boot_count, MAX_BOOT_FAILURES);
        
        unsigned long DETECT_TIMEOUT = 30000;   // 30 seconds in recovery with WiFi
        unsigned long PROVISION_TIMEOUT = 60000;  // 60 seconds for provisioning
        
        // Phase 1: Detection (30 seconds)
        improv_activity_detected = detectImprovActivity(DETECT_TIMEOUT, display_ok, matrix_display);
        
        // Phase 2: Extended provisioning if activity was detected
        if (improv_activity_detected && WiFi.status() != WL_CONNECTED) {
            waitForImprovProvisioning(PROVISION_TIMEOUT);
        }
        
        if (!improv_activity_detected) {
            Serial.println("[IMPROV] No serial activity detected, continuing boot...");
        }
    } else {
        // No WiFi configured - run full Improv detection
        unsigned long DETECT_TIMEOUT = recovery_mode ? 300000 : 10000;   // 5 min vs 10 sec
        unsigned long PROVISION_TIMEOUT = recovery_mode ? 300000 : 60000;  // 5 min vs 60 sec
        
        if (recovery_mode) {
            Serial.println("[IMPROV] RECOVERY MODE: Boot loop detected, extending timeouts for firmware installer recovery");
            Serial.printf("[IMPROV] Boot count: %d (threshold: %d)\n", boot_count, MAX_BOOT_FAILURES);
            Serial.printf("[IMPROV] Extended timeouts: %lu sec detection, %lu sec provisioning\n",
                          DETECT_TIMEOUT / 1000, PROVISION_TIMEOUT / 1000);
        } else {
            Serial.printf("[IMPROV] No WiFi configured - detecting serial activity (%lu seconds)...\n",
                          DETECT_TIMEOUT / 1000);
        }
        
        // Phase 1: Detection
        improv_activity_detected = detectImprovActivity(DETECT_TIMEOUT, display_ok, matrix_display);
        
        // Phase 2: Extended provisioning if activity was detected
        if (improv_activity_detected && WiFi.status() != WL_CONNECTED) {
            waitForImprovProvisioning(PROVISION_TIMEOUT);
        }
        
        if (!improv_activity_detected) {
            Serial.println("[IMPROV] No serial activity detected, continuing boot...");
        }
    }
    
    // Handle successful Improv provisioning
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("[IMPROV] Provisioning complete, continuing boot...");
        if (display_ok && matrix_display) {
            matrix_display->showUnconfigured(WiFi.localIP().toString(), "");
        }
        
        // If WiFi was configured via Improv (from ESP Web Tools), mark boot successful early
        // This prevents boot loop if other initialization fails, allowing WiFi provisioning to complete
        if (improv_handler.wasConfiguredViaImprov()) {
            Serial.println("[IMPROV] WiFi configured via ESP Web Tools - marking boot successful early");
            boot_validator.markBootSuccessful();
        }
    } else if (improv_activity_detected) {
        Serial.println("[IMPROV] Provisioning window closed, continuing to AP mode...");
    }

    // Setup WiFi (includes AP mode fallback if connection fails)
    Serial.println("[INIT] Setting up WiFi...");
    wifi_manager.begin(&config_manager, &app_state, matrix_display);
    wifi_manager.setupWiFi();

    // Initialize mDNS and sync time if WiFi is connected
    if (app_state.wifi_connected) {
        Serial.println("[INIT] Starting mDNS...");
        mdns_manager.begin(config_manager.getDeviceName());
        mdns_manager.advertiseHTTP(80);

        // Sync time via NTP
        Serial.println("[INIT] Syncing time via NTP...");
        if (!applyTimeConfig(config_manager, &app_state)) {
            Serial.println("[TIME] Failed to apply time configuration");
        }
    }
}
