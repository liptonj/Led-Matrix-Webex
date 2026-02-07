'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { getSession } from '@/lib/supabase/auth';
import { getSupabase } from '@/lib/supabase/core';
import {
  createSupportSession,
  closeSupportSession,
  getUserSession,
  updateSessionDeviceInfo,
  cleanupStaleSessions,
} from '@/lib/supabase/supportSessions';
import type { SupportSession, SupportSessionStatus } from '@/types/support';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseSupportSessionReturn {
  /** Current session object (null if no active session) */
  session: SupportSession | null;
  /** Current session status */
  sessionStatus: SupportSessionStatus | null;
  /** Whether a session is being created */
  isCreating: boolean;
  /** Last error message */
  error: string | null;
  /** Create a new support session for the current user */
  create: () => Promise<SupportSession | null>;
  /** Close the current session with a reason */
  close: (reason: string) => Promise<void>;
  /** Update device info on the session record */
  updateDeviceInfo: (info: { device_serial?: string; device_chip?: string; device_firmware?: string }) => Promise<void>;
  /** Update session from external source (e.g., Realtime update) */
  setSession: (session: SupportSession | null) => void;
}

/**
 * Hook for managing the support session database lifecycle.
 *
 * Handles:
 * - Creating new sessions
 * - Closing sessions
 * - Updating device info on the session record
 * - beforeunload cleanup
 * - Checking for existing open sessions on mount
 * - Stale session cleanup on mount
 */
export function useSupportSession(): UseSupportSessionReturn {
  const [session, setSession] = useState<SupportSession | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<SupportSession | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const sessionStatus = session?.status ?? null;

  // Check for existing open session and cleanup stale sessions on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // Run stale cleanup
        await cleanupStaleSessions().catch(() => {
          // Cleanup failure is non-critical
        });

        // Check for existing open session
        const { data: { session: authSession } } = await getSession();
        if (!authSession || !mounted) return;

        const existing = await getUserSession(authSession.user.id);
        if (existing && mounted) {
          setSession(existing);
        }
      } catch (err) {
        console.error('[useSupportSession] Init error:', err);
      }
    }

    init();
    return () => { mounted = false; };
  }, []);

  // beforeunload cleanup: close session when user navigates away
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (sessionRef.current && sessionRef.current.status !== 'closed') {
        // Use sendBeacon for reliable cleanup on page unload
        // Note: This won't work with Supabase client, so we'll use
        // the session as orphaned and let stale cleanup handle it.
        // The session close is best-effort here.
        closeSupportSession(sessionRef.current.id, 'page_unload').catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Subscribe to realtime changes on the current session record.
  // This lets the user side detect when the admin joins (status → active)
  // or ends the session (status → closed) without polling.
  useEffect(() => {
    if (!session?.id) return;

    let channel: RealtimeChannel | null = null;
    let mounted = true;

    async function subscribe() {
      const supabase = await getSupabase();
      const sessionId = session!.id;

      channel = supabase
        .channel(`user-session-${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'display',
            table: 'support_sessions',
            filter: `id=eq.${sessionId}`,
          },
          (payload) => {
            if (!mounted) return;
            const updated = payload.new as SupportSession;
            if (updated) {
              setSession(updated);
            }
          },
        )
        .subscribe();
    }

    subscribe();

    return () => {
      mounted = false;
      if (channel) {
        getSupabase().then((supabase) => {
          if (channel) supabase.removeChannel(channel);
        });
      }
    };
  // Only re-subscribe when session ID changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const create = useCallback(async (): Promise<SupportSession | null> => {
    try {
      setIsCreating(true);
      setError(null);

      const { data: { session: authSession } } = await getSession();
      if (!authSession) {
        setError('You must be logged in to create a support session.');
        return null;
      }

      const newSession = await createSupportSession(authSession.user.id);
      setSession(newSession);
      return newSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create support session';
      setError(message);
      console.error('[useSupportSession] Create error:', err);
      return null;
    } finally {
      setIsCreating(false);
    }
  }, []);

  const close = useCallback(async (reason: string): Promise<void> => {
    if (!sessionRef.current) return;

    try {
      await closeSupportSession(sessionRef.current.id, reason);
      setSession((prev) =>
        prev ? { ...prev, status: 'closed', closed_at: new Date().toISOString(), close_reason: reason } : null,
      );
    } catch (err) {
      console.error('[useSupportSession] Close error:', err);
      setError(err instanceof Error ? err.message : 'Failed to close session');
    }
  }, []);

  const updateDeviceInfo = useCallback(async (info: {
    device_serial?: string;
    device_chip?: string;
    device_firmware?: string;
  }): Promise<void> => {
    if (!sessionRef.current) return;

    try {
      await updateSessionDeviceInfo(sessionRef.current.id, info);
      setSession((prev) => (prev ? { ...prev, ...info } : null));
    } catch (err) {
      console.error('[useSupportSession] Update device info error:', err);
    }
  }, []);

  return {
    session,
    sessionStatus,
    isCreating,
    error,
    create,
    close,
    updateDeviceInfo,
    setSession,
  };
}
