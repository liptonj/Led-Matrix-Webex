import { getDevice } from '@/lib/supabase/devices';
import type { Device } from '@/lib/supabase/types';
import { useEffect, useState } from 'react';

export interface UseDeviceDetailsReturn {
  device: Device | null;
  loading: boolean;
  error: string | null;
  setDevice: React.Dispatch<React.SetStateAction<Device | null>>;
}

/**
 * Hook for fetching and managing device details by serial number.
 * Handles loading state and error management for device data.
 * 
 * @param serialNumber - The device serial number to fetch
 * @returns Object with device data, loading/error states, and update function
 * 
 * @example
 * ```typescript
 * const { device, loading, error, setDevice } = useDeviceDetails(serialNumber);
 * 
 * // Update device state directly when needed
 * setDevice({ ...device, debug_enabled: true });
 * ```
 */
export function useDeviceDetails(serialNumber: string | null): UseDeviceDetailsReturn {
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serialNumber) {
      setError('Missing device serial number.');
      setLoading(false);
      return;
    }

    let isMounted = true;

    (async () => {
      try {
        const record = await getDevice(serialNumber);
        if (!isMounted) return;
        
        if (!record) {
          setError('Device not found.');
          setLoading(false);
          return;
        }
        
        setDevice(record);
        setError(null);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load device.');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [serialNumber]);

  return {
    device,
    loading,
    error,
    setDevice,
  };
}
