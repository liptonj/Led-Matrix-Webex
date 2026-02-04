'use client';

import { getSupabaseClient } from '@/lib/supabaseClient';
import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import { useEffect, useState } from 'react';

const OAUTH_CALLBACK_TIMEOUT_MS = 15000;

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing authentication…');

  useEffect(() => {
    async function completeAuth() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');
        const errorDescription = params.get('error_description');

        if (error) {
          throw new Error(errorDescription || error);
        }

        if (!code || !state) {
          throw new Error('Missing authorization response.');
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error('Supabase URL not configured.');
        }

        // POST code and state to Edge Function
        const response = await fetchWithTimeout(
          `${supabaseUrl}/functions/v1/webex-user-callback`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, state }),
          },
          OAUTH_CALLBACK_TIMEOUT_MS
        );

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to complete authentication');
        }

        // Extract token from redirect_url if present
        const redirectUrl = new URL(data.redirect_url, window.location.origin);
        const token = redirectUrl.searchParams.get('token');

        if (token) {
          // Use the token to establish a Supabase session
          const supabase = getSupabaseClient();
          const { error: sessionError } = await supabase.auth.verifyOtp({
            token_hash: token,
            type: 'magiclink',
          });

          if (sessionError) {
            console.error('Failed to establish session:', sessionError);
            throw new Error('Failed to establish session');
          }

          // Remove token from URL before redirecting
          redirectUrl.searchParams.delete('token');
        }

        setStatus('success');
        setMessage('Authentication complete! Redirecting...');

        // Redirect to the appropriate dashboard (admin or user)
        setTimeout(() => {
          window.location.href = redirectUrl.pathname;
        }, 1000);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Authentication failed');
      }
    }

    completeAuth();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <div className="max-w-xl w-full rounded-2xl p-8 shadow-2xl" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', borderWidth: '1px' }}>
        <h1 className="text-2xl font-semibold">
          {status === 'success' ? 'Authentication Complete' : status === 'error' ? 'Authentication Failed' : 'Authenticating…'}
        </h1>
        <p className="mt-3" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
        {status === 'error' && (
          <div className="mt-6">
            <a
              href="/login"
              className="inline-block rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-semibold"
            >
              Back to Login
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
