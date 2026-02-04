/**
 * Auto-approve device using pairing code.
 */

import { getSession } from '@/lib/supabase/auth';

interface AutoApproveResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Approve a device using its pairing code.
 * 
 * @param pairingCode - 6-character pairing code
 * @returns Result object with success status and message
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

    // Call approve-device API
    const response = await fetch(`${supabaseUrl}/functions/v1/approve-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        pairing_code: normalizedCode,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: 'Approval failed',
        error: data.error || `HTTP ${response.status}: Failed to approve device`,
      };
    }

    return {
      success: true,
      message: data.message || 'Device approved successfully!',
    };
  } catch (error) {
    return {
      success: false,
      message: 'Network error',
      error: error instanceof Error ? error.message : 'Failed to approve device',
    };
  }
}
