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
#include "display/matrix_display.h"
#include "../core/dependencies.h"

// Forward declaration
bool provisionDeviceWithSupabase();

// =============================================================================
// SUPABASE HANDLER
// =============================================================================

void handleSupabase(LoopContext& ctx) {
    auto& deps = getDependencies();

    if (deps.display.isOTALocked()) {
        return;
    }
    
    // Phase A: State sync via Edge Functions (replaces bridge for pairing)
    if (ctx.app_state->wifi_connected && deps.supabase.isInitialized()) {
        deps.sync.loop(ctx.current_time);
        deps.command_processor.processPendingAcks();
        deps.command_processor.processPendingActions();
        // Keep remote logger in sync with server-side debug toggle
        deps.remote_logger.setRemoteEnabled(deps.supabase.isRemoteDebugEnabled());
    }

    // Phase B: Realtime WebSocket for instant command delivery
    // Handle realtime resubscribe request
    if (ctx.app_state->supabase_realtime_resubscribe) {
        ctx.app_state->supabase_realtime_resubscribe = false;
        deps.realtime_manager.reconnect();
    }

    // Realtime connection management and event processing
    deps.realtime_manager.loop(ctx.current_time);
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
