'use client';

/**
 * useDeviceCommands hook - handles command sending/acking and Edge Function calls.
 * 
 * This hook is standalone and receives all dependencies via options parameter.
 */

import { getSession } from '@/lib/supabase/auth';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback } from 'react';

import { CONFIG } from '../constants';

const API_TIMEOUT_MS = 15000;

export interface UseDeviceCommandsOptions {
  deviceUuid: string | null;
  supabaseRef: React.MutableRefObject<SupabaseClient | null>;
  addLog: (message: string) => void;
}

export interface CommandResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface InsertCommandResult {
  success: boolean;
  command_id?: string;
  error?: string;
}

export interface UseDeviceCommandsReturn {
  sendCommand: (command: string, payload?: Record<string, unknown>) => Promise<CommandResponse>;
  updateAppStateViaEdge: (stateData: {
    webex_status?: string;
    camera_on?: boolean;
    mic_muted?: boolean;
    in_call?: boolean;
    display_name?: string;
  }) => Promise<boolean>;
  insertCommandViaEdge: (
    command: string,
    payload?: Record<string, unknown>
  ) => Promise<InsertCommandResult>;
}

export function useDeviceCommands(options: UseDeviceCommandsOptions): UseDeviceCommandsReturn {
  const { deviceUuid, addLog } = options;

  // Update app state via Edge Function (more secure than direct DB update)
  const updateAppStateViaEdge = useCallback(async (stateData: {
    webex_status?: string;
    camera_on?: boolean;
    mic_muted?: boolean;
    in_call?: boolean;
    display_name?: string;
  }): Promise<boolean> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return false;
    }

    try {
      // Get user session token
      const sessionResult = await getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) {
        addLog('update-app-state failed: Not authenticated');
        return false;
      }

      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/update-app-state`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(stateData),
        },
        API_TIMEOUT_MS
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        addLog(`update-app-state failed: ${error.error || response.status}`);
        return false;
      }

      return true;
    } catch (err) {
      addLog(`update-app-state error: ${err instanceof Error ? err.message : 'unknown error'}`);
      return false;
    }
  }, [addLog]);

  // Insert command via Edge Function (more secure than direct DB insert)
  const insertCommandViaEdge = useCallback(async (
    command: string,
    payload: Record<string, unknown> = {}
  ): Promise<InsertCommandResult> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return { success: false, error: 'Supabase URL not configured' };
    }

    if (!deviceUuid) {
      return { success: false, error: 'Device UUID is required' };
    }

    try {
      // Get user session token
      const sessionResult = await getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      const requestBody: Record<string, unknown> = { 
        command, 
        payload,
        device_uuid: deviceUuid,
      };

      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/insert-command`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
        },
        API_TIMEOUT_MS
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return { success: false, error: error.error || 'Command insert failed' };
      }

      const result = await response.json();
      return { success: true, command_id: result.command_id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }, [deviceUuid]);

  // Send command and wait for acknowledgment
  const sendCommand = useCallback(async (
    command: string,
    payload: Record<string, unknown> = {}
  ): Promise<CommandResponse> => {
    if (!deviceUuid) {
      throw new Error('Device UUID is required');
    }

    // Use user session Supabase client for all operations
    const supabase = getSupabaseClient();
    let commandId: string;

    // Insert command via Edge Function (for validation, logging, and broadcast)
    const result = await insertCommandViaEdge(command, payload);
    if (!result.success || !result.command_id) {
      throw new Error(result.error || 'Failed to queue command');
    }
    commandId = result.command_id;

    // Subscribe to command updates
    return await new Promise<CommandResponse>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Command "${command}" timed out`)), CONFIG.commandTimeoutMs);

      const channel = supabase
        .channel(`cmd:${commandId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'display', table: 'commands', filter: `id=eq.${commandId}` },
          (evt) => {
            const row = (evt as { new: Record<string, unknown> }).new;
            if (row?.status === 'acked') {
              clearTimeout(timeout);
              supabase.removeChannel(channel);
              resolve({ success: true, data: (row.response as Record<string, unknown>) || undefined });
            } else if (row?.status === 'failed' || row?.status === 'expired') {
              clearTimeout(timeout);
              supabase.removeChannel(channel);
              resolve({ success: false, error: String(row.error || `Command ${row.status}`) });
            }
          },
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            clearTimeout(timeout);
            supabase.removeChannel(channel);
            reject(new Error('Failed to subscribe to command updates'));
          }
        });
    });
  }, [addLog, deviceUuid, insertCommandViaEdge]);

  return {
    sendCommand,
    updateAppStateViaEdge,
    insertCommandViaEdge,
  };
}
