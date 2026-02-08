import { subscribeToDeviceLogs } from '@/lib/supabase/devices';
import type { DeviceLog } from '@/lib/supabase/types';
import { useEffect, useMemo, useState } from 'react';

const LOG_LIMIT = 200;

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseDeviceLogsOptions {
  deviceUuid: string | null; // Required - device UUID
  userUuid?: string | null; // Optional - user UUID (preferred channel, falls back to device channel if null)
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
 * Subscribes to user channel: user:{userUuid} (preferred, where firmware sends logs)
 * Falls back to device channel: device:{deviceUuid} if userUuid unavailable
 * 
 * @param options - Configuration object with deviceUuid (required), userUuid (optional), logFilter, and logLimit
 * @returns Object with logs, filtered logs, loading/error states, and filter controls
 * 
 * @example
 * ```typescript
 * const { filteredLogs, loading, error, status, logFilter, setLogFilter } = 
 *   useDeviceLogs({ deviceUuid: 'device-456', logFilter: 'all' });
 * 
 * // Change filter
 * setLogFilter('error');
 * ```
 */
export function useDeviceLogs(options: UseDeviceLogsOptions): UseDeviceLogsReturn {
  const { deviceUuid, userUuid = null, logFilter: initialLogFilter = 'all', logLimit = LOG_LIMIT } = options;
  
  const [logs, setLogs] = useState<DeviceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>('connecting');
  const [logFilter, setLogFilter] = useState<'all' | DeviceLog['level']>(initialLogFilter);

  useEffect(() => {
    if (!deviceUuid) {
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
      deviceUuid,
      userUuid ?? null,
      (log) => {
        setLogs((prev) => {
          const next = [log, ...prev];
          return next.slice(0, logLimit);
        });
      },
      (subscribed) => {
        if (isMounted) {
          setStatus(subscribed ? 'connected' : 'disconnected');
          if (!subscribed) {
            setError('Disconnected from log stream');
          } else {
            setError(null);
          }
        }
      },
      (errorMessage) => {
        if (isMounted) {
          setStatus('error');
          setError(errorMessage || 'Failed to subscribe to device logs');
        }
      },
    ).then((unsub) => {
      unsubscribe = unsub;
    }).catch((err) => {
      if (isMounted) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to subscribe to device logs');
      }
    });

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [deviceUuid, userUuid, logLimit]);

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
