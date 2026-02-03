/**
 * @file supabase_init.h
 * @brief Supabase initialization and authentication
 *
 * Handles Supabase client initialization, device provisioning,
 * authentication, and initial state posting.
 */

#ifndef SUPABASE_INIT_H
#define SUPABASE_INIT_H

#include <Arduino.h>
#include "config/config_manager.h"
#include "app_state.h"
#include "common/pairing_manager.h"
#include "supabase/supabase_client.h"
#include "loop/loop_handlers.h"

// Forward declarations
bool provisionDeviceWithSupabase();

/**
 * @brief Initialize Supabase client and authenticate
 *
 * This function handles:
 * - Supabase client initialization
 * - Device provisioning (first boot)
 * - Authentication with Supabase
 * - Error handling (approval pending, disabled, blacklisted, deleted)
 * - Initial device state posting
 * - Realtime initialization deferral
 *
 * @param config_manager Config manager instance
 * @param app_state Application state
 * @param pairing_manager Pairing manager instance
 */
void initSupabase(
    ConfigManager& config_manager,
    AppState& app_state,
    PairingManager& pairing_manager
);

#endif // SUPABASE_INIT_H
