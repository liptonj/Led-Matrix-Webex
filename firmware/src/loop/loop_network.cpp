/**
 * @file loop_network.cpp
 * @brief Network infrastructure handlers
 *
 * Handles WiFi provisioning, connection management, mDNS, and time synchronization.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include <WiFi.h>
#include "config/config_manager.h"
#include "discovery/mdns_manager.h"
#include "wifi/wifi_manager.h"
#include "improv/improv_handler.h"
#include "serial/serial_commands.h"
#include "supabase/supabase_client.h"
#include "common/pairing_manager.h"
#include "display/matrix_display.h"
#include "debug/remote_logger.h"

// Forward declarations for functions still in main.cpp
extern void setup_time();

// External globals from main.cpp
extern ConfigManager config_manager;
extern MatrixDisplay matrix_display;
extern WiFiManager wifi_manager;
extern AppState app_state;
extern PairingManager pairing_manager;
extern SupabaseClient supabaseClient;

// =============================================================================
// SERIAL AND IMPROV HANDLER
// =============================================================================

void handleSerialAndImprov(LoopContext& ctx) {
    // Process Improv Wi-Fi commands (for ESP Web Tools WiFi provisioning)
    // This must be called frequently to respond to Improv requests
    improv_handler.loop();

    // Process serial commands (for web installer WiFi setup)
    serial_commands_loop();

    // Handle WiFi credentials set via serial command
    if (serial_wifi_pending()) {
        String ssid = serial_wifi_get_ssid();
        String password = serial_wifi_get_password();
        serial_wifi_clear_pending();

        Serial.printf("[WIFI] Connecting to '%s'...\n", ssid.c_str());

        WiFi.disconnect();
        WiFi.begin(ssid.c_str(), password.c_str());

        // Wait for connection with timeout (non-blocking)
        unsigned long start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
            vTaskDelay(pdMS_TO_TICKS(500));
            Serial.print(".");
        }
        Serial.println();

        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
            ctx.app_state->wifi_connected = true;

            // Disable provisioning AP now that we're connected
            ctx.wifi_manager->disableAP();

            // Start mDNS
            ctx.mdns_manager->begin(ctx.config_manager->getDeviceName());
            ctx.mdns_manager->advertiseHTTP(80);

            // Sync time
            setup_time();

            ctx.matrix_display->showUnconfigured(WiFi.localIP().toString(), ctx.mdns_manager->getHostname());
        } else {
            Serial.println("[WIFI] Connection failed!");
            RLOG_ERROR("loop", "WiFi connection failed");
            ctx.app_state->wifi_connected = false;
        }
    }
}

// =============================================================================
// WIFI CONNECTION HANDLER
// =============================================================================

void handleWiFiConnection(LoopContext& ctx) {
    // Handle WiFi connection
    ctx.wifi_manager->handleConnection(ctx.mdns_manager);

    // Track WiFi state transitions to trigger OTA check on reconnect
    static bool was_wifi_connected = false;
    if (ctx.app_state->wifi_connected && !was_wifi_connected) {
        // WiFi just connected (either first time or after disconnect)
        // Defer OTA checks to keep startup responsive.
        ctx.app_state->last_ota_check = ctx.current_time;

        // Deferred Supabase client initialization
        // Handles case where WiFi wasn't available at boot
        if (!supabaseClient.isInitialized()) {
            String supabase_url = config_manager.getSupabaseUrl();
            if (!supabase_url.isEmpty()) {
                Serial.println("[SUPABASE] Deferred initialization - WiFi now connected");
                supabaseClient.begin(supabase_url, pairing_manager.getCode());
            }
        }
    }
    was_wifi_connected = ctx.app_state->wifi_connected;
}

// =============================================================================
// MDNS HANDLER
// =============================================================================

void handleMDNS(LoopContext& ctx) {
    if (!ctx.app_state->wifi_connected) {
        return;
    }

    // Refresh mDNS periodically to prevent TTL expiry
    ctx.mdns_manager->refresh();

    // Ensure mDNS stays active even if the responder stalls
    static unsigned long last_mdns_check = 0;
    if (ctx.current_time - last_mdns_check >= 5000) {
        last_mdns_check = ctx.current_time;
        if (!ctx.mdns_manager->isInitialized()) {
            Serial.println("[MDNS] mDNS not running, restarting...");
            ctx.mdns_manager->end();
            if (ctx.mdns_manager->begin(ctx.config_manager->getDeviceName())) {
                ctx.mdns_manager->advertiseHTTP(80);
            }
        }
    }
}

// =============================================================================
// TIME SYNC HANDLER
// =============================================================================

void handleTimeSync(LoopContext& ctx) {
    // Handle NTP time sync after reconnect
    if (ctx.app_state->wifi_connected && !ctx.app_state->time_synced) {
        setup_time();
    }
}

#endif // !NATIVE_BUILD
