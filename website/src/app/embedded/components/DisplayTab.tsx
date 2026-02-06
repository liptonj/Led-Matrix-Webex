'use client';

/**
 * @deprecated This component will be incorporated into DevicesTab.
 * Do not add new features to this component.
 */

import { Button, Card } from '@/components/ui';
import { memo } from 'react';
import type { DeviceStatus } from '../types';

export interface DisplayTabProps {
  deviceName: string;
  onDeviceNameChange: (value: string) => void;
  manualDisplayName: string;
  onDisplayNameChange: (value: string) => void;
  onDisplayNameBlur: () => void;
  brightness: number;
  onBrightnessChange: (value: number) => void;
  scrollSpeedMs: number;
  onScrollSpeedChange: (value: number) => void;
  pageIntervalMs: number;
  onPageIntervalChange: (value: number) => void;
  displayPages: 'status' | 'sensors' | 'rotate';
  onDisplayPagesChange: (value: 'status' | 'sensors' | 'rotate') => void;
  statusLayout: 'name' | 'sensors';
  onStatusLayoutChange: (value: 'name' | 'sensors') => void;
  dateColor: string;
  onDateColorChange: (value: string) => void;
  timeColor: string;
  onTimeColorChange: (value: string) => void;
  nameColor: string;
  onNameColorChange: (value: string) => void;
  metricColor: string;
  onMetricColorChange: (value: string) => void;
  deviceStatus: DeviceStatus;
  isPeerConnected: boolean;
  isSaving: boolean;
  onSaveSettings: () => void;
  onDisconnect: () => void;
}

export const DisplayTab = memo(function DisplayTab({ deviceName, onDeviceNameChange, manualDisplayName, onDisplayNameChange, onDisplayNameBlur, brightness, onBrightnessChange, scrollSpeedMs, onScrollSpeedChange, pageIntervalMs, onPageIntervalChange, displayPages, onDisplayPagesChange, statusLayout, onStatusLayoutChange, dateColor, onDateColorChange, timeColor, onTimeColorChange, nameColor, onNameColorChange, metricColor, onMetricColorChange, deviceStatus, isPeerConnected, isSaving, onSaveSettings, onDisconnect }: DisplayTabProps) {
  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Display Settings</h2>
      <div className="space-y-4">
        <div><label className="block text-sm font-medium mb-2">Device Name</label><input type="text" placeholder="webex-display" value={deviceName} onChange={(e) => onDeviceNameChange(e.target.value)} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" disabled={!isPeerConnected} /><p className="text-xs text-[var(--color-text-muted)] mt-1">mDNS hostname</p></div>
        <div><label className="block text-sm font-medium mb-2">Your Name</label><input type="text" placeholder="John Doe" value={manualDisplayName} onChange={(e) => onDisplayNameChange(e.target.value)} onBlur={onDisplayNameBlur} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" /><p className="text-xs text-[var(--color-text-muted)] mt-1">Name shown on display</p></div>
        <div><label className="block text-sm font-medium mb-2">Brightness: {brightness}</label><input type="range" min="10" max="255" value={brightness} onChange={(e) => onBrightnessChange(parseInt(e.target.value, 10))} className="w-full" disabled={!isPeerConnected} /><div className="flex justify-between text-xs text-[var(--color-text-muted)]"><span>Dim</span><span>Bright</span></div></div>
        <div><label className="block text-sm font-medium mb-2">Scroll Speed: {scrollSpeedMs}ms</label><input type="range" min="50" max="1000" step="50" value={scrollSpeedMs} onChange={(e) => onScrollSpeedChange(parseInt(e.target.value, 10))} className="w-full" disabled={!isPeerConnected} /></div>
        <div><label className="block text-sm font-medium mb-2">Page Rotation: {pageIntervalMs / 1000}s</label><input type="range" min="2000" max="30000" step="1000" value={pageIntervalMs} onChange={(e) => onPageIntervalChange(parseInt(e.target.value, 10))} className="w-full" disabled={!isPeerConnected} /></div>
        <div><label className="block text-sm font-medium mb-2">Pages to Show</label><select value={displayPages} onChange={(e) => onDisplayPagesChange(e.target.value as 'status' | 'sensors' | 'rotate')} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" disabled={!isPeerConnected}><option value="status">Status only</option><option value="sensors">Sensors only</option><option value="rotate">Rotate status & sensors</option></select></div>
        <div><label className="block text-sm font-medium mb-2">Status Layout</label><select value={statusLayout} onChange={(e) => onStatusLayoutChange(e.target.value as 'name' | 'sensors')} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" disabled={!isPeerConnected}><option value="name">Name large</option><option value="sensors">Sensors large</option></select></div>
        <div><h3 className="text-sm font-semibold mb-3">Text Colors</h3><div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium mb-2">Date</label><div className="flex items-center gap-3"><input type="color" value={dateColor} onChange={(e) => onDateColorChange(e.target.value)} className="h-10 w-16 rounded border border-[var(--color-border)]" disabled={!isPeerConnected} /><span className="text-xs text-[var(--color-text-muted)]">{dateColor.toUpperCase()}</span></div></div><div><label className="block text-sm font-medium mb-2">Time</label><div className="flex items-center gap-3"><input type="color" value={timeColor} onChange={(e) => onTimeColorChange(e.target.value)} className="h-10 w-16 rounded border border-[var(--color-border)]" disabled={!isPeerConnected} /><span className="text-xs text-[var(--color-text-muted)]">{timeColor.toUpperCase()}</span></div></div><div><label className="block text-sm font-medium mb-2">Name</label><div className="flex items-center gap-3"><input type="color" value={nameColor} onChange={(e) => onNameColorChange(e.target.value)} className="h-10 w-16 rounded border border-[var(--color-border)]" disabled={!isPeerConnected} /><span className="text-xs text-[var(--color-text-muted)]">{nameColor.toUpperCase()}</span></div></div><div><label className="block text-sm font-medium mb-2">Metric</label><div className="flex items-center gap-3"><input type="color" value={metricColor} onChange={(e) => onMetricColorChange(e.target.value)} className="h-10 w-16 rounded border border-[var(--color-border)]" disabled={!isPeerConnected} /><span className="text-xs text-[var(--color-text-muted)]">{metricColor.toUpperCase()}</span></div></div></div></div>
        <Button variant="primary" onClick={onSaveSettings} disabled={!isPeerConnected || isSaving} className="mt-6">{isSaving ? 'Saving...' : 'Save Display Settings'}</Button>
      </div>
      <hr className="my-6 border-[var(--color-border)]" />
      <h3 className="font-medium mb-4">Connected Display</h3>
      <div className="grid grid-cols-2 gap-4 text-sm"><div><span className="text-[var(--color-text-muted)]">Serial:</span><span className="ml-2 font-mono">{deviceStatus.serial_number || 'Unknown'}</span></div><div><span className="text-[var(--color-text-muted)]">IP:</span><span className="ml-2">{deviceStatus.ip_address || 'Unknown'}</span></div><div><span className="text-[var(--color-text-muted)]">Firmware:</span><span className="ml-2">{deviceStatus.firmware_version || 'Unknown'}</span></div><div><span className="text-[var(--color-text-muted)]">WiFi:</span><span className="ml-2">{deviceStatus.rssi ? `${deviceStatus.rssi} dBm` : 'Unknown'}</span></div></div>
      <Button variant="warning" className="mt-4" onClick={onDisconnect}>Disconnect Display</Button>
    </Card>
  );
});
