'use client';

import { useState } from 'react';
import UserShell from '../UserShell';
import { getSupabase } from '@/lib/supabase';
import { getSession } from '@/lib/supabase/auth';

export default function ApproveDevicePage() {
  const [serialNumber, setSerialNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const formatSerialNumber = (value: string) => {
    // Remove all non-hex characters and convert to uppercase
    const cleaned = value.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
    // Limit to 8 characters
    return cleaned.slice(0, 8);
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
            serial_number: serialNumber.toUpperCase() 
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve device');
      }

      setMessage(data.message || 'Device approved successfully!');
      setSerialNumber('');

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

  const isValidSerialNumber = serialNumber.length === 8 && /^[A-F0-9]{8}$/.test(serialNumber);

  return (
    <UserShell>
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Approve Device</h1>

        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-600 mb-6 text-center">
            Enter the 8-character serial number from your device to approve it.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="serial" className="block text-sm font-medium text-gray-700 mb-2">
                Serial Number
              </label>
              <input
                id="serial"
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(formatSerialNumber(e.target.value))}
                placeholder="A1B2C3D4"
                maxLength={8}
                className="w-full px-4 py-3 text-center text-2xl font-mono border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <p className="mt-2 text-xs text-gray-500 text-center">
                {serialNumber.length}/8 characters
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !isValidSerialNumber}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Approving...' : 'Approve Device'}
            </button>
          </form>

          {message && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
              {message}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h2 className="font-semibold text-blue-900 mb-3">How it works:</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
            <li>Find the serial number on your device (8 hex characters, e.g., A1B2C3D4)</li>
            <li>Enter it in the field above</li>
            <li>Click "Approve Device" to link it to your account</li>
            <li>The device will appear in your dashboard once approved</li>
          </ol>
        </div>

        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-2">Where to find the serial number:</h3>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
            <li>Printed on the device label</li>
            <li>Displayed on the LED matrix during boot</li>
            <li>Shown in device logs or serial output</li>
          </ul>
        </div>
      </div>
    </UserShell>
  );
}
