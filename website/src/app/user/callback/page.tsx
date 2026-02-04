'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UserCallbackPage() {
  const router = useRouter();
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

        // Validate state parameter
        try {
          const stateDecoded = atob(state.replace(/-/g, '+').replace(/_/g, '/'));
          const stateObj = JSON.parse(stateDecoded);
          
          if (!stateObj.nonce || stateObj.flow !== 'user_login') {
            throw new Error('Invalid state parameter');
          }

          // Verify timestamp if present
          if (stateObj.ts) {
            const stateTimestamp = parseInt(stateObj.ts, 10);
            const now = Math.floor(Date.now() / 1000);
            if (!isNaN(stateTimestamp) && Math.abs(now - stateTimestamp) > 600) {
              throw new Error('State parameter expired');
            }
          }
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message.includes('State parameter')) {
            throw parseErr;
          }
          throw new Error('Invalid or expired authorization state. Please try again.');
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error('Supabase URL not configured');
        }

        const response = await fetch(
          `${supabaseUrl}/functions/v1/webex-user-callback`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, state }),
          }
        );

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to complete authorization');
        }

        setStatus('success');
        setMessage('Webex authorization complete. Redirecting to dashboard...');
        
        // Redirect to user dashboard after a short delay
        setTimeout(() => {
          router.push('/user');
        }, 1500);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Authorization failed');
      }
    }

    finish();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="max-w-xl w-full rounded-2xl p-8 shadow-2xl bg-white border border-gray-200">
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">
          {status === 'success' ? 'Authorization Complete' : status === 'error' ? 'Authorization Failed' : 'Authorizing…'}
        </h1>
        <p className="text-gray-600">{message}</p>
        {status === 'loading' && (
          <div className="mt-4 flex justify-center">
            <div className="animate-spin h-6 w-6 border-3 border-blue-600 border-t-transparent rounded-full" />
          </div>
        )}
      </div>
    </div>
  );
}
