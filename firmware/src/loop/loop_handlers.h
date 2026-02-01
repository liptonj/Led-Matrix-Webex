/**
 * @file loop_handlers.h
 * @brief Loop handler functions extracted from main.cpp
 *
 * This module contains handler functions for each logical section of the main loop.
 * The handlers are organized by responsibility and maintain the same state machine
 * logic as the original monolithic loop() function.
 *
 * Handler execution order is important - see executeLoopHandlers() for the
 * canonical ordering that preserves the original behavior.
 */

#ifndef LOOP_HANDLERS_H
#define LOOP_HANDLERS_H

#include <Arduino.h>
#include "app_state.h"

// Forward declarations for external types
class ConfigManager;
class MatrixDisplay;
class MDNSManager;
class WebServerManager;
class WebexClient;
class XAPIWebSocket;
class PairingManager;
class MerakiMQTTClient;
class OTAManager;
class WiFiManager;

/**
 * @brief Context structure passed to loop handlers
 *
 * Contains references to all managers and state needed by handlers.
 * This avoids global variable dependencies and makes testing easier.
 */
struct LoopContext {
    unsigned long current_time;
    AppState* app_state;
    ConfigManager* config_manager;
    MatrixDisplay* matrix_display;
    MDNSManager* mdns_manager;
    WebServerManager* web_server;
    WebexClient* webex_client;
    XAPIWebSocket* xapi_websocket;
    PairingManager* pairing_manager;
    MerakiMQTTClient* mqtt_client;
    OTAManager* ota_manager;
    WiFiManager* wifi_manager;
};

/**
 * @brief Heap trend monitoring structure
 *
 * Samples heap metrics over time to detect memory leaks or fragmentation trends.
 */
struct HeapTrendMonitor {
    static constexpr uint8_t kSamples = 8;
    static constexpr unsigned long kSampleIntervalMs = 5000;
    uint32_t free_samples[kSamples] = {};
    uint32_t block_samples[kSamples] = {};
    uint8_t count = 0;
    uint8_t index = 0;
    unsigned long last_sample = 0;
    unsigned long last_log = 0;

    void sample(unsigned long now);
    void logIfTrending(unsigned long now);
};

// =============================================================================
// HANDLER FUNCTION DECLARATIONS
// =============================================================================

/**
 * @brief Log heap status with label
 * @param label Descriptive label for the log entry
 */
void logHeapStatus(const char* label);

/**
 * @brief Check if heap has enough space for safe TLS operations
 * @param min_free Minimum free heap bytes required
 * @param min_block Minimum largest free block size required
 * @return true if heap is safe for TLS operations
 */
bool hasSafeTlsHeap(uint32_t min_free, uint32_t min_block);

/**
 * @brief Handle low heap recovery by disconnecting realtime if needed
 * @param ctx Loop context with app state
 */
void handleLowHeapRecovery(LoopContext& ctx);

/**
 * @brief Handle heap monitoring and trend detection
 * @param ctx Loop context with current time
 * @param heap_trend Heap trend monitor instance
 */
void handleHeapMonitoring(LoopContext& ctx, HeapTrendMonitor& heap_trend);

/**
 * @brief Process Improv and serial WiFi commands
 *
 * Handles ESP Web Tools WiFi provisioning and serial command WiFi setup.
 * Must be called frequently to respond to Improv requests.
 *
 * @param ctx Loop context with managers
 */
void handleSerialAndImprov(LoopContext& ctx);

/**
 * @brief Handle WiFi connection management
 *
 * Manages WiFi reconnection, AP mode, and state transitions.
 * Triggers OTA check on WiFi reconnect.
 *
 * @param ctx Loop context with managers
 */
void handleWiFiConnection(LoopContext& ctx);

/**
 * @brief Handle mDNS refresh and maintenance
 *
 * Refreshes mDNS periodically to prevent TTL expiry and restarts
 * if the responder stalls.
 *
 * @param ctx Loop context with managers
 */
void handleMDNS(LoopContext& ctx);

/**
 * @brief Handle NTP time synchronization
 *
 * Syncs time via NTP after WiFi reconnect.
 *
 * @param ctx Loop context with app state
 */
void handleTimeSync(LoopContext& ctx);

/**
 * @brief Process web server requests and OAuth callbacks
 *
 * Handles HTTP requests and completes OAuth flow if callback was received.
 *
 * @param ctx Loop context with managers
 * @return true if loop should return early (e.g., pending reboot)
 */
bool handleWebServer(LoopContext& ctx);

/**
 * @brief Handle Supabase sync and realtime processing
 *
 * Phase A: State sync via Edge Functions
 * Phase B: Realtime WebSocket for instant command delivery
 *
 * @param ctx Loop context with managers
 */
void handleSupabase(LoopContext& ctx);

/**
 * @brief Process xAPI WebSocket events
 *
 * Handles device status updates from RoomOS devices.
 *
 * @param ctx Loop context with managers
 */
void handleXAPIWebSocket(LoopContext& ctx);

/**
 * @brief Handle Webex API fallback polling
 *
 * Polls Webex API when Supabase/embedded app status is unavailable or stale.
 *
 * @param ctx Loop context with managers
 * @return true if loop should return early
 */
bool handleWebexFallbackPolling(LoopContext& ctx);

/**
 * @brief Process MQTT sensor data
 *
 * Handles MQTT connection and sensor data updates.
 *
 * @param ctx Loop context with managers
 */
void handleMQTT(LoopContext& ctx);

/**
 * @brief Attempt Supabase device provisioning
 *
 * Retries provisioning until successful.
 *
 * @param ctx Loop context with managers
 */
void handleSupabaseProvisioning(LoopContext& ctx);

/**
 * @brief Check for OTA updates (hourly)
 *
 * @param ctx Loop context with managers
 */
void handleOTACheck(LoopContext& ctx);

/**
 * @brief Print connection status periodically
 *
 * Logs connection info every 15 seconds for serial monitoring.
 *
 * @param ctx Loop context with managers
 */
void handleConnectionStatusLogging(LoopContext& ctx);

/**
 * @brief Update the LED matrix display
 *
 * @param ctx Loop context with managers
 */
void handleDisplayUpdate(LoopContext& ctx);

/**
 * @brief Execute all loop handlers in correct order
 *
 * This is the main entry point that orchestrates all handlers
 * while preserving the original state machine logic and ordering.
 *
 * @param ctx Loop context with all managers
 */
void executeLoopHandlers(LoopContext& ctx);

/**
 * @brief Check for firmware updates and perform auto-update if enabled
 */
void check_for_updates();

/**
 * @brief Update the LED matrix display
 */
void update_display();

#endif // LOOP_HANDLERS_H
