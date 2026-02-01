'use client';

import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import { useEffect, useState } from 'react';

const OAUTH_CALLBACK_TIMEOUT_MS = 15000;

export default function WebexCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing Webex authorization…');

  useEffect(() => {
    async function finish() {
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

        // Validate state parameter - decode and verify structure
        try {
          const stateDecoded = atob(state.replace(/-/g, '+').replace(/_/g, '/'));
          const stateObj = JSON.parse(stateDecoded);
          
          // Verify required state fields
          if (!stateObj.token || !stateObj.ts) {
            throw new Error('Invalid state parameter structure');
          }

          // Verify timestamp is recent (within 10 minutes)
          const stateTimestamp = parseInt(stateObj.ts, 10);
          const now = Math.floor(Date.now() / 1000);
          if (isNaN(stateTimestamp) || Math.abs(now - stateTimestamp) > 600) {
            throw new Error('State parameter expired or invalid');
          }
        } catch {
          throw new Error('Invalid or expired authorization state. Please try again.');
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error('Supabase URL not configured.');
        }

        const response = await fetchWithTimeout(
          `${supabaseUrl}/functions/v1/webex-oauth-callback`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, state }),
          },
          OAUTH_CALLBACK_TIMEOUT_MS
        );

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to complete authorization');
        }

        setStatus('success');
        setMessage('Webex authorization complete. You can return to your display.');
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Authorization failed');
      }
    }

    finish();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <div className="max-w-xl w-full rounded-2xl p-8 shadow-2xl" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', borderWidth: '1px' }}>
        <h1 className="text-2xl font-semibold">
          {status === 'success' ? 'Authorization Complete' : status === 'error' ? 'Authorization Failed' : 'Authorizing…'}
        </h1>
        <p className="mt-3" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
        <p className="mt-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>You can close this window once finished.</p>
      </div>
    </div>
  );
}
