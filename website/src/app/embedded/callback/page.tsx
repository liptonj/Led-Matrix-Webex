'use client';

import { useEffect, useState } from 'react';

export default function WebexEmbeddedCallbackPage() {
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

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error('Supabase URL not configured.');
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/webex-oauth-callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });

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
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="max-w-xl w-full bg-slate-900/70 border border-slate-700 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold">
          {status === 'success' ? 'Authorization Complete' : status === 'error' ? 'Authorization Failed' : 'Authorizing…'}
        </h1>
        <p className="mt-3 text-slate-300">{message}</p>
        <p className="mt-4 text-xs text-slate-400">You can close this window once finished.</p>
      </div>
    </div>
  );
}
