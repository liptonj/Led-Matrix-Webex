/**
 * Provision token management utilities.
 * Handles creation, polling, and cleanup of provision tokens for device auto-provisioning.
 */

import { getSession } from '@/lib/supabase/auth';
import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  getSupabase,
  withTimeout,
} from '@/lib/supabase/core';
import type { Device } from '@/lib/supabase/types';

/**
 * Generate a 32-character crypto-random token.
 * Uses crypto.randomUUID() and removes hyphens to create a 32-character hex string.
 */
function generateProvisionToken(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

/**
 * Create a provision token for the authenticated user.
 * 
 * @returns The generated token string on success, null on failure
 */
export async function createProvisionToken(): Promise<string | null> {
  try {
    // Get authenticated session
    const { data: { session }, error: sessionError } = await getSession();

    if (sessionError || !session?.user?.id) {
      console.error('[createProvisionToken] Not authenticated:', sessionError);
      return null;
    }

    const userId = session.user.id;

    // Generate token
    const token = generateProvisionToken();

    // Insert into database
    const supabase = await getSupabase();
    const { error } = await withTimeout(
      supabase
        .schema('display')
        .from('provision_tokens')
        .insert({
          token,
          user_id: userId,
        }),
      SUPABASE_REQUEST_TIMEOUT_MS,
      'Timed out while creating provision token.',
    );

    if (error) {
      console.error('[createProvisionToken] Database error:', error);
      return null;
    }

    return token;
  } catch (error) {
    console.error('[createProvisionToken] Unexpected error:', error);
    return null;
  }
}

/**
 * Wait for a device to be approved by the specified user.
 * Polls the devices table every 2 seconds until a device with user_approved_by = userId is found,
 * or until the timeout is reached.
 * 
 * @param userId - The user ID to check for approval
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 60000 = 60 seconds)
 * @returns The device data when found, or null on timeout
 */
export async function waitForDeviceApproval(
  userId: string,
  timeoutMs: number = 60_000,
): Promise<Device | null> {
  const startTime = Date.now();
  const pollIntervalMs = 2_000; // Poll every 2 seconds
  const abortController = new AbortController();

  try {
    const supabase = await getSupabase();

    // Poll loop
    while (true) {
      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        console.warn(`[waitForDeviceApproval] Timeout after ${timeoutMs}ms`);
        return null;
      }

      // Check abort signal
      if (abortController.signal.aborted) {
        console.log('[waitForDeviceApproval] Aborted');
        return null;
      }

      // Query for device approved by this user
      const { data, error } = await withTimeout(
        supabase
          .schema('display')
          .from('devices')
          .select('id, serial_number, device_id, pairing_code, display_name, firmware_version, target_firmware_version, ip_address, last_seen, debug_enabled, is_provisioned, approval_required, disabled, blacklisted, registered_at, provisioned_at, metadata, release_channel')
          .eq('user_approved_by', userId)
          .order('registered_at', { ascending: false })
          .limit(1),
        SUPABASE_REQUEST_TIMEOUT_MS,
        'Timed out while checking for device approval.',
        abortController.signal,
      );

      if (error) {
        // Don't log PGRST116 (no rows found) as an error - it's expected
        if (error.code !== 'PGRST116') {
          console.error('[waitForDeviceApproval] Database error:', error);
        }
      } else if (data && data.length > 0) {
        // Found approved device
        return data[0] as Device;
      }

      // Wait before next poll (unless we're about to timeout)
      const remainingTime = timeoutMs - elapsed;
      if (remainingTime <= pollIntervalMs) {
        // Not enough time for another poll, timeout
        return null;
      }

      // Wait for poll interval
      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(() => {
          resolve();
        }, pollIntervalMs);

        // Cancel timeout if aborted
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          resolve();
        }, { once: true });
      });
    }
  } catch (error) {
    // Handle abort errors gracefully
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('[waitForDeviceApproval] Aborted');
      return null;
    }

    console.error('[waitForDeviceApproval] Unexpected error:', error);
    return null;
  } finally {
    // Cleanup: abort any pending operations
    abortController.abort();
  }
}

/**
 * Delete a provision token from the database.
 * Useful for cleanup if a token is no longer needed.
 * 
 * @param token - The token string to delete
 * @returns true on success, false on failure
 */
export async function deleteProvisionToken(token: string): Promise<boolean> {
  try {
    // Get authenticated session
    const { data: { session }, error: sessionError } = await getSession();

    if (sessionError || !session?.user?.id) {
      console.error('[deleteProvisionToken] Not authenticated:', sessionError);
      return false;
    }

    const supabase = await getSupabase();
    const { error } = await withTimeout(
      supabase
        .schema('display')
        .from('provision_tokens')
        .delete()
        .eq('token', token)
        .eq('user_id', session.user.id), // Only allow deleting own tokens
      SUPABASE_REQUEST_TIMEOUT_MS,
      'Timed out while deleting provision token.',
    );

    if (error) {
      console.error('[deleteProvisionToken] Database error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[deleteProvisionToken] Unexpected error:', error);
    return false;
  }
}
