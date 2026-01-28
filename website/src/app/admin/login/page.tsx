'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn, isSupabaseConfigured, getCurrentUserProfile, signOut } from '@/lib/supabase';
import { Header } from '@/components/layout';

export default function AdminLoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (!isSupabaseConfigured()) {
            setError('Supabase is not configured. Admin login is unavailable.');
            setLoading(false);
            return;
        }

        try {
            const { error: authError } = await signIn(email, password);
            if (authError) {
                setError(authError.message);
            } else {
                const profile = await getCurrentUserProfile();
                if (profile?.disabled) {
                    await signOut();
                    setError('This account is disabled. Contact an administrator.');
                    return;
                }
                router.push('/admin');
            }
        } catch (err) {
            setError('An unexpected error occurred');
            console.error('Login error:', err);
        }

        setLoading(false);
    };

    return (
        <>
            <Header />
            <main className="min-h-[calc(100vh-200px)] bg-[var(--color-bg)] flex items-center justify-center p-4">
                <div className="max-w-md w-full">
                    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-8">
                        <div className="text-center mb-8">
                            <h1 className="text-2xl font-bold text-[var(--color-text)]">
                                Admin Login
                            </h1>
                            <p className="text-[var(--color-text-muted)] mt-2">
                                Sign in to manage devices and releases
                            </p>
                        </div>

                        {error && (
                            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div>
                                <label
                                    htmlFor="email"
                                    className="block text-sm font-medium text-[var(--color-text)]"
                                >
                                    Email
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-[var(--color-border)] rounded-md shadow-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                                    placeholder="admin@example.com"
                                />
                            </div>

                            <div>
                                <label
                                    htmlFor="password"
                                    className="block text-sm font-medium text-[var(--color-text)]"
                                >
                                    Password
                                </label>
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-[var(--color-border)] rounded-md shadow-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                                    placeholder="********"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                            >
                                {loading ? (
                                    <span className="flex items-center">
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Signing in...
                                    </span>
                                ) : (
                                    'Sign In'
                                )}
                            </button>
                        </form>

                        <div className="mt-6 text-center">
                            <Link
                                href="/"
                                className="text-sm text-primary hover:underline"
                            >
                                Return to Home
                            </Link>
                        </div>
                    </div>
                </div>
            </main>
        </>
    );
}
