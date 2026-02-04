/**
 * @file supabase_init.cpp
 * @brief Supabase initialization and authentication implementation
 */

#include "supabase_init.h"
#include "auth/device_credentials.h"
#include "device/device_info.h"
#include "debug/remote_logger.h"
#include "sync/sync_manager.h"
#include "loop/loop_handlers.h"
#include "core/dependencies.h"
#include "display/matrix_display.h"
#include <WiFi.h>
#include <Arduino.h>  // Provides ESP object (getFreeHeap, restart, etc.)

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

void initSupabase(
    ConfigManager& config_manager,
    AppState& app_state,
    PairingManager& pairing_manager
) {
    // Initialize Supabase client FIRST (required for provisioning to work)
    String supabase_url = config_manager.getSupabaseUrl();
    if (!supabase_url.isEmpty() && app_state.wifi_connected) {
        Serial.println("[INIT] Initializing Supabase client...");
        auto& deps = getDependencies();
        deps.supabase.begin(supabase_url, pairing_manager.getCode());
    }

    // Register device with Supabase on first boot (requires WiFi + Supabase URL)
    // Skip if device already has credentials (HMAC secret + pairing code = already registered)
    bool skipped_provisioning = false;
    if (app_state.wifi_connected) {
        if (pairing_manager.hasCode()) {
            Serial.println("[SUPABASE] Existing credentials found - skipping provisioning");
            skipped_provisioning = true;
            // Small delay to allow heap to stabilize (provisioning HTTP would take 1-2s)
            delay(100);
        } else {
            // Display serial number before attempting provision
            auto& deps = getDependencies();
            deps.display.displayProvisioningStatus(deps.credentials.getSerialNumber());
            
            provisionDeviceWithSupabase();
        }
    }

    // Continue with authentication logic
    if (!supabase_url.isEmpty() && app_state.wifi_connected) {
        
        // Attempt initial authentication
        if (app_state.supabase_approval_pending || app_state.supabase_disabled ||
            app_state.supabase_blacklisted || app_state.supabase_deleted) {
            Serial.println("[SUPABASE] Provisioning awaiting admin approval - skipping auth");
        } else if (!app_state.time_synced) {
            Serial.println("[SUPABASE] Waiting for NTP sync before authenticating");
        } else {
            auto& deps = getDependencies();
            if (deps.supabase.authenticate()) {
                app_state.supabase_connected = true;
                Serial.println("[INIT] Supabase client authenticated successfully");

                String authAnonKey = deps.supabase.getAnonKey();
                if (!authAnonKey.isEmpty() && authAnonKey != config_manager.getSupabaseAnonKey()) {
                    config_manager.setSupabaseAnonKey(authAnonKey);
                    Serial.println("[SUPABASE] Anon key updated from device-auth");
                }
                
                // Check for target firmware version
                String targetVersion = deps.supabase.getTargetFirmwareVersion();
                if (!targetVersion.isEmpty()) {
                    Serial.printf("[INIT] Target firmware version from Supabase: %s\n", 
                                  targetVersion.c_str());
                }
                
                // Immediately update device_connected so embedded app knows device is online
                if (hasSafeTlsHeap(65000, 40000)) {
                    Serial.println("[INIT] Sending initial device state to mark device as connected...");
                    int rssi = WiFi.RSSI();
                    uint32_t freeHeap = ESP.getFreeHeap();
                    uint32_t uptime = millis() / 1000;
                    float temp = app_state.temperature;
                    SupabaseAppState appState = deps.supabase.postDeviceState(rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);
                    if (appState.valid) {
                        DeviceInfo::applyAppState(appState);
                    }
                }
                
                Serial.println("[INIT] Deferring Supabase Realtime init until after OTA/web server settle...");
                // Use longer defer when we skipped provisioning (no TLS warmup from HTTP call)
                app_state.realtime_defer_until = millis() + (skipped_provisioning ? 20000UL : 15000UL);
                logHeapStatus("after supabase auth");
            } else {
                RLOG_WARN("init", "Supabase auth failed - will retry in loop");
                SupabaseAuthError authError = deps.supabase.getLastAuthError();
                if (authError == SupabaseAuthError::InvalidSignature) {
                    Serial.println("[SUPABASE] Invalid signature - triggering reprovision");
                    provisionDeviceWithSupabase();
                } else if (authError == SupabaseAuthError::ApprovalRequired) {
                    app_state.supabase_approval_pending = true;
                } else if (authError == SupabaseAuthError::Disabled) {
                    app_state.supabase_disabled = true;
                    Serial.println("[SUPABASE] Device disabled by admin");
                } else if (authError == SupabaseAuthError::Blacklisted) {
                    app_state.supabase_blacklisted = true;
                    Serial.println("[SUPABASE] Device blacklisted by admin");
                } else if (authError == SupabaseAuthError::Deleted) {
                    app_state.supabase_deleted = true;
                    Serial.println("[SUPABASE] Device deleted - clearing credentials");
                    deps.credentials.resetCredentials();
                    delay(200);
                    ESP.restart();
                }
            }
        }
    }
}
