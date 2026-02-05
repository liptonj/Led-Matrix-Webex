'use client';

import { Alert, Button, Card } from '@/components/ui';

export interface SetupScreenProps {
  pairingCode: string;
  onPairingCodeChange: (code: string) => void;
  connectionError: string | null;
  onConnect: () => void;
  // New props for user login flow
  onWebexLogin?: () => void;
  isLoggedIn?: boolean;
  userDevices?: Array<{ device_uuid: string; serial_number: string; display_name?: string }>;
  selectedDeviceUuid?: string | null;
  onDeviceSelect?: (deviceUuid: string) => void;
}

export function SetupScreen({ 
  pairingCode, 
  onPairingCodeChange, 
  connectionError, 
  onConnect,
  onWebexLogin,
  isLoggedIn,
  userDevices,
  selectedDeviceUuid,
  onDeviceSelect,
}: SetupScreenProps) {
  return (
    <Card className="mb-6">
      <h2 className="text-lg font-semibold mb-4">Connect to Your Display</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">Connect using Supabase Realtime for status sync and configuration commands.</p>
      
      <div className="space-y-4">
        {/* User login flow */}
        {onWebexLogin && !isLoggedIn && (
          <div className="p-4 bg-[var(--color-surface-alt)] rounded-lg">
            <h3 className="font-medium mb-2">Option 1: Login with Webex</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-3">
              Sign in to access all your registered devices
            </p>
            <Button variant="primary" block onClick={onWebexLogin}>
              Login with Webex
            </Button>
          </div>
        )}

        {/* Device selector for logged in users */}
        {isLoggedIn && userDevices && userDevices.length > 0 && onDeviceSelect && (
          <div>
            <label className="block text-sm font-medium mb-2">Select Your Device</label>
            <select
              value={selectedDeviceUuid || ''}
              onChange={(e) => onDeviceSelect(e.target.value)}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
            >
              <option value="">-- Select a device --</option>
              {userDevices.map((device) => (
                <option key={device.device_uuid} value={device.device_uuid}>
                  {device.display_name || device.serial_number}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Divider if both options available */}
        {onWebexLogin && !isLoggedIn && (
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-[var(--color-border)]"></div>
            <span className="text-sm text-[var(--color-text-muted)]">OR</span>
            <div className="flex-1 border-t border-[var(--color-border)]"></div>
          </div>
        )}

        {/* Pairing code flow */}
        <div className="p-4 bg-[var(--color-surface-alt)] rounded-lg">
          <h3 className="font-medium mb-2">{onWebexLogin ? 'Option 2: Use Pairing Code' : 'Enter Pairing Code'}</h3>
          <div className="space-y-3 mt-3">
            <div>
              <label className="block text-sm font-medium mb-2">Pairing Code</label>
              <input 
                type="text" 
                placeholder="e.g., ABC123" 
                maxLength={6} 
                value={pairingCode} 
                onChange={(e) => onPairingCodeChange(e.target.value.toUpperCase())} 
                className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] uppercase" 
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">6-character code shown on your LED display</p>
            </div>
            {connectionError && <Alert variant="danger">{connectionError}</Alert>}
            <Button variant="primary" block onClick={onConnect}>Connect</Button>
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-[var(--color-surface-alt)] rounded-lg">
        <h3 className="font-medium mb-2">How it works:</h3>
        <ol className="text-sm text-[var(--color-text-muted)] list-decimal list-inside space-y-1">
          <li>Your LED display will show a 6-character pairing code</li>
          <li>Enter the pairing code above or login with Webex to access all devices</li>
          <li>Status and commands are synced via Supabase</li>
        </ol>
      </div>
    </Card>
  );
}
