'use client';

import { Header } from '@/components/layout';
import { getSupabase } from '@/lib/supabase';
import { signIn, signOut } from '@/lib/supabase/auth';
import { getCurrentUserProfile } from '@/lib/supabase/users';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type AuthMode = 'webex' | 'email';

export default function LoginPage() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode>('webex');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await signIn(email, password);
      
      if (result.error) {
        throw new Error(result.error.message || 'Login failed');
      }

      if (!result.data.session) {
        throw new Error('No session created');
      }

      // Check user profile and role
      try {
        const profile = await getCurrentUserProfile();
        
        if (profile?.disabled) {
          await signOut();
          setError('This account is disabled. Contact an administrator.');
          setLoading(false);
          return;
        }

        // Check JWT claims for admin status
        const user = result.data.session.user;
        const isAdmin = user?.app_metadata?.is_admin === true;

        // Redirect based on role
        if (isAdmin) {
          router.push('/admin');
        } else {
          router.push('/user');
        }
        router.refresh();
      } catch (profileErr) {
        // If profile check fails, fall back to JWT claims
        const user = result.data.session.user;
        
        if (user?.app_metadata?.disabled === true) {
          await signOut();
          setError('This account is disabled. Contact an administrator.');
          setLoading(false);
          return;
        }

        // Redirect based on JWT claims
        const isAdmin = user?.app_metadata?.is_admin === true;
        router.push(isAdmin ? '/admin' : '/user');
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  };

  const handleWebexLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = await getSupabase();
      const { data, error: invokeError } = await supabase.functions.invoke('webex-user-login', {
        body: {}
      });

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to start login');
      }

      if (!data?.auth_url) {
        throw new Error('Invalid response from login service');
      }

      // Redirect to Webex OAuth
      // The callback will automatically redirect to /admin or /user based on role
      window.location.href = data.auth_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-200px)] bg-[var(--color-bg)] flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text)]">
                Sign In
              </h1>
              <p className="text-[var(--color-text-muted)] mt-2">
                Access your LED display dashboard
              </p>
            </div>

            {/* Tabbed Interface */}
            <div className="mb-6 border-b border-[var(--color-border)]">
              <nav className="flex -mb-px">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('webex');
                    setError(null);
                  }}
                  className={`flex-1 py-2 px-4 text-sm font-medium border-b-2 transition-colors ${
                    authMode === 'webex'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border)]'
                  }`}
                >
                  Webex OAuth
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('email');
                    setError(null);
                  }}
                  className={`flex-1 py-2 px-4 text-sm font-medium border-b-2 transition-colors ${
                    authMode === 'email'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border)]'
                  }`}
                >
                  Email & Password
                </button>
              </nav>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {authMode === 'webex' ? (
              <button
                onClick={handleWebexLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
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
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 21.6c-5.302 0-9.6-4.298-9.6-9.6S6.698 2.4 12 2.4s9.6 4.298 9.6 9.6-4.298 9.6-9.6 9.6z"/>
                    </svg>
                    Sign in with Webex
                  </>
                )}
              </button>
            ) : (
              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="Enter your password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Signing in...
                    </span>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </form>
            )}

            <div className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
              <p>Sign in with either method.</p>
              <p className="mt-1">You'll be redirected based on your role.</p>
            </div>

            <div className="mt-4 text-center">
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
