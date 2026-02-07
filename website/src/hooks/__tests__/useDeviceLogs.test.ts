import * as devicesModule from '@/lib/supabase/devices';
import type { DeviceLog } from '@/lib/supabase/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDeviceLogs } from '../useDeviceLogs';

jest.mock('@/lib/supabase/devices');

const mockSubscribeToDeviceLogs = devicesModule.subscribeToDeviceLogs as jest.MockedFunction<
  typeof devicesModule.subscribeToDeviceLogs
>;

const createMockLog = (id: string, level: DeviceLog['level'], message: string): DeviceLog => ({
  id,
  device_id: 'device-1',
  serial_number: 'ABC123',
  level,
  message,
  metadata: {},
  created_at: new Date().toISOString(),
});

describe('useDeviceLogs', () => {
  let mockUnsubscribe: jest.Mock;
  const TEST_USER_UUID = 'test-user-uuid';
  const TEST_DEVICE_UUID = 'device-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockUnsubscribe = jest.fn();
  });

  it('should initialize with empty logs and connecting status', () => {
    mockSubscribeToDeviceLogs.mockResolvedValue(mockUnsubscribe);
    
    const { result } = renderHook(() => 
      useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: TEST_DEVICE_UUID })
    );

    expect(result.current.logs).toEqual([]);
    expect(result.current.filteredLogs).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('connecting');
  });

  it('should subscribe to logs and update status', async () => {
    let onStatusChange: ((subscribed: boolean) => void) | undefined;
    
    mockSubscribeToDeviceLogs.mockImplementation(
      async (_userUuid, _onLog, statusCb) => {
        onStatusChange = statusCb;
        return mockUnsubscribe;
      }
    );

    const { result } = renderHook(() => 
      useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: TEST_DEVICE_UUID })
    );

    await waitFor(() => {
      expect(mockSubscribeToDeviceLogs).toHaveBeenCalledWith(
        TEST_USER_UUID,
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        TEST_DEVICE_UUID
      );
    });

    act(() => {
      onStatusChange?.(true);
    });

    expect(result.current.status).toBe('connected');

    act(() => {
      onStatusChange?.(false);
    });

    expect(result.current.status).toBe('disconnected');
  });

  it('should add logs when received', async () => {
    let onLog: ((log: DeviceLog) => void) | undefined;
    
    mockSubscribeToDeviceLogs.mockImplementation(
      async (_userUuid, logCb) => {
        onLog = logCb;
        return mockUnsubscribe;
      }
    );

    const { result } = renderHook(() => 
      useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: TEST_DEVICE_UUID })
    );

    await waitFor(() => {
      expect(mockSubscribeToDeviceLogs).toHaveBeenCalled();
    });

    const log1 = createMockLog('log-1', 'info', 'Test message 1');
    const log2 = createMockLog('log-2', 'error', 'Test message 2');

    act(() => {
      onLog?.(log1);
    });

    expect(result.current.logs).toHaveLength(1);
    expect(result.current.logs[0]).toEqual(log1);

    act(() => {
      onLog?.(log2);
    });

    expect(result.current.logs).toHaveLength(2);
    expect(result.current.logs[0]).toEqual(log2); // Most recent first
    expect(result.current.logs[1]).toEqual(log1);
  });

  it('should limit logs to specified limit', async () => {
    let onLog: ((log: DeviceLog) => void) | undefined;
    
    mockSubscribeToDeviceLogs.mockImplementation(
      async (_userUuid, logCb) => {
        onLog = logCb;
        return mockUnsubscribe;
      }
    );

    const { result } = renderHook(() => 
      useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: TEST_DEVICE_UUID, logLimit: 3 })
    );

    await waitFor(() => {
      expect(mockSubscribeToDeviceLogs).toHaveBeenCalled();
    });

    // Add 5 logs
    for (let i = 0; i < 5; i++) {
      act(() => {
        onLog?.(createMockLog(`log-${i}`, 'info', `Message ${i}`));
      });
    }

    // Should only keep 3 most recent
    expect(result.current.logs).toHaveLength(3);
    expect(result.current.logs[0].id).toBe('log-4');
    expect(result.current.logs[1].id).toBe('log-3');
    expect(result.current.logs[2].id).toBe('log-2');
  });

  it('should filter logs by level', async () => {
    let onLog: ((log: DeviceLog) => void) | undefined;
    
    mockSubscribeToDeviceLogs.mockImplementation(
      async (_userUuid, logCb) => {
        onLog = logCb;
        return mockUnsubscribe;
      }
    );

    const { result } = renderHook(() => 
      useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: TEST_DEVICE_UUID })
    );

    await waitFor(() => {
      expect(mockSubscribeToDeviceLogs).toHaveBeenCalled();
    });

    act(() => {
      onLog?.(createMockLog('log-1', 'info', 'Info message'));
      onLog?.(createMockLog('log-2', 'error', 'Error message'));
      onLog?.(createMockLog('log-3', 'warn', 'Warn message'));
    });

    expect(result.current.logs).toHaveLength(3);
    expect(result.current.filteredLogs).toHaveLength(3);

    act(() => {
      result.current.setLogFilter('error');
    });

    expect(result.current.filteredLogs).toHaveLength(1);
    expect(result.current.filteredLogs[0].level).toBe('error');

    act(() => {
      result.current.setLogFilter('all');
    });

    expect(result.current.filteredLogs).toHaveLength(3);
  });

  it('should handle subscription error', async () => {
    let onError: ((error: string) => void) | undefined;
    
    mockSubscribeToDeviceLogs.mockImplementation(
      async (_userUuid, _onLog, _statusCb, errorCb) => {
        onError = errorCb;
        return mockUnsubscribe;
      }
    );

    const { result } = renderHook(() => 
      useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: TEST_DEVICE_UUID })
    );

    await waitFor(() => {
      expect(mockSubscribeToDeviceLogs).toHaveBeenCalled();
    });

    act(() => {
      onError?.('Test error');
    });

    expect(result.current.status).toBe('error');
  });

  it('should handle null user uuid', () => {
    const { result } = renderHook(() => 
      useDeviceLogs({ userUuid: null })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBe('disconnected');
    expect(mockSubscribeToDeviceLogs).not.toHaveBeenCalled();
  });

  it('should unsubscribe on unmount', async () => {
    mockSubscribeToDeviceLogs.mockResolvedValue(mockUnsubscribe);

    const { unmount } = renderHook(() => 
      useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: TEST_DEVICE_UUID })
    );

    await waitFor(() => {
      expect(mockSubscribeToDeviceLogs).toHaveBeenCalled();
    });

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should resubscribe when device uuid changes', async () => {
    mockSubscribeToDeviceLogs.mockResolvedValue(mockUnsubscribe);

    const { rerender } = renderHook(
      (props) => useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: props.deviceUuid }),
      { initialProps: { deviceUuid: 'ABC123' as string | null | undefined } }
    );

    await waitFor(() => {
      expect(mockSubscribeToDeviceLogs).toHaveBeenCalledWith(
        TEST_USER_UUID,
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        'ABC123'
      );
    });

    mockSubscribeToDeviceLogs.mockClear();
    mockUnsubscribe.mockClear();

    rerender({ deviceUuid: 'XYZ789' });

    await waitFor(() => {
      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(mockSubscribeToDeviceLogs).toHaveBeenCalledWith(
        TEST_USER_UUID,
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        'XYZ789'
      );
    });
  });

  it('should handle subscription promise rejection', async () => {
    mockSubscribeToDeviceLogs.mockRejectedValue(new Error('Connection failed'));

    const { result } = renderHook(() => 
      useDeviceLogs({ userUuid: TEST_USER_UUID, deviceUuid: TEST_DEVICE_UUID })
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });
});
