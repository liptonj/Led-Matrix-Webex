/**
 * Unit tests for useDeviceCommands hook
 * 
 * Tests command sending, Edge Function calls, and acknowledgment handling.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useDeviceCommands, type UseDeviceCommandsOptions, type CommandResponse } from '../useDeviceCommands';

// Store original env
const originalEnv = process.env;

// Mock getSession
const mockGetSession = jest.fn().mockResolvedValue({
  data: {
    session: {
      access_token: 'test-session-token',
    },
  },
  error: null,
});

jest.mock('@/lib/supabase/auth', () => ({
  getSession: () => mockGetSession(),
}));

// Mock getSupabaseClient - configurable channel mock
let channelUpdateCallback: ((evt: { new: Record<string, unknown> }) => void) | null = null;
let channelSubscribeCallback: ((status: string) => void) | null = null;

const createChannelMock = () => {
  const channelMock: Record<string, jest.Mock> = {};
  channelMock.on = jest.fn((_event: string, _filter: unknown, callback: typeof channelUpdateCallback) => {
    channelUpdateCallback = callback;
    return channelMock;
  });
  channelMock.subscribe = jest.fn((callback?: typeof channelSubscribeCallback) => {
    channelSubscribeCallback = callback || null;
    if (channelSubscribeCallback) channelSubscribeCallback('SUBSCRIBED');
    return channelMock;
  });
  return channelMock;
};

const mockSupabaseClient = {
  schema: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'cmd-uuid-456' }, error: null }),
      insert: jest.fn().mockReturnThis(),
    })),
  })),
  channel: jest.fn(() => createChannelMock()),
  removeChannel: jest.fn(),
};

jest.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => mockSupabaseClient,
}));

// Helper to reset channel callbacks
const resetChannelCallbacks = () => {
  channelUpdateCallback = null;
  channelSubscribeCallback = null;
};

describe('useDeviceCommands hook', () => {
  const mockAddLog = jest.fn();
  const mockSupabaseRef = React.createRef<SupabaseClient | null>() as React.MutableRefObject<SupabaseClient | null>;

  const TEST_DEVICE_UUID = '550e8400-e29b-41d4-a716-446655440000';

  const defaultOptions: UseDeviceCommandsOptions = {
    deviceUuid: TEST_DEVICE_UUID,
    supabaseRef: mockSupabaseRef,
    addLog: mockAddLog,
  };

  beforeEach(() => {
    // Use real timers by default - fake timers conflict with waitFor
    jest.useRealTimers();
    
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_USE_SUPABASE_EDGE_FUNCTIONS: 'true',
    };
    
    jest.clearAllMocks();
    (global.fetch as jest.Mock) = jest.fn();
    
    // Reset getSession mock
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'test-session-token',
        },
      },
      error: null,
    });
    
    // Initialize supabaseRef
    mockSupabaseRef.current = null;
  });

  afterEach(() => {
    jest.clearAllTimers();
    process.env = originalEnv;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('insertCommandViaEdge', () => {
    it('should call insert-command Edge Function with correct payload', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, command_id: 'cmd-uuid-123' }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      let insertResult;
      await act(async () => {
        insertResult = await result.current.insertCommandViaEdge('set_brightness', { value: 200 });
      });

      expect(insertResult).toEqual({ success: true, command_id: 'cmd-uuid-123' });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/insert-command',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Bearer'),
          }),
          body: JSON.stringify({
            command: 'set_brightness',
            payload: { value: 200 },
            device_uuid: TEST_DEVICE_UUID,
          }),
        })
      );
    });

    it('should handle insert-command failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      let insertResult;
      await act(async () => {
        insertResult = await result.current.insertCommandViaEdge('set_brightness', { value: 200 });
      });

      expect(insertResult).toEqual({ success: false, error: 'Rate limit exceeded' });
    });

    it('should handle network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      let insertResult;
      await act(async () => {
        insertResult = await result.current.insertCommandViaEdge('set_brightness', { value: 200 });
      });

      expect(insertResult).toEqual({ success: false, error: 'Network error' });
    });

    it('should return error when not authenticated (no session)', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      let insertResult;
      await act(async () => {
        insertResult = await result.current.insertCommandViaEdge('set_brightness', { value: 200 });
      });

      expect(insertResult).toEqual({ success: false, error: 'Not authenticated' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should use empty object as default payload', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, command_id: 'cmd-uuid-123' }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      await act(async () => {
        await result.current.insertCommandViaEdge('reboot');
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            command: 'reboot',
            payload: {},
            device_uuid: TEST_DEVICE_UUID,
          }),
        })
      );
    });
  });

  describe('sendCommand', () => {
    beforeEach(() => {
      // Reset channel callbacks for each test
      resetChannelCallbacks();
      // Set supabaseRef (though the hook uses getSupabaseClient() internally)
      mockSupabaseRef.current = mockSupabaseClient as unknown as SupabaseClient;
    });

    it('should throw error when deviceUuid is null', async () => {
      const { result } = renderHook(() => useDeviceCommands({
        ...defaultOptions,
        deviceUuid: null,
      }));

      await expect(
        act(async () => {
          await result.current.sendCommand('reboot');
        })
      ).rejects.toThrow('Device UUID is required');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should throw error when insertCommandViaEdge fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Service unavailable' }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      await expect(
        act(async () => {
          await result.current.sendCommand('reboot');
        })
      ).rejects.toThrow('Service unavailable');
    });

    it('should insert command via Edge Function when enabled', async () => {
      const commandId = 'cmd-uuid-123';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, command_id: commandId }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      let sendPromise: Promise<CommandResponse>;
      await act(async () => {
        sendPromise = result.current.sendCommand('set_brightness', { value: 200 });
      });

      // Wait for channel to be set up
      await waitFor(() => {
        expect(channelUpdateCallback).not.toBeNull();
      });

      // Verify fetch was called with correct Edge Function URL and payload
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/insert-command',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Bearer'),
          }),
          body: JSON.stringify({
            command: 'set_brightness',
            payload: { value: 200 },
            device_uuid: TEST_DEVICE_UUID,
          }),
        })
      );

      // Simulate channel update with 'acked' status to resolve the promise
      if (channelUpdateCallback) {
        act(() => {
          channelUpdateCallback({
            new: {
              id: commandId,
              status: 'acked',
              response: { brightness: 200 },
            },
          });
        });
      }

      const response = await sendPromise!;
      expect(response).toEqual({ success: true, data: { brightness: 200 } });
    });

    it('should subscribe to command updates channel', async () => {
      const commandId = 'cmd-uuid-456';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, command_id: commandId }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      let sendPromise: Promise<CommandResponse>;
      await act(async () => {
        sendPromise = result.current.sendCommand('reboot');
      });

      // Wait for channel to be set up
      await waitFor(() => {
        expect(mockSupabaseClient.channel).toHaveBeenCalledWith(`cmd:${commandId}`);
      });

      // Verify channel subscription was set up
      expect(channelUpdateCallback).not.toBeNull();

      // Simulate channel update with 'acked' status to resolve the promise
      if (channelUpdateCallback) {
        act(() => {
          channelUpdateCallback({
            new: {
              id: commandId,
              status: 'acked',
            },
          });
        });
      }

      await sendPromise!;
    });

    it('should handle command failure response', async () => {
      const commandId = 'cmd-uuid-789';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, command_id: commandId }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      let sendPromise: Promise<CommandResponse>;
      await act(async () => {
        sendPromise = result.current.sendCommand('reboot');
      });

      // Wait for channel to be set up
      await waitFor(() => {
        expect(channelUpdateCallback).not.toBeNull();
      });

      // Simulate channel update with 'failed' status
      if (channelUpdateCallback) {
        act(() => {
          channelUpdateCallback({
            new: {
              id: commandId,
              status: 'failed',
              error: 'Device offline',
            },
          });
        });
      }

      const response = await sendPromise!;
      expect(response).toEqual({ success: false, error: 'Device offline' });
    });

    it('should handle command expired status', async () => {
      const commandId = 'cmd-uuid-expired';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, command_id: commandId }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      let sendPromise: Promise<CommandResponse>;
      await act(async () => {
        sendPromise = result.current.sendCommand('reboot');
      });

      // Wait for channel to be set up
      await waitFor(() => {
        expect(channelUpdateCallback).not.toBeNull();
      });

      // Simulate channel update with 'expired' status
      if (channelUpdateCallback) {
        act(() => {
          channelUpdateCallback({
            new: {
              id: commandId,
              status: 'expired',
              error: null,
            },
          });
        });
      }

      const response = await sendPromise!;
      expect(response).toEqual({ success: false, error: 'Command expired' });
    });

    it('should timeout if no ack received within threshold', async () => {
      jest.useFakeTimers();
      
      try {
        const commandId = 'cmd-uuid-timeout';
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, command_id: commandId }),
        });

        const { result } = renderHook(() => useDeviceCommands(defaultOptions));

        // Start the command but don't await yet
        let sendPromise: Promise<CommandResponse>;
        await act(async () => {
          sendPromise = result.current.sendCommand('reboot');
        });

        // Wait for channel to be set up (timeout is set up inside sendCommand)
        await waitFor(() => {
          expect(channelUpdateCallback).not.toBeNull();
        });

        // Advance timers by the timeout threshold (15 seconds)
        act(() => {
          jest.advanceTimersByTime(15000);
        });

        // The promise should reject with timeout error
        await expect(sendPromise!).rejects.toThrow('Command "reboot" timed out');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should throw error when insert-command fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
      });

      const { result } = renderHook(() => useDeviceCommands(defaultOptions));

      await expect(
        act(async () => {
          await result.current.sendCommand('reboot');
        })
      ).rejects.toThrow('Rate limit exceeded');
    });
  });
});
