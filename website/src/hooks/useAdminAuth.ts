import {
    getSession,
    isAdmin,
    onAuthStateChange,
    signOut,
} from '@/lib/supabase/auth';
import { getCachedSession, isSupabaseConfigured } from '@/lib/supabase/core';
import { checkSupabaseHealth } from '@/lib/supabase/health';
import { getCurrentUserProfile } from '@/lib/supabase/users';
import { useEffect, useState } from 'react';

export interface UseAdminAuthReturn {
  loading: boolean;
  authenticated: boolean;
  admin: boolean | null;
  error: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hook for managing admin authentication state with retry logic and health checks.
 * Handles complex authentication flow including:
 * - Supabase health checking
 * - Session validation with retry
 * - Admin permission verification
 * - Profile checks for disabled users
 * - Auth state change subscriptions
 * 
 * @returns Object with loading, authenticated, admin, and error states
 * 
 * @example
 * ```typescript
 * const { loading, authenticated, admin, error } = useAdminAuth();
 * 
 * if (loading) return <Spinner />;
 * if (error) return <Error message={error} />;
 * if (!authenticated) return <Login />;
 * if (admin === false) return <Unauthorized />;
 * ```
 */
export function useAdminAuth(): UseAdminAuthReturn {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    let initialAuthCheckComplete = false;
    let hydrationRunId = 0;
    const abortController = new AbortController();

    async function hydrateAdminState(hasSession: boolean) {
      if (abortController.signal.aborted) {
        return;
      }
      
      const runId = ++hydrationRunId;
      finished = true;
      
      if (!hasSession) {
        setAuthenticated(false);
        setAdmin(false);
        setError(null);
        setLoading(false);
        return;
      }

      setAuthenticated(true);
      setError(null);
      setLoading(false);
      setAdmin(null);

      const [profileResult, adminResult] = await Promise.allSettled([
        getCurrentUserProfile(abortController.signal, { skipRemote: true }),
        isAdmin(abortController.signal),
      ]);

      if (abortController.signal.aborted || runId !== hydrationRunId) {
        return;
      }

      const isTimeout = (err: unknown) =>
        err instanceof Error && err.message.toLowerCase().includes('timed out');

      if (profileResult.status === 'fulfilled') {
        if (profileResult.value?.disabled) {
          await signOut();
          setAuthenticated(false);
          setAdmin(false);
          setError('This account is disabled. Contact an administrator.');
          return;
        }
      } else {
        // Handle AbortError gracefully
        const reason = profileResult.reason;
        if (reason instanceof Error && (reason.name === 'AbortError' || reason.message.includes('aborted'))) {
          return;
        }
        if (!isTimeout(reason)) {
          setAuthenticated(false);
          setAdmin(false);
          setError('Failed to load your profile.');
          return;
        }
        // If timeout, continue with cached session
      }

      if (adminResult.status === 'fulfilled') {
        setAdmin(adminResult.value);
      } else {
        if (isTimeout(adminResult.reason)) {
          setAdmin(null);
        } else {
          setAdmin(false);
        }
      }
    }

    async function checkAuth() {
      if (!isSupabaseConfigured()) {
        finished = true;
        setError('Supabase is not configured. Admin features are disabled.');
        setLoading(false);
        return;
      }

      try {
        // Quick health check
        const health = await checkSupabaseHealth();

        if (!health.healthy) {
          finished = true;
          setError(`Cannot connect to Supabase: ${health.error || 'Unknown error'}`);
          setLoading(false);
          return;
        }

        // Check for pending login
        const hasPendingLogin = typeof window !== 'undefined' &&
          window.sessionStorage.getItem('admin_login_in_progress') === '1';

        if (hasPendingLogin) {
          window.sessionStorage.removeItem('admin_login_in_progress');
          await sleep(300);
        }

        const cachedSession = getCachedSession();
        const usedCachedSession = Boolean(cachedSession);
        if (usedCachedSession && !abortController.signal.aborted) {
          void hydrateAdminState(true);
        }

        if (abortController.signal.aborted) {
          return;
        }

        let sessionData = await getSession(abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        // Single retry if no session found
        if (!sessionData?.data?.session && !abortController.signal.aborted) {
          await sleep(500);
          if (abortController.signal.aborted) {
            return;
          }
          sessionData = await getSession(abortController.signal);
          if (abortController.signal.aborted) {
            return;
          }
        }

        const hasSession = Boolean(sessionData?.data?.session);
        if (!usedCachedSession || !hasSession) {
          await hydrateAdminState(hasSession);
        }
        initialAuthCheckComplete = true;
      } catch (err) {
        // Handle AbortError gracefully
        if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
          return;
        }
        setAuthenticated(false);
        setAdmin(false);
        setError('Auth check failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
        setLoading(false);
        initialAuthCheckComplete = true;
      }
    }

    timeoutId = setTimeout(() => {
      if (!finished) {
        setError('Auth check timed out. Please refresh or check your network.');
        setLoading(false);
      }
    }, 20000);

    checkAuth();

    if (isSupabaseConfigured()) {
      onAuthStateChange(async (_event, session) => {
        if (!initialAuthCheckComplete && _event === 'INITIAL_SESSION') {
          return;
        }
        await hydrateAdminState(Boolean(session));
      }).then((result) => {
        if (result?.data?.subscription) {
          subscription = result.data.subscription;
        }
      }).catch(() => {
        // Auth listener setup failed - will retry on next auth state change
      });
    }

    return () => {
      abortController.abort();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, []);

  return {
    loading,
    authenticated,
    admin,
    error,
  };
}
