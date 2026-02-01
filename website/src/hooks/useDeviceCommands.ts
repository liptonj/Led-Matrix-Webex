import { getCommandsPage, subscribeToCommands } from '@/lib/supabase/pairings';
import type { Command } from '@/lib/supabase/types';
import { useEffect, useState } from 'react';

const COMMAND_PAGE_SIZE = 10;

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseDeviceCommandsOptions {
  pairingCode: string | null;
  commandFilter?: 'all' | Command['status'];
  pageSize?: number;
}

export interface UseDeviceCommandsReturn {
  commands: Command[];
  loading: boolean;
  error: string | null;
  status: SubscriptionStatus;
  commandFilter: 'all' | Command['status'];
  setCommandFilter: (filter: 'all' | Command['status']) => void;
  commandPage: number;
  setCommandPage: (page: number) => void;
  commandCount: number;
  commandTotalPages: number;
  commandPageSafe: number;
}

/**
 * Hook for fetching and subscribing to device commands with pagination.
 * Handles subscription management, filtering, and pagination logic.
 * 
 * @param options - Configuration object with pairingCode, commandFilter, and pageSize
 * @returns Object with commands, pagination state, loading/error states, and controls
 * 
 * @example
 * ```typescript
 * const { 
 *   commands, 
 *   loading, 
 *   error, 
 *   status,
 *   commandPage,
 *   setCommandPage,
 *   commandTotalPages
 * } = useDeviceCommands({ pairingCode: 'ABC123' });
 * ```
 */
export function useDeviceCommands(options: UseDeviceCommandsOptions): UseDeviceCommandsReturn {
  const { pairingCode, commandFilter: initialFilter = 'pending', pageSize = COMMAND_PAGE_SIZE } = options;
  
  const [commands, setCommands] = useState<Command[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>('connecting');
  const [commandFilter, setCommandFilter] = useState<'all' | Command['status']>(initialFilter);
  const [commandPage, setCommandPage] = useState(1);
  const [commandCount, setCommandCount] = useState(0);
  const [commandRefreshToken, setCommandRefreshToken] = useState(0);

  // Reset page when filter changes
  useEffect(() => {
    setCommandPage(1);
  }, [commandFilter]);

  // Subscribe to command updates
  useEffect(() => {
    if (!pairingCode) {
      setStatus('disconnected');
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let isMounted = true;

    setStatus('connecting');
    subscribeToCommands(
      pairingCode,
      (update) => {
        if (update.id) {
          // Trigger refresh when command is updated
          setCommandRefreshToken((prev) => prev + 1);
        }
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
  }, [pairingCode]);

  // Fetch paginated commands
  useEffect(() => {
    if (!pairingCode) {
      setCommands([]);
      setCommandCount(0);
      return;
    }

    let isMounted = true;
    
    (async () => {
      try {
        const result = await getCommandsPage(pairingCode, {
          status: commandFilter,
          page: commandPage,
          pageSize,
        });
        
        if (!isMounted) return;
        
        setCommands(result.data);
        setCommandCount(result.count ?? result.data.length);
        setError(null);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load commands.');
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [pairingCode, commandFilter, commandPage, pageSize, commandRefreshToken]);

  const commandTotalPages = Math.max(1, Math.ceil(commandCount / pageSize));
  const commandPageSafe = Math.min(commandPage, commandTotalPages);

  // Auto-correct page if it exceeds total pages
  useEffect(() => {
    if (commandPage > commandTotalPages) {
      setCommandPage(commandTotalPages);
    }
  }, [commandPage, commandTotalPages]);

  return {
    commands,
    loading: false, // Loading is handled per-fetch, not as persistent state
    error,
    status,
    commandFilter,
    setCommandFilter,
    commandPage,
    setCommandPage,
    commandCount,
    commandTotalPages,
    commandPageSafe,
  };
}
