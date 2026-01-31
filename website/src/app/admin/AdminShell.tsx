'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getSession, signOut, isSupabaseConfigured, isAdmin, onAuthStateChange, getCurrentUserProfile, getCachedSession } from '@/lib/supabase';
import { checkSupabaseHealth } from '@/lib/supabase/health';

export default function AdminShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const normalizedPathname = pathname && pathname !== '/' && pathname.endsWith('/')
        ? pathname.slice(0, -1)
        : pathname;
    const isLoginPage = normalizedPathname === '/admin/login';
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
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        async function hydrateAdminState(hasSession: boolean) {
            if (abortController.signal.aborted) {
                console.debug('[AdminShell] Hydration skipped (signal aborted)');
                return;
            }
            const runId = ++hydrationRunId;
            finished = true;
            if (!hasSession) {
                console.log('[AdminShell] No session, setting unauthenticated');
                setAuthenticated(false);
                setAdmin(false);
                setError(null);
                setLoading(false);
                return;
            }

            console.log('[AdminShell] Session found, hydrating admin state');
            setAuthenticated(true);
            setError(null);
            setLoading(false);
            setAdmin(null);

            const startTime = Date.now();
            const [profileResult, adminResult] = await Promise.allSettled([
                getCurrentUserProfile(abortController.signal, { skipRemote: true }),
                isAdmin(abortController.signal),
            ]);
            console.log('[AdminShell] Profile and admin checks completed in', Date.now() - startTime, 'ms');

            if (abortController.signal.aborted || runId !== hydrationRunId) {
                console.debug('[AdminShell] Hydration results discarded (stale or aborted)');
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
                    console.debug('Profile check aborted (likely component unmounted)');
                    return; // Don't update state if component unmounted
                }
                if (isTimeout(reason)) {
                    console.warn('Profile check timed out; continuing with cached session.');
                } else {
                    console.error('Profile check failed:', reason);
                    setAuthenticated(false);
                    setAdmin(false);
                    setError('Failed to load your profile.');
                    return;
                }
            }

            if (adminResult.status === 'fulfilled') {
                setAdmin(adminResult.value);
            } else {
                if (isTimeout(adminResult.reason)) {
                    console.warn('Admin check timed out; will retry on auth change.');
                    setAdmin(null);
                } else {
                    console.error('Admin check failed:', adminResult.reason);
                    setAdmin(false);
                }
            }
        }

        async function checkAuth() {
            // Allow login page to render even if Supabase is not configured
            if (isLoginPage) {
                finished = true;
                setLoading(false);
                return;
            }

            if (!isSupabaseConfigured()) {
                finished = true;
                setError('Supabase is not configured. Admin features are disabled.');
                setLoading(false);
                return;
            }

            try {
                console.log('[AdminShell] Starting auth check at', new Date().toISOString());

                // Quick health check to catch connectivity issues early
                console.log('[AdminShell] Performing health check');
                const healthStart = Date.now();
                const health = await checkSupabaseHealth();
                console.log('[AdminShell] Health check completed in', Date.now() - healthStart, 'ms:', health);

                if (!health.healthy) {
                    finished = true;
                    setError(`Cannot connect to Supabase: ${health.error || 'Unknown error'}`);
                    setLoading(false);
                    return;
                }

                if (health.latency && health.latency > 2000) {
                    console.warn('[AdminShell] High latency detected:', health.latency, 'ms');
                }

                // Check for pending login first to avoid unnecessary retries
                const hasPendingLogin = typeof window !== 'undefined' &&
                    window.sessionStorage.getItem('admin_login_in_progress') === '1';

                if (hasPendingLogin) {
                    console.log('[AdminShell] Found pending login flag');
                    window.sessionStorage.removeItem('admin_login_in_progress');
                    // Give a moment for session to be established after login
                    await sleep(300);
                }

                const cachedSession = getCachedSession();
                const usedCachedSession = Boolean(cachedSession);
                if (usedCachedSession && !abortController.signal.aborted) {
                    console.log('[AdminShell] Cached session found, hydrating immediately');
                    void hydrateAdminState(true);
                }

                if (abortController.signal.aborted) {
                    console.debug('[AdminShell] Auth check aborted before session fetch');
                    return;
                }

                console.log('[AdminShell] Calling getSession (attempt 1)');
                const startTime = Date.now();
                let sessionData = await getSession(abortController.signal);
                console.log('[AdminShell] getSession completed in', Date.now() - startTime, 'ms');

                if (abortController.signal.aborted) {
                    console.debug('[AdminShell] Auth check aborted after session fetch');
                    return;
                }

                // Single retry if no session found and we're not already aborted
                if (!sessionData?.data?.session && !abortController.signal.aborted) {
                    console.log('[AdminShell] No session found, retrying after 500ms');
                    await sleep(500);
                    if (abortController.signal.aborted) {
                        console.debug('[AdminShell] Auth check aborted before session retry');
                        return;
                    }
                    const retryStart = Date.now();
                    sessionData = await getSession(abortController.signal);
                    console.log('[AdminShell] getSession retry completed in', Date.now() - retryStart, 'ms');
                    if (abortController.signal.aborted) {
                        console.debug('[AdminShell] Auth check aborted after session retry');
                        return;
                    }
                }

                console.log('[AdminShell] Session check complete, has session:', Boolean(sessionData?.data?.session));
                const hasSession = Boolean(sessionData?.data?.session);
                if (!usedCachedSession || !hasSession) {
                    await hydrateAdminState(hasSession);
                }
                initialAuthCheckComplete = true;
            } catch (err) {
                // Handle AbortError gracefully (component unmounted or request cancelled)
                if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
                    console.debug('Auth check aborted (likely component unmounted)');
                    return; // Don't update state if component unmounted
                }
                console.error('[AdminShell] Auth check failed:', err);
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
                    console.log('[AdminShell] Ignoring initial auth event until check completes');
                    return;
                }
                await hydrateAdminState(Boolean(session));
            }).then((result) => {
                if (result?.data?.subscription) {
                    subscription = result.data.subscription;
                }
            }).catch((err) => {
                console.error('Failed to set up auth listener:', err);
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
    }, [isLoginPage]);

    useEffect(() => {
        if (loading || isLoginPage) return;

        if (!authenticated) {
            router.replace('/admin/login/');
            return;
        }

        if (admin === false) {
            const adminOnlyRoutes = ['/admin/releases', '/admin/users', '/admin'];
            if (adminOnlyRoutes.some((route) => pathname?.startsWith(route))) {
                router.replace('/admin/devices');
            }
        }
    }, [admin, authenticated, loading, isLoginPage, pathname, router]);

    const handleSignOut = async () => {
        await signOut();
        router.replace('/admin/login/');
    };

    const navItems = useMemo(() => {
        if (admin === false) {
            return [{ href: '/admin/devices', label: 'Devices' }];
        }

        return [
            { href: '/admin', label: 'Dashboard' },
            { href: '/admin/devices', label: 'Devices' },
            { href: '/admin/releases', label: 'Releases' },
            { href: '/admin/oauth', label: 'OAuth' },
            { href: '/admin/users', label: 'Users' },
        ];
    }, [admin]);

    // Login page doesn't need the admin layout - render it immediately
    if (isLoginPage) {
        return <>{children}</>;
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md">
                    <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
                        Admin Unavailable
                    </h2>
                    <p className="text-red-600 dark:text-red-300">{error}</p>
                    <Link
                        href="/"
                        className="mt-4 inline-block text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        Return to Home
                    </Link>
                </div>
            </div>
        );
    }

    // Not authenticated - will redirect
    if (!authenticated) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Admin Header */}
            <header className="bg-white dark:bg-gray-800 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <div className="flex items-center space-x-8">
                            <Link
                                href="/admin"
                                className="text-xl font-bold text-gray-900 dark:text-white"
                            >
                                Admin Dashboard
                            </Link>
                            <nav className="hidden md:flex space-x-4">
                                {navItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`px-3 py-2 rounded-md text-sm font-medium ${
                                            pathname === item.href
                                                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200'
                                                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                        }`}
                                    >
                                        {item.label}
                                    </Link>
                                ))}
                            </nav>
                        </div>
                        <div className="flex items-center space-x-4">
                            <Link
                                href="/"
                                className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                            >
                                View Site
                            </Link>
                            <button
                                onClick={handleSignOut}
                                className="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                            >
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {children}
            </main>
        </div>
    );
}
