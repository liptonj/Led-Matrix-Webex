/**
 * @file improv_handler.h
 * @brief Improv Wi-Fi Serial Protocol Handler
 * 
 * Implements the Improv Wi-Fi standard for configuring WiFi via serial.
 * This allows ESP Web Tools to configure WiFi after flashing.
 * 
 * @see https://www.improv-wifi.com/
 * @see https://esphome.github.io/esp-web-tools/
 */

#ifndef IMPROV_HANDLER_H
#define IMPROV_HANDLER_H

#include <Arduino.h>
#include <ImprovWiFiLibrary.h>
#include "../config/config_manager.h"
#include "../app_state.h"

// Forward declarations
class MatrixDisplay;

/**
 * @brief Improv Wi-Fi Handler
 * 
 * Handles the Improv Wi-Fi serial protocol for WiFi provisioning.
 * When a device is flashed via ESP Web Tools, this handler allows
 * the user to configure WiFi credentials directly from the browser.
 */
class ImprovHandler {
public:
    ImprovHandler();
    ~ImprovHandler();

    /**
     * @brief Initialize the Improv handler
     * @param serial Pointer to the Serial stream (usually &Serial)
     * @param config Pointer to configuration manager
     * @param state Pointer to application state
     * @param display Pointer to matrix display (optional, for status updates)
     */
    void begin(Stream* serial, ConfigManager* config, AppState* state, MatrixDisplay* display = nullptr);
    
    /**
     * @brief Process incoming Improv commands
     * 
     * Call this in the main loop. It will handle incoming Improv
     * protocol messages and respond appropriately.
     */
    void loop();
    
    /**
     * @brief Check if Improv is currently active (provisioning in progress)
     * @return true if Improv provisioning is in progress
     */
    bool isProvisioning() const;
    
    /**
     * @brief Check if WiFi was configured via Improv
     * @return true if WiFi credentials were received and connection succeeded
     */
    bool wasConfiguredViaImprov() const;

private:
    ImprovWiFi* improv;
    ConfigManager* config_manager;
    AppState* app_state;
    MatrixDisplay* matrix_display;
    
    bool provisioning_active;
    bool configured_via_improv;
    bool initialized;
    
    // Callback handlers
    static ImprovHandler* instance;
    static void onImprovError(ImprovTypes::Error error);
    static void onImprovConnected(const char* ssid, const char* password);
};

// Global instance
extern ImprovHandler improv_handler;

#endif // IMPROV_HANDLER_H
