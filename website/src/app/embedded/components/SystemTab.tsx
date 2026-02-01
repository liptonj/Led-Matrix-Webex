'use client';

import { Button, Card } from '@/components/ui';
import { memo } from 'react';
import type { DeviceStatus } from '../types';

export interface SystemTabProps {
  deviceStatus: DeviceStatus;
  appVersion: string;
  isBridgeConnected: boolean;
  isPeerConnected: boolean;
  isRebooting: boolean;
  onReboot: () => void;
}

export const SystemTab = memo(function SystemTab({ deviceStatus, appVersion, isBridgeConnected, isPeerConnected, isRebooting, onReboot }: SystemTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold mb-4">System Information</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-[var(--color-text-muted)]">Serial:</span><span className="ml-2 font-mono">{deviceStatus.serial_number || 'Unknown'}</span></div>
          <div><span className="text-[var(--color-text-muted)]">App Version:</span><span className="ml-2">v{appVersion}</span></div>
          <div><span className="text-[var(--color-text-muted)]">Connection:</span><span className="ml-2">{isBridgeConnected ? 'Connected' : 'Disconnected'}</span></div>
          <div><span className="text-[var(--color-text-muted)]">Display:</span><span className="ml-2">{isPeerConnected ? 'Yes' : 'No'}</span></div>
          <div><span className="text-[var(--color-text-muted)]">Firmware:</span><span className="ml-2">{deviceStatus.firmware_version || 'Unknown'}</span></div>
          <div><span className="text-[var(--color-text-muted)]">Free Memory:</span><span className="ml-2">{deviceStatus.free_heap ? `${Math.round(deviceStatus.free_heap / 1024)} KB` : 'Unknown'}</span></div>
          <div><span className="text-[var(--color-text-muted)]">Uptime:</span><span className="ml-2">{deviceStatus.uptime ? `${Math.floor(deviceStatus.uptime / 3600)}h ${Math.floor((deviceStatus.uptime % 3600) / 60)}m` : 'Unknown'}</span></div>
        </div>
        {deviceStatus.temperature !== undefined && deviceStatus.temperature > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border)]"><h3 className="font-medium mb-2">Sensor Data</h3><div className="grid grid-cols-2 gap-4 text-sm"><div><span className="text-[var(--color-text-muted)]">Temperature:</span><span className="ml-2">{deviceStatus.temperature}°C</span></div>{deviceStatus.humidity !== undefined && deviceStatus.humidity > 0 && <div><span className="text-[var(--color-text-muted)]">Humidity:</span><span className="ml-2">{deviceStatus.humidity}%</span></div>}</div></div>
        )}
      </Card>
      <Card>
        <h2 className="text-lg font-semibold mb-4">Device Actions</h2>
        <p className="text-sm text-[var(--color-text-muted)] mb-4">Restart the display device if it&apos;s not responding.</p>
        <Button variant="warning" onClick={onReboot} disabled={isRebooting || !isPeerConnected}>{isRebooting ? 'Rebooting...' : 'Reboot Device'}</Button>
        {!isPeerConnected && <p className="text-xs text-[var(--color-text-muted)] mt-2">Connect to a display first.</p>}
      </Card>
    </div>
  );
});
