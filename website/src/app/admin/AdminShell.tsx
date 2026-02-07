'use client';

import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { getCachedSession, getCurrentUserProfile, getSession, isAdmin, isSupabaseConfigured, onAuthStateChange, signOut } from '@/lib/supabase';
import { checkSupabaseHealth } from '@/lib/supabase/health';
import { getActiveSessions, subscribeToSessionChanges } from '@/lib/supabase/supportSessions';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Hamburger menu icon component
function MenuIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    );
}

// Close icon component
function CloseIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
    );
}

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
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [activeSessionCount, setActiveSessionCount] = useState(0);

    // Close mobile menu when route changes
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [pathname]);

    // Close mobile menu on escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setMobileMenuOpen(false);
            }
        };
        if (mobileMenuOpen) {
            document.addEventListener('keydown', handleEscape);
            // Prevent body scroll when menu is open
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [mobileMenuOpen]);

    const toggleMobileMenu = useCallback(() => {
        setMobileMenuOpen(prev => !prev);
    }, []);

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
                    return; // Don't update state if component unmounted
                }
                if (isTimeout(reason)) {
                    // SECURITY: If we can't verify the profile, deny access
                    // A timeout could indicate database issues, and we should not
                    // allow access if we cannot confirm the user is not disabled
                    await signOut();
                    setAuthenticated(false);
                    setAdmin(false);
                    setError('Unable to verify account status. Please try again.');
                    return;
                } else {
                    await signOut();
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
                    setAdmin(null);
                } else {
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
                // Quick health check to catch connectivity issues early
                const health = await checkSupabaseHealth();

                if (!health.healthy) {
                    finished = true;
                    setError(`Cannot connect to Supabase: ${health.error || 'Unknown error'}`);
                    setLoading(false);
                    return;
                }

                // Check for pending login first to avoid unnecessary retries
                const hasPendingLogin = typeof window !== 'undefined' &&
                    window.sessionStorage.getItem('admin_login_in_progress') === '1';

                if (hasPendingLogin) {
                    window.sessionStorage.removeItem('admin_login_in_progress');
                    // Give a moment for session to be established after login
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

                // Single retry if no session found and we're not already aborted
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
                // Handle AbortError gracefully (component unmounted or request cancelled)
                if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
                    return; // Don't update state if component unmounted
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
    }, [isLoginPage]);

    useEffect(() => {
        if (loading || isLoginPage) return;

        if (!authenticated) {
            router.replace('/login');
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
        router.replace('/login');
    };

    // Fetch active session count for Support badge
    useEffect(() => {
        if (!authenticated || admin === false) {
            return;
        }

        let unsubscribe: (() => void) | null = null;

        async function fetchCount() {
            try {
                const sessions = await getActiveSessions();
                setActiveSessionCount(sessions.length);
            } catch (err) {
                // Silently fail - badge will just show 0
                setActiveSessionCount(0);
            }
        }

        fetchCount();

        subscribeToSessionChanges(
            () => {
                fetchCount();
            },
            undefined,
            () => {
                // Ignore errors for badge count
            },
        ).then((unsub) => {
            unsubscribe = unsub;
        });

        return () => {
            unsubscribe?.();
        };
    }, [authenticated, admin]);

    const navItems = useMemo(() => {
        if (admin === false) {
            return [{ href: '/admin/devices', label: 'Devices' }];
        }

        const items: { href: string; label: string; badge?: string }[] = [
            { href: '/admin', label: 'Dashboard' },
            { href: '/admin/devices', label: 'Devices' },
            { href: '/admin/releases', label: 'Releases' },
            { href: '/admin/oauth', label: 'OAuth' },
            { href: '/admin/users', label: 'Users' },
            { href: '/admin/support', label: 'Support', badge: activeSessionCount > 0 ? activeSessionCount.toString() : undefined },
            { href: '/user', label: 'User Portal', badge: 'Admin' },
        ];

        return items;
    }, [admin, activeSessionCount]);

    // Login page doesn't need the admin layout - render it immediately
    if (isLoginPage) {
        return <>{children}</>;
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Spinner size="lg" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
                <div className="max-w-md w-full">
                    <Alert variant="danger">
                        <h2 className="text-lg font-semibold mb-2">
                            Admin Unavailable
                        </h2>
                        <p>{error}</p>
                        <Link
                            href="/"
                            className="mt-4 inline-block text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            Return to Home
                        </Link>
                    </Alert>
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
            <header className="bg-white dark:bg-gray-800 shadow relative z-40">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <div className="flex items-center space-x-2 lg:space-x-8">
                            {/* Mobile menu button */}
                            <button
                                type="button"
                                className="lg:hidden inline-flex items-center justify-center p-3 -ml-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 touch-manipulation"
                                aria-controls="mobile-menu"
                                aria-expanded={mobileMenuOpen}
                                onClick={toggleMobileMenu}
                            >
                                <span className="sr-only">Open main menu</span>
                                {mobileMenuOpen ? (
                                    <CloseIcon className="block h-6 w-6" />
                                ) : (
                                    <MenuIcon className="block h-6 w-6" />
                                )}
                            </button>
                            <Link
                                href="/admin"
                                className="text-lg lg:text-xl font-bold text-gray-900 dark:text-white"
                            >
                                Admin Dashboard
                            </Link>
                            {/* Desktop navigation */}
                            <nav className="hidden lg:flex space-x-4">
                                {navItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 ${
                                            pathname === item.href || (item.href === '/admin/support' && pathname?.startsWith('/admin/support'))
                                                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200'
                                                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                        }`}
                                    >
                                        {item.label}
                                        {'badge' in item && (
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                item.href === '/admin/support'
                                                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                                    : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                            }`}>
                                                {item.badge}
                                            </span>
                                        )}
                                    </Link>
                                ))}
                            </nav>
                        </div>
                        <div className="hidden lg:flex items-center space-x-4">
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

            {/* Mobile menu overlay */}
            {mobileMenuOpen && (
                <div 
                    className="fixed inset-0 z-30 bg-black/50 lg:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Mobile menu panel */}
            <div
                id="mobile-menu"
                className={`fixed top-0 left-0 z-50 h-full w-72 bg-white dark:bg-gray-800 shadow-lg transform transition-transform duration-300 ease-in-out lg:hidden ${
                    mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
            >
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <span className="text-lg font-semibold text-gray-900 dark:text-white">Admin Menu</span>
                    <button
                        type="button"
                        className="p-3 -mr-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 touch-manipulation"
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        <span className="sr-only">Close menu</span>
                        <CloseIcon className="h-6 w-6" />
                    </button>
                </div>
                <nav className="flex flex-col p-4 space-y-1">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`px-4 py-3 rounded-lg text-base font-medium flex items-center justify-between touch-manipulation active:scale-[0.98] transition-all ${
                                pathname === item.href || (item.href === '/admin/support' && pathname?.startsWith('/admin/support'))
                                    ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-200'
                                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600'
                            }`}
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            <span>{item.label}</span>
                            {'badge' in item && (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                    item.href === '/admin/support'
                                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                        : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                }`}>
                                    {item.badge}
                                </span>
                            )}
                        </Link>
                    ))}
                    <hr className="my-3 border-gray-200 dark:border-gray-700" />
                    <Link
                        href="/"
                        className="px-4 py-3 rounded-lg text-base font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 touch-manipulation active:scale-[0.98] transition-all"
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        Main Site
                    </Link>
                    <button
                        onClick={() => {
                            setMobileMenuOpen(false);
                            handleSignOut();
                        }}
                        className="w-full text-left px-4 py-3 rounded-lg text-base font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 active:bg-red-100 dark:active:bg-red-900/30 touch-manipulation active:scale-[0.98] transition-all"
                    >
                        Sign Out
                    </button>
                </nav>
            </div>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {children}
            </main>
        </div>
    );
}
