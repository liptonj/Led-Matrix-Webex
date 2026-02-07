/**
 * @file dependencies.h
 * @brief Dependency Injection Framework for ESP32 Firmware
 *
 * Provides a centralized Dependencies struct that holds references to all
 * shared components, replacing scattered extern declarations across the codebase.
 *
 * This is step 1 of a multi-step migration from global extern declarations
 * to dependency injection. The existing extern declarations remain functional
 * for backward compatibility during the migration.
 */

#ifndef DEPENDENCIES_H
#define DEPENDENCIES_H

#include <Arduino.h>

// Forward declarations for all component types
class ConfigManager;
class MatrixDisplay;
class MDNSManager;
class WebServerManager;
class WebexClient;
class XAPIWebSocket;
class WiFiManager;
class SupabaseClient;
class SupabaseRealtime;
class DeviceCredentials;
class PairingManager;
class BootValidator;
class OTAManager;
class MerakiMQTTClient;
class SyncManager;
class RealtimeManager;
class CommandProcessor;
class ImprovHandler;
struct AppState;

/**
 * @brief Centralized dependency container
 *
 * Holds references to all shared components used throughout the firmware.
 * Uses references (not pointers) to ensure non-null dependencies.
 *
 * Organized by category for clarity:
 * - Configuration: Config, state, debug flags
 * - Display: LED matrix display
 * - Network: WiFi, web server, mDNS
 * - Supabase: REST client and realtime WebSocket
 * - Device: Credentials, pairing, boot validation
 * - Managers: OTA, MQTT, sync, realtime, commands, logging, Improv
 * - Webex: Webex client and xAPI WebSocket
 */
struct Dependencies {
    // =========================================================================
    // Configuration
    // =========================================================================
    ConfigManager& config;
    AppState& app_state;

    // =========================================================================
    // Display
    // =========================================================================
    MatrixDisplay& display;

    // =========================================================================
    // Network
    // =========================================================================
    WiFiManager& wifi;
    WebServerManager& web_server;
    MDNSManager& mdns;

    // =========================================================================
    // Supabase
    // =========================================================================
    SupabaseClient& supabase;
    SupabaseRealtime& realtime;

    // =========================================================================
    // Device
    // =========================================================================
    DeviceCredentials& credentials;
    PairingManager& pairing;
    BootValidator& boot_validator;

    // =========================================================================
    // Managers
    // =========================================================================
    OTAManager& ota;
    MerakiMQTTClient& mqtt;
    SyncManager& sync;
    RealtimeManager& realtime_manager;
    CommandProcessor& command_processor;
    ImprovHandler& improv;

    // =========================================================================
    // Webex
    // =========================================================================
    WebexClient& webex;
    XAPIWebSocket& xapi;

    /**
     * @brief Constructor - initializes all references
     *
     * @param config_ ConfigManager instance
     * @param app_state_ AppState instance
     * @param display_ MatrixDisplay instance
     * @param wifi_ WiFiManager instance
     * @param web_server_ WebServerManager instance
     * @param mdns_ MDNSManager instance
     * @param supabase_ SupabaseClient instance
     * @param realtime_ SupabaseRealtime instance
     * @param credentials_ DeviceCredentials instance
     * @param pairing_ PairingManager instance
     * @param boot_validator_ BootValidator instance
     * @param ota_ OTAManager instance
     * @param mqtt_ MerakiMQTTClient instance
     * @param sync_ SyncManager instance
     * @param realtime_manager_ RealtimeManager instance
     * @param command_processor_ CommandProcessor instance
     * @param improv_ ImprovHandler instance
     * @param webex_ WebexClient instance
     * @param xapi_ XAPIWebSocket instance
     */
    Dependencies(
        ConfigManager& config_,
        AppState& app_state_,
        MatrixDisplay& display_,
        WiFiManager& wifi_,
        WebServerManager& web_server_,
        MDNSManager& mdns_,
        SupabaseClient& supabase_,
        SupabaseRealtime& realtime_,
        DeviceCredentials& credentials_,
        PairingManager& pairing_,
        BootValidator& boot_validator_,
        OTAManager& ota_,
        MerakiMQTTClient& mqtt_,
        SyncManager& sync_,
        RealtimeManager& realtime_manager_,
        CommandProcessor& command_processor_,
        ImprovHandler& improv_,
        WebexClient& webex_,
        XAPIWebSocket& xapi_
    ) : config(config_),
        app_state(app_state_),
        display(display_),
        wifi(wifi_),
        web_server(web_server_),
        mdns(mdns_),
        supabase(supabase_),
        realtime(realtime_),
        credentials(credentials_),
        pairing(pairing_),
        boot_validator(boot_validator_),
        ota(ota_),
        mqtt(mqtt_),
        sync(sync_),
        realtime_manager(realtime_manager_),
        command_processor(command_processor_),
        improv(improv_),
        webex(webex_),
        xapi(xapi_)
    {}
};

/**
 * @brief Initialize Dependencies instance with all global components
 *
 * Creates a Dependencies instance initialized with all the global component
 * instances defined in main.cpp. This function should be called after all
 * global instances are declared.
 *
 * @return Dependencies instance with all references initialized
 */
Dependencies initializeDependencies(
    ConfigManager& config_manager,
    AppState& app_state,
    MatrixDisplay& matrix_display,
    WiFiManager& wifi_manager,
    WebServerManager& web_server,
    MDNSManager& mdns_manager,
    SupabaseClient& supabaseClient,
    SupabaseRealtime& supabaseRealtime,
    DeviceCredentials& deviceCredentials,
    PairingManager& pairing_manager,
    BootValidator& boot_validator,
    OTAManager& ota_manager,
    MerakiMQTTClient& mqtt_client,
    SyncManager& syncManager,
    RealtimeManager& realtimeManager,
    CommandProcessor& commandProcessor,
    ImprovHandler& improv_handler,
    WebexClient& webex_client,
    XAPIWebSocket& xapi_websocket
);

/**
 * @brief Get the global Dependencies instance
 *
 * Returns a reference to the global Dependencies instance initialized in setup().
 * This provides centralized access to all shared components.
 *
 * @return Dependencies& Reference to the global Dependencies instance
 * @note Must be called after setup() completes initialization
 * @note Returns a valid reference - the instance is initialized in setup()
 */
Dependencies& getDependencies();

#endif // DEPENDENCIES_H
