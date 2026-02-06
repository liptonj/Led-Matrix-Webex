/**
 * Unit tests for useWebexStatus hook with UUID support
 * 
 * Tests UUID-based status broadcasting functionality.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { useWebexStatus, type UseWebexStatusOptions } from '../useWebexStatus';

// UUID test fixtures
const TEST_DEVICE_UUID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_USER_UUID = '550e8400-e29b-41d4-a716-446655440001';

describe('useWebexStatus hook - UUID support', () => {
  const mockAddLog = jest.fn();
  const mockSupabaseRef = { current: null as any };

  const createMockSupabase = () => {
    const mockChannel = {
      subscribe: jest.fn((callback) => {
        callback('SUBSCRIBED');
        return Promise.resolve();
      }),
      send: jest.fn().mockResolvedValue({ error: null }),
    };

    return {
      channel: jest.fn().mockReturnValue(mockChannel),
      removeChannel: jest.fn(),
    };
  };

  const defaultOptions: UseWebexStatusOptions = {
    isPaired: true,
    session: { user: { id: TEST_USER_UUID }, access_token: 'test-access-token' } as any,
    deviceUuid: TEST_DEVICE_UUID,
    supabaseRef: mockSupabaseRef,
    addLog: mockAddLog,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseRef.current = createMockSupabase();
  });

  describe('broadcastStatusUpdate', () => {
    it('should broadcast to user:{userId} channel', async () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      await act(async () => {
        await result.current.broadcastStatusUpdate('active', false, false, false, 'Test User');
      });

      expect(mockSupabaseRef.current.channel).toHaveBeenCalledWith(
        `user:${TEST_USER_UUID}`,
        expect.any(Object)
      );
    });

    it('should broadcast payload includes device_uuid', async () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      await act(async () => {
        await result.current.broadcastStatusUpdate('active');
      });

      const channelCall = mockSupabaseRef.current.channel.mock.results[0].value;
      expect(channelCall.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'broadcast',
          event: 'webex_status',
          payload: expect.objectContaining({
            device_uuid: TEST_DEVICE_UUID,
          }),
        })
      );
    });

    it('should broadcast with all status fields', async () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      await act(async () => {
        await result.current.broadcastStatusUpdate('meeting', true, true, false, 'John Doe');
      });

      const channelCall = mockSupabaseRef.current.channel.mock.results[0].value;
      expect(channelCall.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            device_uuid: TEST_DEVICE_UUID,
            webex_status: 'meeting',
            in_call: true,
            camera_on: true,
            mic_muted: false,
            display_name: 'John Doe',
          }),
        })
      );
    });

    it('should handle missing session gracefully', async () => {
      const options = { ...defaultOptions, session: null };
      const { result } = renderHook(() => useWebexStatus(options));

      await act(async () => {
        await result.current.broadcastStatusUpdate('active');
      });

      expect(mockAddLog).toHaveBeenCalledWith(
        expect.stringContaining('Cannot broadcast status')
      );
      expect(mockSupabaseRef.current.channel).not.toHaveBeenCalled();
    });

    it('should handle missing deviceUuid gracefully', async () => {
      const options = { ...defaultOptions, deviceUuid: null };
      const { result } = renderHook(() => useWebexStatus(options));

      await act(async () => {
        await result.current.broadcastStatusUpdate('active');
      });

      expect(mockAddLog).toHaveBeenCalledWith(
        expect.stringContaining('Cannot broadcast status')
      );
    });
  });
});
