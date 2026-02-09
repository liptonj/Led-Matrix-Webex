'use client';

import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import { useEffect, useMemo, useState } from 'react';

const API_TIMEOUT_MS = 15000;

interface AuthParams {
  nonce: string;
  serial: string;
}

const EMPTY_PARAMS: AuthParams = {
  nonce: '',
  serial: '',
};

export default function WebexAuthPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [params, setParams] = useState<AuthParams>(EMPTY_PARAMS);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setParams({
      nonce: sp.get('nonce') ?? '',
      serial: sp.get('serial') ?? '',
    });
  }, []);

  const missing = useMemo(() => {
    return (['nonce'] as (keyof AuthParams)[]).filter((key) => !params[key]);
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

      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/webex-oauth-start`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nonce: params.nonce }),
        },
        API_TIMEOUT_MS
      );

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
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <div className="max-w-xl w-full rounded-2xl p-8 shadow-2xl" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', borderWidth: '1px' }}>
        <h1 className="text-2xl font-semibold">Connect your Webex account</h1>
        <p className="mt-3" style={{ color: 'var(--color-text-secondary)' }}>
          This will authorize your display to read your Webex presence and meeting status.
        </p>

        <div className="mt-6 space-y-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <div><span style={{ color: 'var(--color-text-muted)' }}>Serial:</span> {params.serial || '—'}</div>
        </div>

        {error && (
          <div className="alert-error mt-4">
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

        <p className="mt-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          You will be redirected to Webex to complete authorization.
        </p>
      </div>
    </div>
  );
}
