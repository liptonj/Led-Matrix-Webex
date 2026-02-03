/**
 * @file loop_supabase.cpp
 * @brief Supabase service handlers
 *
 * Handles Supabase sync, realtime processing, and device provisioning.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include "sync/sync_manager.h"
#include "realtime/realtime_manager.h"
#include "commands/command_processor.h"
#include "supabase/supabase_client.h"
#include "debug/remote_logger.h"

// External global instances from main.cpp
extern SyncManager syncManager;
extern RealtimeManager realtimeManager;
extern CommandProcessor commandProcessor;
extern RemoteLogger remoteLogger;
extern SupabaseClient supabaseClient;

// Forward declaration
bool provisionDeviceWithSupabase();

// =============================================================================
// SUPABASE HANDLER
// =============================================================================

void handleSupabase(LoopContext& ctx) {
    // Phase A: State sync via Edge Functions (replaces bridge for pairing)
    if (ctx.app_state->wifi_connected && supabaseClient.isInitialized()) {
        syncManager.loop(ctx.current_time);
        realtimeManager.loop(ctx.current_time);
        commandProcessor.processPendingAcks();
        commandProcessor.processPendingActions();
        // Keep remote logger in sync with server-side debug toggle
        remoteLogger.setRemoteEnabled(supabaseClient.isRemoteDebugEnabled());
    }

    // Phase B: Realtime WebSocket for instant command delivery
    // Handle realtime resubscribe request
    if (ctx.app_state->supabase_realtime_resubscribe) {
        ctx.app_state->supabase_realtime_resubscribe = false;
        realtimeManager.reconnect();
    }

    // Realtime connection management and event processing
    realtimeManager.loop(ctx.current_time);
}

// =============================================================================
// SUPABASE PROVISIONING HANDLER
// =============================================================================

void handleSupabaseProvisioning(LoopContext& ctx) {
    // Attempt Supabase provisioning (retry until successful)
    if (ctx.app_state->wifi_connected) {
        provisionDeviceWithSupabase();
    }
}

#endif // !NATIVE_BUILD
