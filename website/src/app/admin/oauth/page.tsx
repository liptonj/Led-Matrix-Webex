'use client';

import { useEffect, useMemo, useState } from 'react';
import { getOAuthClients, upsertOAuthClient, OAuthClient } from '@/lib/supabase';

const DEFAULT_REDIRECT = 'https://display.5ls.us/callback';

export default function AdminOAuthPage() {
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [provider, setProvider] = useState('webex');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(DEFAULT_REDIRECT);
  const [active, setActive] = useState(true);

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => a.provider.localeCompare(b.provider));
  }, [clients]);

  useEffect(() => {
    async function load() {
      try {
        const data = await getOAuthClients();
        setClients(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load OAuth clients');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!provider.trim() || !clientId.trim()) {
      setFormError('Provider and Client ID are required.');
      return;
    }

    if (!redirectUri.trim()) {
      setFormError('Redirect URI is required.');
      return;
    }

    setSaving(true);
    try {
      const saved = await upsertOAuthClient({
        provider: provider.trim().toLowerCase(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
        redirectUri: redirectUri.trim(),
        active,
      });

      setClients((prev) => {
        const idx = prev.findIndex((c) => c.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], ...saved };
          return copy;
        }
        return [...prev, saved];
      });

      setClientSecret('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save OAuth client');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">OAuth Providers</h1>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add / Update Provider</h2>
        <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Provider</label>
            <input
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="webex"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Client ID</label>
            <input
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Your OAuth client ID"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Client Secret</label>
            <input
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Enter to set / rotate secret"
              type="password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Redirect URI</label>
            <input
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder={DEFAULT_REDIRECT}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="oauth-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="oauth-active" className="text-sm text-gray-700 dark:text-gray-300">
              Active
            </label>
          </div>
          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Provider'}
            </button>
          </div>
          {formError && (
            <div className="md:col-span-2 text-sm text-red-600 dark:text-red-400">{formError}</div>
          )}
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Configured Providers</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Client ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Redirect URI
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Active
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {sortedClients.length === 0 ? (
                <tr>
                  <td className="px-6 py-4 text-center text-gray-500 dark:text-gray-400" colSpan={4}>
                    No OAuth providers configured yet.
                  </td>
                </tr>
              ) : (
                sortedClients.map((client) => (
                  <tr key={client.id}>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-200">{client.provider}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{client.client_id}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{client.redirect_uri}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={client.active ? 'text-green-600' : 'text-gray-400'}>
                        {client.active ? 'Yes' : 'No'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
