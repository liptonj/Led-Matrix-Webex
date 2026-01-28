'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getSession, signOut, isSupabaseConfigured, isAdmin, onAuthStateChange, getCurrentUserProfile } from '@/lib/supabase';

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

        async function checkAuth() {
            // Allow login page to render even if Supabase is not configured
            if (isLoginPage) {
                setLoading(false);
                return;
            }

            if (!isSupabaseConfigured()) {
                setError('Supabase is not configured. Admin features are disabled.');
                setLoading(false);
                return;
            }

            try {
                const { data } = await getSession();
                if (data?.session) {
                    setAuthenticated(true);
                    const profile = await getCurrentUserProfile();
                    if (profile?.disabled) {
                        await signOut();
                        setAuthenticated(false);
                        setAdmin(false);
                        setError('This account is disabled. Contact an administrator.');
                        return;
                    }
                    try {
                        const isAdminUser = await isAdmin();
                        setAdmin(isAdminUser);
                    } catch (adminError) {
                        console.error('Admin check failed:', adminError);
                        setAdmin(false);
                    }
                } else {
                    setAuthenticated(false);
                }
            } catch (err) {
                console.error('Auth check failed:', err);
                setAuthenticated(false);
            }
            setLoading(false);
        }

        checkAuth();

        if (isSupabaseConfigured()) {
            onAuthStateChange(async (_event, session) => {
                if (session) {
                    setAuthenticated(true);
                    const profile = await getCurrentUserProfile();
                    if (profile?.disabled) {
                        await signOut();
                        setAuthenticated(false);
                        setAdmin(false);
                        setError('This account is disabled. Contact an administrator.');
                        return;
                    }
                    try {
                        const isAdminUser = await isAdmin();
                        setAdmin(isAdminUser);
                    } catch (adminError) {
                        console.error('Admin check failed:', adminError);
                        setAdmin(false);
                    }
                } else {
                    setAuthenticated(false);
                    setAdmin(false);
                }
            }).then((result) => {
                if (result?.data?.subscription) {
                    subscription = result.data.subscription;
                }
            }).catch((err) => {
                console.error('Failed to set up auth listener:', err);
            });
        }

        return () => {
            if (subscription) {
                subscription.unsubscribe();
            }
        };
    }, [isLoginPage, router]);

    useEffect(() => {
        if (loading || isLoginPage) return;

        if (!authenticated) {
            router.push('/admin/login/');
            return;
        }

        if (admin === false) {
            const adminOnlyRoutes = ['/admin/releases', '/admin/users', '/admin'];
            if (adminOnlyRoutes.some((route) => pathname?.startsWith(route))) {
                router.push('/admin/devices');
            }
        }
    }, [admin, authenticated, loading, isLoginPage, pathname, router]);

    const handleSignOut = async () => {
        await signOut();
        router.push('/admin/login/');
    };

    const navItems = useMemo(() => {
        if (admin === false) {
            return [{ href: '/admin/devices', label: 'Devices' }];
        }

        return [
            { href: '/admin', label: 'Dashboard' },
            { href: '/admin/devices', label: 'Devices' },
            { href: '/admin/releases', label: 'Releases' },
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
