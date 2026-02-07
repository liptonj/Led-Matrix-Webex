import { subscribeToDeviceLogs } from '@/lib/supabase/devices';
import type { DeviceLog } from '@/lib/supabase/types';
import { useEffect, useMemo, useState } from 'react';

const LOG_LIMIT = 200;

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseDeviceLogsOptions {
  userUuid: string | null;
  deviceUuid?: string | null; // Optional filter for specific device
  logFilter?: 'all' | DeviceLog['level'];
  logLimit?: number;
}

export interface UseDeviceLogsReturn {
  logs: DeviceLog[];
  filteredLogs: DeviceLog[];
  loading: boolean;
  error: string | null;
  status: SubscriptionStatus;
  logFilter: 'all' | DeviceLog['level'];
  setLogFilter: (filter: 'all' | DeviceLog['level']) => void;
}

/**
 * Hook for subscribing to device logs with real-time updates.
 * Handles subscription management, filtering, and log limiting.
 * 
 * BROADCAST-ONLY MODE: No historical logs are loaded from the database.
 * Only real-time streaming logs are displayed.
 * 
 * @param options - Configuration object with userUuid, deviceUuid (optional), logFilter, and logLimit
 * @returns Object with logs, filtered logs, loading/error states, and filter controls
 * 
 * @example
 * ```typescript
 * const { filteredLogs, loading, error, status, logFilter, setLogFilter } = 
 *   useDeviceLogs({ userUuid: 'user-123', deviceUuid: 'device-456', logFilter: 'all' });
 * 
 * // Change filter
 * setLogFilter('error');
 * ```
 */
export function useDeviceLogs(options: UseDeviceLogsOptions): UseDeviceLogsReturn {
  const { userUuid, deviceUuid, logFilter: initialLogFilter = 'all', logLimit = LOG_LIMIT } = options;
  
  const [logs, setLogs] = useState<DeviceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>('connecting');
  const [logFilter, setLogFilter] = useState<'all' | DeviceLog['level']>(initialLogFilter);

  useEffect(() => {
    if (!userUuid) {
      setLoading(false);
      setStatus('disconnected');
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let isMounted = true;

    // BROADCAST-ONLY MODE: Start with empty logs
    setLogs([]);
    setLoading(false);
    setError(null);

    setStatus('connecting');
    subscribeToDeviceLogs(
      userUuid,
      (log) => {
        setLogs((prev) => {
          const next = [log, ...prev];
          return next.slice(0, logLimit);
        });
      },
      (subscribed) => {
        if (isMounted) {
          setStatus(subscribed ? 'connected' : 'disconnected');
        }
      },
      () => {
        if (isMounted) {
          setStatus('error');
        }
      },
      deviceUuid ?? undefined,
    ).then((unsub) => {
      unsubscribe = unsub;
    }).catch(() => {
      if (isMounted) {
        setStatus('error');
      }
    });

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [userUuid, deviceUuid, logLimit]);

  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return logs;
    return logs.filter((log) => log.level === logFilter);
  }, [logs, logFilter]);

  return {
    logs,
    filteredLogs,
    loading,
    error,
    status,
    logFilter,
    setLogFilter,
  };
}
