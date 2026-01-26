'use client';

import { Button, Alert } from '@/components/ui';
import { EspWebInstallButton } from './EspWebInstallButton';

interface FirmwareInstallStepProps {
  installType?: 'fresh' | 'update';  // Kept for backwards compatibility but unused
  onInstallTypeChange?: (type: 'fresh' | 'update') => void;  // Kept for backwards compatibility
  flashStatus: { message: string; type: 'info' | 'success' | 'error' } | null;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onContinue: () => void;
}

// Only use the full firmware manifest (includes bootloader, partitions, and firmware)
const MANIFEST = '/updates/manifest-firmware-esp32s3.json';

export function FirmwareInstallStep({
  flashStatus,
  showAdvanced,
  onToggleAdvanced,
  onContinue,
}: FirmwareInstallStepProps) {
  return (
    <div className="card animate-fade-in">
      <h2 className="text-2xl font-semibold mb-2">Install Firmware</h2>
      <p className="text-[var(--color-text-muted)] mb-6">
        Flash your ESP32-S3 device with the LED Matrix firmware
      </p>

      {/* Info about WiFi setup */}
      <Alert variant="success" className="mb-6">
        <strong>WiFi Setup Included!</strong> After flashing, you&apos;ll be prompted to configure 
        WiFi directly in the installation dialog. No separate setup required.
      </Alert>

      {/* Install Button */}
      <div className="flex justify-center mb-6">
        <EspWebInstallButton manifest={MANIFEST}>
          <button 
            slot="activate"
            className="bg-success text-white px-8 py-4 text-lg font-semibold border-none rounded-xl cursor-pointer transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
          >
            Install Firmware
          </button>
        </EspWebInstallButton>
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
        <span className="flex items-center gap-1">
          <span className="text-green-600">✓</span> Chrome
        </span>
        <span className="flex items-center gap-1">
          <span className="text-green-600">✓</span> Edge
        </span>
        <span className="flex items-center gap-1">
          <span className="text-red-500">✗</span> Firefox
        </span>
        <span className="flex items-center gap-1">
          <span className="text-red-500">✗</span> Safari
        </span>
      </div>

      {/* Installation Instructions */}
      <div className="border-t border-[var(--color-border)] pt-6">
        <div className="bg-[var(--color-surface-alt)] p-4 rounded-lg mb-4">
          <h3 className="font-semibold mb-2">Installation Steps:</h3>
          <ol className="list-decimal list-inside text-sm text-[var(--color-text-muted)] space-y-1">
            <li>Click &quot;Install Firmware&quot; above</li>
            <li>Select your ESP32-S3 device from the popup</li>
            <li>Wait for the firmware to upload (about 30-60 seconds)</li>
            <li><strong>Configure WiFi</strong> when the dialog prompts you</li>
            <li>Close the dialog and click the button below</li>
          </ol>
        </div>
        
        <div className="flex flex-col items-center gap-3">
          <Button 
            variant="success" 
            onClick={onContinue}
            className="text-lg px-8 py-3"
          >
            Installation Complete →
          </Button>
          <p className="text-xs text-[var(--color-text-muted)]">
            Click after you&apos;ve configured WiFi in the installation dialog
          </p>
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
