'use client';

import { useMemo, useState } from 'react';

const DEFAULT_REDIRECT = 'https://display.5ls.us/callback';

function getParam(name: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

export default function WebexAuthPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const params = useMemo(() => {
    return {
      pairing_code: getParam('pairing_code'),
      serial: getParam('serial'),
      ts: getParam('ts'),
      sig: getParam('sig'),
      token: getParam('token'),
    };
  }, []);

  const missing = useMemo(() => {
    return ['pairing_code', 'serial', 'ts', 'sig', 'token'].filter((key) => !(params as Record<string, string>)[key]);
  }, [params]);

  const handleAuthorize = async () => {
    setError(null);
    if (missing.length > 0) {
      setError(`Missing required parameters: ${missing.join(', ')}`);
      return;
    }

    setSubmitting(true);
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL not configured.');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/webex-oauth-start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.token}`,
          'X-Device-Serial': params.serial,
          'X-Timestamp': params.ts,
          'X-Signature': params.sig,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to start Webex authorization');
      }

      if (!data?.auth_url) {
        throw new Error('Missing authorization URL');
      }

      window.location.href = data.auth_url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Webex authorization');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="max-w-xl w-full bg-slate-900/70 border border-slate-700 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold">Connect your Webex account</h1>
        <p className="mt-3 text-slate-300">
          This will authorize your display to read your Webex presence and meeting status.
        </p>

        <div className="mt-6 space-y-2 text-sm text-slate-300">
          <div><span className="text-slate-400">Pairing Code:</span> {params.pairing_code || '—'}</div>
          <div><span className="text-slate-400">Serial:</span> {params.serial || '—'}</div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <button
          onClick={handleAuthorize}
          disabled={submitting}
          className="mt-6 w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-3 text-sm font-semibold"
        >
          {submitting ? 'Redirecting…' : 'Authorize with Webex'}
        </button>

        <p className="mt-4 text-xs text-slate-400">
          You will be redirected to Webex to complete authorization.
        </p>
      </div>
    </div>
  );
}
