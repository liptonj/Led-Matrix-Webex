'use client';

import { getSession } from '@/lib/supabase/auth';
import { useState } from 'react';

// Note: UserShell is provided by the parent layout.tsx - do NOT wrap again here

export default function ApproveDevicePage() {
  const [pairingCode, setPairingCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const formatPairingCode = (value: string) => {
    // Allow only A-HJ-NP-Z2-9 (no I, O, 0, 1) and convert to uppercase
    const cleaned = value.replace(/[^A-HJ-NP-Z2-9a-hj-np-z]/gi, '').toUpperCase();
    // Limit to 6 characters
    return cleaned.slice(0, 6);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      const { data: { session } } = await getSession();
      
      if (!session) {
        setError('Please log in first');
        setLoading(false);
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        setError('Supabase URL not configured');
        setLoading(false);
        return;
      }

      const response = await fetch(
        `${supabaseUrl}/functions/v1/approve-device`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ 
            pairing_code: pairingCode.toUpperCase() 
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve device');
      }

      setMessage(data.message || 'Device approved successfully!');
      setPairingCode('');

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        window.location.href = '/user';
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve device');
    } finally {
      setLoading(false);
    }
  };

  const isValidPairingCode = pairingCode.length === 6 && /^[A-HJ-NP-Z2-9]{6}$/.test(pairingCode);

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">Approve Device</h1>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <p className="text-gray-600 dark:text-gray-300 mb-6 text-center">
          Enter the 6-character pairing code from your device to approve it.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="pairing-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Pairing Code
            </label>
            <input
              id="pairing-code"
              type="text"
              value={pairingCode}
              onChange={(e) => setPairingCode(formatPairingCode(e.target.value))}
              placeholder="ABC123"
              maxLength={6}
              className="w-full px-4 py-3 text-center text-3xl tracking-widest font-mono border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white uppercase"
              required
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
              {pairingCode.length}/6 characters
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !isValidPairingCode}
            className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Approving...' : 'Approve Device'}
          </button>
        </form>

        {message && (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded text-green-800 dark:text-green-200 text-sm">
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-red-800 dark:text-red-200 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="mt-6 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h2 className="font-semibold text-blue-900 dark:text-blue-200 mb-3">How it works:</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800 dark:text-blue-300">
          <li>Find the pairing code on your device (6 characters, e.g., ABC123)</li>
          <li>Enter it in the field above</li>
          <li>Click &quot;Approve Device&quot; to link it to your account</li>
          <li>The device will appear in your dashboard once approved</li>
        </ol>
      </div>

      <div className="mt-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Where to find the pairing code:</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
          <li>Printed on the device label</li>
          <li>Displayed on the LED matrix during boot</li>
          <li>Shown in device logs or serial output</li>
        </ul>
      </div>
    </div>
  );
}
