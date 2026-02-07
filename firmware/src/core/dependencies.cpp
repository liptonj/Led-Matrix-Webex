/**
 * @file dependencies.cpp
 * @brief Dependency Injection Framework Implementation
 *
 * Provides initialization helper for the Dependencies struct.
 * The getDependencies() function is implemented in main.cpp where
 * the global instance is managed.
 */

#include "dependencies.h"

// Include headers for type definitions
#include "app_state.h"
#include "auth/device_credentials.h"
#include "boot_validator.h"
#include "commands/command_processor.h"
#include "config/config_manager.h"
#include "display/matrix_display.h"
#include "discovery/mdns_manager.h"
#include "improv/improv_handler.h"
#include "meraki/mqtt_client.h"
#include "ota/ota_manager.h"
#include "realtime/realtime_manager.h"
#include "supabase/supabase_client.h"
#include "supabase/supabase_realtime.h"
#include "sync/sync_manager.h"
#include "web/web_server.h"
#include "webex/webex_client.h"
#include "webex/xapi_websocket.h"
#include "wifi/wifi_manager.h"

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
) {
    return Dependencies(
        config_manager,
        app_state,
        matrix_display,
        wifi_manager,
        web_server,
        mdns_manager,
        supabaseClient,
        supabaseRealtime,
        deviceCredentials,
        pairing_manager,
        boot_validator,
        ota_manager,
        mqtt_client,
        syncManager,
        realtimeManager,
        commandProcessor,
        improv_handler,
        webex_client,
        xapi_websocket
    );
}
