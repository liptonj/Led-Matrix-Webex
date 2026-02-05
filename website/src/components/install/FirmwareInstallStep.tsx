'use client';

import { Alert, Button } from '@/components/ui';
import { useEspWebTools } from '@/hooks/useEspWebTools';
import {
    SUPPORTED_BROWSERS,
    TYPICAL_FLASH_DURATION_MAX_SECONDS,
    TYPICAL_FLASH_DURATION_SECONDS,
    WIFI_AP_NAME,
    WIFI_AP_IP
} from './constants';
import { EspWebInstallButton } from './EspWebInstallButton';

interface FirmwareInstallStepProps {
  flashStatus: { message: string; type: 'info' | 'success' | 'error' } | null;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onContinue: () => void;
}

export function FirmwareInstallStep({
  flashStatus,
  showAdvanced,
  onToggleAdvanced,
  onContinue,
}: FirmwareInstallStepProps) {
  const { configured, manifestUrl, loading, error } = useEspWebTools();

  return (
    <div className="card animate-fade-in">
      <h2 className="text-2xl font-semibold mb-2">Install Firmware</h2>
      <p className="text-[var(--color-text-muted)] mb-6">
        Flash your ESP32-S3 device with the LED Matrix firmware
      </p>

      {/* Configuration Error */}
      {!configured && (
        <Alert variant="danger" className="mb-6">
          <strong>Configuration Required:</strong> Supabase is not configured. 
          Please set the <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> environment variables to enable 
          firmware downloads.
        </Alert>
      )}

      {/* ESP Web Tools Error */}
      {error && (
        <Alert variant="danger" className="mb-6">
          {error}
        </Alert>
      )}

      {/* Info about WiFi setup */}
      {configured && !error && (
        <Alert variant="success" className="mb-6">
          <strong>WiFi Setup Included!</strong> After flashing, you&apos;ll be prompted to configure 
          WiFi directly in the installation dialog. No separate setup required.
        </Alert>
      )}

      {/* WiFi Fallback Instructions */}
      {configured && !error && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
          <h4 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">
            WiFi Not Working or Timed Out?
          </h4>
          <p className="text-sm text-amber-800 dark:text-amber-300 mb-2">
            If WiFi setup didn&apos;t work during installation, don&apos;t worry! You can configure it manually:
          </p>
          <ol className="list-decimal list-inside text-sm text-amber-800 dark:text-amber-300 space-y-1">
            <li>Connect to the device&apos;s WiFi: <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">{WIFI_AP_NAME}</code></li>
            <li>Open <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">{WIFI_AP_IP}</code> in your browser</li>
            <li>Complete WiFi and provisioning setup there</li>
          </ol>
        </div>
      )}

      {/* Install Button */}
      <div className="flex justify-center mb-6">
        {configured && manifestUrl && !loading && !error ? (
          <EspWebInstallButton manifest={manifestUrl}>
            <button 
              slot="activate"
              className="bg-success text-white px-8 py-4 text-lg font-semibold border-none rounded-xl cursor-pointer transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
            >
              Install Firmware
            </button>
          </EspWebInstallButton>
        ) : (
          <button 
            disabled
            className="bg-gray-400 text-white px-8 py-4 text-lg font-semibold border-none rounded-xl cursor-not-allowed opacity-50"
          >
            {loading ? 'Loading...' : 'Install Firmware (Unavailable)'}
          </button>
        )}
      </div>

      {/* Status */}
      {flashStatus && (
        <Alert 
          variant={flashStatus.type === 'error' ? 'danger' : flashStatus.type === 'success' ? 'success' : 'info'}
          className="mb-4"
        >
          {flashStatus.message}
        </Alert>
      )}

      {/* Browser Support - Compact */}
      <div className="flex items-center justify-center gap-4 text-sm text-[var(--color-text-muted)] mb-6">
        {Object.entries(SUPPORTED_BROWSERS).map(([key, { name, supported }]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={supported ? 'text-green-600' : 'text-red-500'}>
              {supported ? '✓' : '✗'}
            </span>
            {name}
          </span>
        ))}
      </div>

      {/* Installation Instructions */}
      <div className="border-t border-[var(--color-border)] pt-6">
        <div className="bg-[var(--color-surface-alt)] p-4 rounded-lg mb-4">
          <h3 className="font-semibold mb-2">Installation Steps:</h3>
          <ol className="list-decimal list-inside text-sm text-[var(--color-text-muted)] space-y-1">
            <li>Click &quot;Install Firmware&quot; above</li>
            <li>Select your ESP32-S3 device from the popup</li>
            <li>Wait for the firmware to upload (about {TYPICAL_FLASH_DURATION_SECONDS}-{TYPICAL_FLASH_DURATION_MAX_SECONDS} seconds)</li>
            <li><strong>Configure WiFi</strong> when the dialog prompts you</li>
            <li>Close the dialog and click the button below</li>
          </ol>
        </div>
        
        {/* Prominent Next Step CTA */}
        <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-500 dark:border-green-600 rounded-xl p-6 text-center mt-6">
          <h3 className="text-lg font-bold text-green-900 dark:text-green-100 mb-2">Ready to Continue?</h3>
          <p className="text-sm text-green-800 dark:text-green-300 mb-4">
            Click below after you&apos;ve completed WiFi setup in the installation dialog
          </p>
          <Button 
            variant="success" 
            onClick={onContinue}
            className="text-xl px-10 py-4 font-bold shadow-lg animate-pulse-subtle"
          >
            Continue to Device Approval →
          </Button>
        </div>
      </div>

      {/* Advanced Options */}
      <div className="mt-6">
        <button
          onClick={onToggleAdvanced}
          className="text-sm text-primary hover:underline mb-2 cursor-pointer bg-transparent border-none"
        >
          {showAdvanced ? '▼' : '▶'} Technical Details
        </button>

        {showAdvanced && (
          <div className="bg-[var(--color-surface-alt)] p-4 rounded-lg text-sm">
            <h3 className="font-semibold mb-2">What Gets Installed:</h3>
            <ul className="list-disc list-inside space-y-1 text-[var(--color-text-muted)]">
              <li>ESP32-S3 bootloader</li>
              <li>Partition table</li>
              <li>LED Matrix Webex Display firmware</li>
              <li>Web Serial requires Chrome or Edge browser</li>
              <li>Device will reboot automatically after installation</li>
            </ul>
            <p className="mt-3 text-[var(--color-text-muted)]">
              <strong>For OTA updates:</strong> Once installed, the device can update itself 
              over WiFi from the device&apos;s web interface (no need to reflash via USB).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
