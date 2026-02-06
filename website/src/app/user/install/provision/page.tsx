'use client';

import { Alert, Button } from '@/components/ui';
import { autoApproveDevice } from '@/lib/device/autoApprove';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useCallback, useState } from 'react';

/**
 * Provision page content component
 * Separated to allow Suspense boundary for useSearchParams
 */
function ProvisionPageContent() {
  const searchParams = useSearchParams();
  const deviceIp = searchParams.get('ip');
  
  // State - Start with 'waiting' since HTTPS->HTTP polling is blocked by browsers
  const [status, setStatus] = useState<'waiting' | 'approving' | 'success' | 'error'>('waiting');
  const [message, setMessage] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [manualCode, setManualCode] = useState('');

  /**
   * Approve device with pairing code
   */
  const approveDevice = useCallback(async (code: string) => {
    setStatus('approving');
    setPairingCode(code);
    setMessage('Approving device...');
    
    const result = await autoApproveDevice(code);
    
    if (result.success) {
      setStatus('success');
      setMessage(result.message);
    } else {
      setStatus('error');
      setMessage(result.error || 'Failed to approve device');
    }
  }, []);

  /**
   * Handle manual code submission
   */
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.length === 6) {
      await approveDevice(manualCode);
    }
  };

  /**
   * Format pairing code input
   */
  const formatPairingCode = (value: string) => {
    return value.replace(/[^A-HJ-NP-Z2-9a-hj-np-z]/gi, '').toUpperCase().slice(0, 6);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
          WiFi Configured Successfully!
        </h1>
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
          <p className="text-sm text-green-900 dark:text-green-200">
            <strong>Step 1 Complete:</strong> Your device is now connected to WiFi
            {deviceIp && <span> at <code className="font-mono bg-green-100 dark:bg-green-800 px-1 rounded">{deviceIp}</code></span>}.
          </p>
        </div>
      </div>

      {/* Status Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
        {/* Waiting for Manual Input */}
        {status === 'waiting' && (
          <div>
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">📱</div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Enter the Pairing Code
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                Look at your device&apos;s LED display for the 6-character code
              </p>
            </div>
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label htmlFor="pairing-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-center">
                  Pairing Code
                </label>
                <input
                  id="pairing-code"
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(formatPairingCode(e.target.value))}
                  placeholder="ABC123"
                  maxLength={6}
                  autoFocus
                  className="w-full px-4 py-4 text-center text-4xl tracking-[0.3em] font-mono border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white uppercase"
                />
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 text-center">
                  {manualCode.length}/6 characters
                </p>
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={manualCode.length !== 6}
                className="w-full py-3 text-lg"
              >
                Approve Device
              </Button>
            </form>
          </div>
        )}

        {/* Approving */}
        {status === 'approving' && (
          <div className="text-center">
            <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Approving Device...
            </h2>
            {pairingCode && (
              <p className="text-gray-600 dark:text-gray-300">
                Using pairing code: <strong className="font-mono">{pairingCode}</strong>
              </p>
            )}
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <div className="text-center">
            <div className="text-6xl mb-4">✓</div>
            <h2 className="text-xl font-semibold text-green-600 dark:text-green-400 mb-2">
              Device Approved!
            </h2>
            <Alert variant="success" className="mb-4">
              {message || 'Your device has been successfully approved and linked to your account.'}
            </Alert>
            <div className="space-y-3">
              <Link href="/user">
                <Button variant="primary" className="w-full">
                  Go to Dashboard
                </Button>
              </Link>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Your device will appear in your dashboard and start syncing your Webex status.
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="text-center">
            <Alert variant="danger" className="mb-4">
              {message || 'Failed to approve device. Please try again.'}
            </Alert>
            <div className="space-y-3">
              <Button
                variant="primary"
                onClick={() => setStatus('waiting')}
                className="w-full"
              >
                Enter Pairing Code Manually
              </Button>
              <Link href="/user/approve-device">
                <Button variant="default" className="w-full">
                  Go to Manual Approval Page
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Help Section */}
      {status === 'waiting' && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-3">
            Where to find the pairing code:
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800 dark:text-blue-300">
            <li>Look at your device&apos;s LED matrix display</li>
            <li>The 6-character code scrolls across the screen</li>
            <li>It uses letters A-Z (except I, O) and numbers 2-9</li>
            <li>The code is displayed for 4 minutes after boot</li>
          </ol>
          
          <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-700">
            <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">
              <strong>Don&apos;t see a code?</strong> The device may still be booting. 
              Wait 30-60 seconds for it to fully start up.
            </p>
            {deviceIp && (
              <p className="text-sm text-blue-700 dark:text-blue-300">
                You can also access the device directly at{' '}
                <a 
                  href={`http://${deviceIp}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline font-mono"
                >
                  http://{deviceIp}
                </a>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Provision page - receives Improv WiFi redirect after successful WiFi configuration
 * 
 * Flow:
 * 1. ESP Web Tools configures WiFi via Improv Serial
 * 2. Device connects to WiFi and starts provisioning
 * 3. Device sends redirect URL to this page (with device IP)
 * 4. User enters the pairing code shown on device's LED display
 * 5. Device is approved and linked to user's account
 * 
 * Note: Direct HTTP polling from this HTTPS page to the device's local IP
 * is blocked by browser mixed content security. User must enter code manually.
 */
export default function ProvisionPage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded mb-6"></div>
        </div>
      </div>
    }>
      <ProvisionPageContent />
    </Suspense>
  );
}
