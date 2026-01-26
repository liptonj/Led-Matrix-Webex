'use client';

import { Button, Alert } from '@/components/ui';
import { EspWebInstallButton } from './EspWebInstallButton';

interface FirmwareInstallStepProps {
  installType: 'fresh' | 'update';
  onInstallTypeChange: (type: 'fresh' | 'update') => void;
  flashStatus: { message: string; type: 'info' | 'success' | 'error' } | null;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onContinue: () => void;
}

const MANIFEST_FRESH = '/updates/manifest-firmware-esp32s3.json';
const MANIFEST_UPDATE = '/updates/manifest-firmware-update.json';

export function FirmwareInstallStep({
  installType,
  onInstallTypeChange,
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

      {/* Install Type Selection */}
      <div className="grid gap-3 mb-6">
        <label 
          className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
            installType === 'fresh' 
              ? 'border-primary bg-[var(--color-surface-alt)]' 
              : 'border-[var(--color-border)] hover:border-primary/50'
          }`}
        >
          <input
            type="radio"
            name="installType"
            value="fresh"
            checked={installType === 'fresh'}
            onChange={(e) => onInstallTypeChange(e.target.value as 'fresh' | 'update')}
            className="mr-2"
          />
          <span className="font-medium">Fresh Install</span>
          <p className="text-sm text-[var(--color-text-muted)] ml-6">
            Install complete firmware on a new device (includes bootloader)
          </p>
        </label>

        <label 
          className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
            installType === 'update' 
              ? 'border-primary bg-[var(--color-surface-alt)]' 
              : 'border-[var(--color-border)] hover:border-primary/50'
          }`}
        >
          <input
            type="radio"
            name="installType"
            value="update"
            checked={installType === 'update'}
            onChange={(e) => onInstallTypeChange(e.target.value as 'fresh' | 'update')}
            className="mr-2"
          />
          <span className="font-medium">Firmware Update</span>
          <p className="text-sm text-[var(--color-text-muted)] ml-6">
            Update firmware only (for devices with existing bootloader)
          </p>
        </label>
      </div>

      {/* Install Button */}
      <div className="flex justify-center mb-6">
        <EspWebInstallButton 
          manifest={installType === 'fresh' ? MANIFEST_FRESH : MANIFEST_UPDATE}
        >
          <button 
            slot="activate"
            className="bg-success text-white px-8 py-4 text-lg font-semibold border-none rounded-xl cursor-pointer transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
          >
            {installType === 'fresh' ? 'Install Firmware' : 'Update Firmware'}
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
            <li>Click &quot;{installType === 'fresh' ? 'Install' : 'Update'} Firmware&quot; above</li>
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
          {showAdvanced ? '▼' : '▶'} Advanced Options
        </button>

        {showAdvanced && (
          <div className="bg-[var(--color-surface-alt)] p-4 rounded-lg text-sm">
            <h3 className="font-semibold mb-2">Installation Details:</h3>
            <ul className="list-disc list-inside space-y-1 text-[var(--color-text-muted)]">
              <li>Fresh Install: Includes bootloader, partition table, and firmware</li>
              <li>Firmware Update: Application firmware only</li>
              <li>Web Serial requires Chrome or Edge browser</li>
              <li>Device will reboot automatically after installation</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
