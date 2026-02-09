/**
 * Auto-approve device using pairing code.
 * 
 * Uses a two-step flow:
 * 1. exchange-pairing-code: Convert temporary pairing_code → device_uuid
 * 2. approve-device: Approve the device using device_uuid
 */

import { getSession } from '@/lib/supabase/auth';

interface AutoApproveResult {
  success: boolean;
  message: string;
  error?: string;
  deviceUuid?: string;
}

/**
 * Approve a device using its pairing code.
 * 
 * This function performs a two-step approval:
 * 1. Exchange pairing_code for device_uuid (and clear the pairing code)
 * 2. Approve the device using device_uuid
 * 
 * @param pairingCode - 6-character pairing code
 * @returns Result object with success status, message, and device_uuid
 */
export async function autoApproveDevice(pairingCode: string): Promise<AutoApproveResult> {
  try {
    // Get session for authentication
    const { data: { session }, error: sessionError } = await getSession();

    if (sessionError || !session) {
      return {
        success: false,
        message: 'Not authenticated',
        error: 'Please log in first to approve devices.',
      };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return {
        success: false,
        message: 'Configuration error',
        error: 'Supabase URL not configured.',
      };
    }

    // Normalize pairing code
    const normalizedCode = pairingCode.trim().toUpperCase();

    // Validate format
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalizedCode)) {
      return {
        success: false,
        message: 'Invalid pairing code format',
        error: 'Pairing code must be 6 characters (A-H, J-N, P-Z, 2-9).',
      };
    }

    // Step 1: Exchange pairing code for device_uuid
    const exchangeResponse = await fetch(`${supabaseUrl}/functions/v1/exchange-pairing-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        pairing_code: normalizedCode,
      }),
    });

    const exchangeData = await exchangeResponse.json();

    if (!exchangeResponse.ok) {
      return {
        success: false,
        message: 'Pairing code exchange failed',
        error: exchangeData.error || `HTTP ${exchangeResponse.status}: Failed to exchange pairing code`,
      };
    }

    const deviceUuid = exchangeData.device_uuid;
    if (!deviceUuid) {
      return {
        success: false,
        message: 'Exchange failed',
        error: 'No device UUID returned from exchange',
      };
    }

    // Step 2: Approve device using device_uuid
    const approveResponse = await fetch(`${supabaseUrl}/functions/v1/approve-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        device_uuid: deviceUuid,
      }),
    });

    const approveData = await approveResponse.json();

    if (!approveResponse.ok) {
      return {
        success: false,
        message: 'Approval failed',
        error: approveData.error || `HTTP ${approveResponse.status}: Failed to approve device`,
        deviceUuid, // Return UUID even on approval failure for debugging
      };
    }

    return {
      success: true,
      message: approveData.message || 'Device approved successfully!',
      deviceUuid,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Network error',
      error: error instanceof Error ? error.message : 'Failed to approve device',
    };
  }
}
