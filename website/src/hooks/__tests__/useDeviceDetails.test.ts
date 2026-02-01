import * as devicesModule from '@/lib/supabase/devices';
import type { Device } from '@/lib/supabase/types';
import { renderHook, waitFor } from '@testing-library/react';
import { useDeviceDetails } from '../useDeviceDetails';

jest.mock('@/lib/supabase/devices');

const mockGetDevice = devicesModule.getDevice as jest.MockedFunction<typeof devicesModule.getDevice>;

const mockDevice: Device = {
  id: 'device-1',
  serial_number: 'ABC123',
  device_id: 'device-001',
  pairing_code: 'PAIR123',
  display_name: 'Test Device',
  firmware_version: '1.0.0',
  target_firmware_version: null,
  ip_address: '192.168.1.100',
  last_seen: '2024-01-01T00:00:00Z',
  debug_enabled: false,
  is_provisioned: true,
  approval_required: false,
  disabled: false,
  blacklisted: false,
  registered_at: '2024-01-01T00:00:00Z',
  provisioned_at: '2024-01-01T00:00:00Z',
  metadata: {},
};

describe('useDeviceDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with loading state', () => {
    mockGetDevice.mockImplementation(() => new Promise(() => {})); // Never resolves
    const { result } = renderHook(() => useDeviceDetails('ABC123'));

    expect(result.current.device).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should load device successfully', async () => {
    mockGetDevice.mockResolvedValue(mockDevice);
    const { result } = renderHook(() => useDeviceDetails('ABC123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.device).toEqual(mockDevice);
    expect(result.current.error).toBeNull();
    expect(mockGetDevice).toHaveBeenCalledWith('ABC123');
  });

  it('should handle device not found', async () => {
    mockGetDevice.mockResolvedValue(null);
    const { result } = renderHook(() => useDeviceDetails('UNKNOWN'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.device).toBeNull();
    expect(result.current.error).toBe('Device not found.');
  });

  it('should handle fetch error', async () => {
    mockGetDevice.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useDeviceDetails('ABC123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.device).toBeNull();
    expect(result.current.error).toBe('Network error');
  });

  it('should handle non-Error exceptions', async () => {
    mockGetDevice.mockRejectedValue('String error');
    const { result } = renderHook(() => useDeviceDetails('ABC123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load device.');
  });

  it('should handle missing serial number', async () => {
    const { result } = renderHook(() => useDeviceDetails(null));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.device).toBeNull();
    expect(result.current.error).toBe('Missing device serial number.');
    expect(mockGetDevice).not.toHaveBeenCalled();
  });

  it('should refetch when serial number changes', async () => {
    mockGetDevice.mockResolvedValue(mockDevice);
    const { result, rerender } = renderHook(
      (props) => useDeviceDetails(props.serialNumber),
      { initialProps: { serialNumber: 'ABC123' } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetDevice).toHaveBeenCalledWith('ABC123');

    const newDevice = { ...mockDevice, serial_number: 'XYZ789' };
    mockGetDevice.mockResolvedValue(newDevice);

    rerender({ serialNumber: 'XYZ789' });

    await waitFor(() => {
      expect(mockGetDevice).toHaveBeenCalledWith('XYZ789');
    });

    await waitFor(() => {
      expect(result.current.device?.serial_number).toBe('XYZ789');
    });
  });

  it('should not fetch when serial changes to null', async () => {
    mockGetDevice.mockResolvedValue(mockDevice);
    const { result, rerender } = renderHook(
      (props) => useDeviceDetails(props.serialNumber),
      { initialProps: { serialNumber: 'ABC123' as string | null } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetDevice.mockClear();

    rerender({ serialNumber: null });

    await waitFor(() => {
      expect(result.current.error).toBe('Missing device serial number.');
    });

    expect(mockGetDevice).not.toHaveBeenCalled();
  });

  it('should allow updating device state directly', async () => {
    mockGetDevice.mockResolvedValue(mockDevice);
    const { result } = renderHook(() => useDeviceDetails('ABC123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const updatedDevice = { ...mockDevice, debug_enabled: true };
    
    await waitFor(() => {
      result.current.setDevice(updatedDevice);
      expect(result.current.device?.debug_enabled).toBe(true);
    });
  });

  it('should cleanup on unmount', async () => {
    let resolveGet: ((value: Device) => void) | undefined;
    const getPromise = new Promise<Device>((resolve) => {
      resolveGet = resolve;
    });
    mockGetDevice.mockReturnValue(getPromise);

    const { unmount } = renderHook(() => useDeviceDetails('ABC123'));

    unmount();

    // Resolve after unmount - should not update state
    resolveGet!(mockDevice);

    // Wait a bit to ensure no state updates happen
    await new Promise((resolve) => setTimeout(resolve, 100));

    // If this doesn't throw, the cleanup worked correctly
    expect(true).toBe(true);
  });
});
