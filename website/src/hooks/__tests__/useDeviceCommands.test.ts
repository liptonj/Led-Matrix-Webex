import * as pairingsModule from '@/lib/supabase/pairings';
import type { Command } from '@/lib/supabase/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDeviceCommands } from '../useDeviceCommands';

jest.mock('@/lib/supabase/pairings');

const mockGetCommandsPage = pairingsModule.getCommandsPage as jest.MockedFunction<
  typeof pairingsModule.getCommandsPage
>;
const mockSubscribeToCommands = pairingsModule.subscribeToCommands as jest.MockedFunction<
  typeof pairingsModule.subscribeToCommands
>;

const createMockCommand = (id: string, status: Command['status']): Command => ({
  id,
  device_uuid: '550e8400-e29b-41d4-a716-446655440000',
  command: 'reboot',
  payload: {},
  status,
  created_at: new Date().toISOString(),
  acked_at: status === 'acked' ? new Date().toISOString() : null,
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  response: null,
  error: null,
});

describe('useDeviceCommands', () => {
  let mockUnsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUnsubscribe = jest.fn();
  });

  it('should initialize with empty commands and connecting status', () => {
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 0 });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: '550e8400-e29b-41d4-a716-446655440000' })
    );

    expect(result.current.commands).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('connecting');
  });

  it('should fetch commands on mount', async () => {
    const mockCommands = [
      createMockCommand('cmd-1', 'pending'),
      createMockCommand('cmd-2', 'acked'),
    ];
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';

    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockResolvedValue({ data: mockCommands, count: 2 });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(mockGetCommandsPage).toHaveBeenCalledWith(deviceUuid, {
        status: 'pending',
        page: 1,
        pageSize: 10,
      });
    });

    await waitFor(() => {
      expect(result.current.commands).toEqual(mockCommands);
      expect(result.current.commandCount).toBe(2);
    });
  });

  it('should subscribe to command updates', async () => {
    let onUpdate: ((update: Partial<Command>) => void) | undefined;
    
    mockSubscribeToCommands.mockImplementation(
      async (_code, updateCb) => {
        onUpdate = updateCb;
        return mockUnsubscribe;
      }
    );
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 0 });

    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    renderHook(() => useDeviceCommands({ pairingCode: deviceUuid }));

    await waitFor(() => {
      expect(mockSubscribeToCommands).toHaveBeenCalledWith(
        deviceUuid,
        expect.any(Function),
        expect.any(Function),
        expect.any(Function)
      );
    });

    mockGetCommandsPage.mockClear();

    act(() => {
      onUpdate?.({ id: 'cmd-1', status: 'acked' });
    });

    // Should trigger refetch
    await waitFor(() => {
      expect(mockGetCommandsPage).toHaveBeenCalled();
    });
  });

  it('should handle pagination', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 25 });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid, pageSize: 10 })
    );

    await waitFor(() => {
      expect(result.current.commandTotalPages).toBe(3);
    });

    act(() => {
      result.current.setCommandPage(2);
    });

    await waitFor(() => {
      expect(mockGetCommandsPage).toHaveBeenCalledWith(deviceUuid, {
        status: 'pending',
        page: 2,
        pageSize: 10,
      });
    });

    expect(result.current.commandPage).toBe(2);
  });

  it('should auto-correct page if it exceeds total pages', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 5 });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid, pageSize: 10 })
    );

    await waitFor(() => {
      expect(result.current.commandTotalPages).toBe(1);
    });

    act(() => {
      result.current.setCommandPage(5);
    });

    await waitFor(() => {
      expect(result.current.commandPage).toBe(1);
    });
  });

  it('should reset page when filter changes', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    // Mock enough items to support multiple pages
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 30 });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(mockGetCommandsPage).toHaveBeenCalled();
    });

    // Set page to 3 (valid because we have 30 items / 10 per page = 3 pages)
    act(() => {
      result.current.setCommandPage(3);
    });

    // Wait for state to update
    await waitFor(() => {
      expect(result.current.commandPage).toBe(3);
    });

    // Change filter - should reset page to 1
    act(() => {
      result.current.setCommandFilter('acked');
    });

    // Filter change should reset page to 1
    await waitFor(() => {
      expect(result.current.commandPage).toBe(1);
    });
  });

  it('should filter commands by status', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    const pendingCommands = [createMockCommand('cmd-1', 'pending')];
    const ackedCommands = [createMockCommand('cmd-2', 'acked')];

    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage
      .mockResolvedValueOnce({ data: pendingCommands, count: 1 })
      .mockResolvedValueOnce({ data: ackedCommands, count: 1 });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(result.current.commands).toEqual(pendingCommands);
    });

    act(() => {
      result.current.setCommandFilter('acked');
    });

    await waitFor(() => {
      expect(result.current.commands).toEqual(ackedCommands);
    });

    expect(mockGetCommandsPage).toHaveBeenLastCalledWith(deviceUuid, {
      status: 'acked',
      page: 1,
      pageSize: 10,
    });
  });

  it('should handle fetch error', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });
  });

  it('should handle non-Error exceptions', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockRejectedValue('String error');

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load commands.');
    });
  });

  it('should handle null pairing code', () => {
    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: null })
    );

    expect(result.current.commands).toEqual([]);
    expect(result.current.commandCount).toBe(0);
    expect(result.current.status).toBe('disconnected');
    expect(mockGetCommandsPage).not.toHaveBeenCalled();
  });

  it('should update subscription status', async () => {
    let onStatusChange: ((subscribed: boolean) => void) | undefined;
    
    mockSubscribeToCommands.mockImplementation(
      async (_code, _update, statusCb) => {
        onStatusChange = statusCb;
        return mockUnsubscribe;
      }
    );
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 0 });

    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(mockSubscribeToCommands).toHaveBeenCalled();
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

  it('should handle subscription error', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    let onError: (() => void) | undefined;
    
    mockSubscribeToCommands.mockImplementation(
      async (_code, _update, _status, errorCb) => {
        onError = errorCb;
        return mockUnsubscribe;
      }
    );
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 0 });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(mockSubscribeToCommands).toHaveBeenCalled();
    });

    act(() => {
      onError?.();
    });

    expect(result.current.status).toBe('error');
  });

  it('should unsubscribe on unmount', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 0 });

    const { unmount } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(mockSubscribeToCommands).toHaveBeenCalled();
    });

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should calculate safe page correctly', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockResolvedValue({ data: [], count: 25 });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid, pageSize: 10 })
    );

    await waitFor(() => {
      expect(result.current.commandTotalPages).toBe(3);
    });

    act(() => {
      result.current.setCommandPage(5);
    });

    // commandPageSafe should be clamped to total pages
    expect(result.current.commandPageSafe).toBe(3);
  });

  it('should handle null count from API', async () => {
    const deviceUuid = '550e8400-e29b-41d4-a716-446655440000';
    mockSubscribeToCommands.mockResolvedValue(mockUnsubscribe);
    mockGetCommandsPage.mockResolvedValue({ 
      data: [createMockCommand('cmd-1', 'pending')], 
      count: null 
    });

    const { result } = renderHook(() => 
      useDeviceCommands({ pairingCode: deviceUuid })
    );

    await waitFor(() => {
      expect(result.current.commandCount).toBe(1); // Falls back to data.length
    });
  });
});
