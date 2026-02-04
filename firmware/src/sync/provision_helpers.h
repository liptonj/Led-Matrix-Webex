/**
 * @file provision_helpers.h
 * @brief Provisioning helper functions for Supabase device provisioning
 *
 * Extracted helper functions from provisionDeviceWithSupabase() to improve
 * code organization and maintainability.
 */

#ifndef PROVISION_HELPERS_H
#define PROVISION_HELPERS_H

#include <Arduino.h>

namespace ProvisionHelpers {
    /**
     * @brief Check if provisioning should be attempted
     * 
     * Validates all guard conditions required before attempting provisioning:
     * - WiFi connected
     * - Supabase initialized
     * - Time synced
     * - Credentials provisioned
     * - Not disabled/blacklisted/deleted
     * - Supabase URL configured
     * 
     * @return true if all conditions are met and provisioning should proceed
     */
    bool shouldAttemptProvision();

    /**
     * @brief Build JSON payload for provisioning request
     * 
     * Creates a JSON payload containing device information:
     * - serial_number
     * - key_hash
     * - firmware_version
     * - ip_address (if WiFi connected)
     * - existing_pairing_code (if exists)
     * 
     * @return String JSON payload ready for HTTP POST
     */
    String buildProvisionPayload();

    /**
     * @brief Display pairing code on LED with timeout tracking
     * 
     * Displays the pairing code on the LED matrix and logs countdown.
     * Tracks a 240-second (4 minute) timeout from start time.
     * 
     * @param pairingCode 6-character pairing code to display
     * @param startTime Millis timestamp when timeout period started
     * @return true if timeout exceeded (240 seconds), false otherwise
     */
    bool displayPairingCodeWithTimeout(const String& pairingCode, unsigned long startTime);

    /**
     * @brief Handle awaiting approval response from provisioning endpoint
     * 
     * Extracts pairing code from response and displays it with timeout.
     * Manages approval pending state and logging.
     * 
     * @param response HTTP response body containing approval status
     * @return 0 to keep trying, 1 if timeout expired
     */
    int handleAwaitingApproval(const String& response);

    /**
     * @brief Reset all static provisioning state variables
     * 
     * Clears all static tracking variables used during provisioning.
     * Should be called when resetting provisioning state or on factory reset.
     */
    void resetProvisionState();
}

#endif // PROVISION_HELPERS_H
