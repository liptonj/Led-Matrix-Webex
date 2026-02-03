/**
 * @file loop_handlers.cpp
 * @brief Main loop orchestrator
 *
 * Orchestrates all loop handlers in the correct execution order.
 * Individual handlers are implemented in domain-specific files.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

// =============================================================================
// MAIN LOOP ORCHESTRATOR
// =============================================================================

void executeLoopHandlers(LoopContext& ctx) {
    static HeapTrendMonitor heap_trend;

    // 1. Heap monitoring (early, to detect issues)
    handleHeapMonitoring(ctx, heap_trend);

    // 2. Serial and Improv WiFi provisioning
    handleSerialAndImprov(ctx);

    // 3. WiFi connection management
    handleWiFiConnection(ctx);

    // 4. mDNS maintenance
    handleMDNS(ctx);

    // 5. NTP time sync
    handleTimeSync(ctx);

    // 6. Web server processing
    if (handleWebServer(ctx)) {
        return;  // Pending reboot
    }

    // 7. Supabase sync and realtime
    handleSupabase(ctx);

    // 8. xAPI WebSocket processing
    handleXAPIWebSocket(ctx);

    // 9. Webex API fallback polling
    if (handleWebexFallbackPolling(ctx)) {
        return;  // Early return from fallback logic
    }

    // 10. MQTT sensor processing
    handleMQTT(ctx);

    // 11. Supabase provisioning
    handleSupabaseProvisioning(ctx);

    // 12. OTA update check
    handleOTACheck(ctx);

    // 13. Connection status logging
    handleConnectionStatusLogging(ctx);

    // 14. Display update (always last)
    handleDisplayUpdate(ctx);

    // Small delay to prevent watchdog issues
    delay(10);
}

#endif // !NATIVE_BUILD
