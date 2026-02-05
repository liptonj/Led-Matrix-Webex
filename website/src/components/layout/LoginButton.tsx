'use client';

import { getCachedSession, getSession, isSupabaseConfigured, onAuthStateChange } from '@/lib/supabase';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export function LoginButton() {
  const supabaseConfigured = isSupabaseConfigured();
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    loadingTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setUser(null);
        setLoading(false);
      }
    }, 8000);

    async function checkAuth() {
      if (!supabaseConfigured) {
        if (mountedRef.current) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      const cached = getCachedSession();
      if (cached && mountedRef.current) {
        if (cached.user?.email) {
          setUser({ email: cached.user.email });
        } else {
          setUser(null);
        }
        setLoading(false);
      }

      try {
        const { data } = await getSession();
        if (mountedRef.current) {
          if (data?.session?.user) {
            setUser({ email: data.session.user.email || undefined });
          } else {
            setUser(null);
          }
        }
      } catch (err) {
        // Handle AbortError gracefully (component unmounted or request cancelled)
        if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
          if (mountedRef.current) {
            setUser(null);
          }
          return;
        }
        if (mountedRef.current) {
          setUser(null);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }
      }
    }

    checkAuth();

    // Listen for auth state changes
    let subscription: { unsubscribe: () => void } | null = null;
    
    if (supabaseConfigured) {
      onAuthStateChange(async () => {
        await checkAuth();
      }).then((result) => {
        if (result?.data?.subscription) {
          subscription = result.data.subscription;
        }
      }).catch(() => {
        // Auth listener setup failed - will use cached state
      });
    }

    return () => {
      mountedRef.current = false;
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [supabaseConfigured]);

  // Return null if loading or if user is logged in
  if (loading || user) {
    return null;
  }

  return (
    <Link
      href="/login"
      className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
    >
      Sign In
    </Link>
  );
}
