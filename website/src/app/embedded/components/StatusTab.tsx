'use client';

import { Button, Card } from '@/components/ui';
import type { WebexStatus } from '@/hooks/useWebexSDK';
import { formatStatus } from '@/lib/utils';
import { memo } from 'react';
import { statusButtons } from '../constants';
import type { ActivityLogEntry, DeviceStatus, RealtimeStatus } from '../types';

export interface StatusTabProps {
  displayName: string;
  statusToDisplay: WebexStatus;
  normalizedStatus: WebexStatus;
  statusColor: string;
  webexReady: boolean;
  webexNeedsAuth: boolean;
  cameraOn: boolean;
  micMuted: boolean;
  rtStatus: RealtimeStatus;
  isPeerConnected: boolean;
  isPaired: boolean;
  lastDeviceSeenMs: number | null;
  deviceStatus: DeviceStatus | null;
  activityLog: ActivityLogEntry[];
  onStatusChange: (status: WebexStatus) => void;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onRefreshDisplay: () => void;
  formatRelativeTime: (timestampMs: number | null) => string;
}

// Map status colors to Tailwind classes
const statusColorClasses: Record<string, string> = {
  active: 'bg-status-active',
  meeting: 'bg-status-meeting',
  dnd: 'bg-status-dnd',
  away: 'bg-status-away',
  ooo: 'bg-status-ooo',
  offline: 'bg-status-offline',
};

export const StatusTab = memo(function StatusTab({ displayName, statusToDisplay, normalizedStatus, statusColor, webexReady, webexNeedsAuth, cameraOn, micMuted, rtStatus, isPeerConnected, isPaired, lastDeviceSeenMs, deviceStatus, activityLog, onStatusChange, onToggleCamera, onToggleMic, onRefreshDisplay, formatRelativeTime }: StatusTabProps) {
  const avatarBgClass = statusColorClasses[statusColor] || 'bg-status-offline';
  
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold mb-4">Your Webex Status</h2>
        <div className="flex items-center gap-4 mb-6">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white ${avatarBgClass}`}>{displayName.charAt(0).toUpperCase()}</div>
          <div><div className="font-medium">{displayName}</div><div className="text-[var(--color-text-muted)]">{formatStatus(statusToDisplay)}</div></div>
        </div>
        <h3 className="text-sm font-medium mb-3">Set Your Status</h3>
        <div className="grid grid-cols-4 gap-2">
          {statusButtons.map(({ status, label, className }) => {
            const statusDotClass = statusColorClasses[status] || 'bg-status-offline';
            return (
              <button key={status} onClick={() => onStatusChange(status)} disabled={webexReady} className={`p-3 rounded-lg text-sm font-medium transition-colors ${className} ${normalizedStatus === status ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-card)]' : ''} ${webexReady ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <span className={`w-2 h-2 rounded-full inline-block mr-1 ${statusDotClass}`} />{label}
              </button>
            );
          })}
        </div>
      </Card>
      <Card>
        <h3 className="text-sm font-medium mb-3">Camera & Microphone</h3>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={onToggleCamera} disabled={webexReady} className={`p-4 rounded-lg border transition-colors ${cameraOn ? 'bg-primary/20 border-primary text-primary' : 'bg-[var(--color-surface-alt)] border-[var(--color-border)]'} ${webexReady ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <span className="text-2xl">{cameraOn ? '📹' : '📷'}</span><div className="text-sm mt-1">{cameraOn ? 'Camera On' : 'Camera Off'}</div>
          </button>
          <button onClick={onToggleMic} disabled={webexReady} className={`p-4 rounded-lg border transition-colors ${!micMuted ? 'bg-primary/20 border-primary text-primary' : 'bg-[var(--color-surface-alt)] border-[var(--color-border)]'} ${webexReady ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <span className="text-2xl">{micMuted ? '🔇' : '🎤'}</span><div className="text-sm mt-1">{micMuted ? 'Mic Muted' : 'Mic On'}</div>
          </button>
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-medium">Display Connection</h3><Button size="sm" variant="default" onClick={onRefreshDisplay} disabled={!isPaired}>Refresh</Button></div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-[var(--color-text-muted)]">Realtime</div><div>{rtStatus}</div></div>
          <div><div className="text-[var(--color-text-muted)]">Display connected</div><div>{isPeerConnected ? 'Yes' : 'No'}</div></div>
          <div><div className="text-[var(--color-text-muted)]">Webex</div><div className={webexNeedsAuth ? 'text-yellow-600' : 'text-green-600'}>{webexNeedsAuth ? 'Not connected' : 'Connected'}</div></div>
          <div><div className="text-[var(--color-text-muted)]">Last seen</div><div>{formatRelativeTime(lastDeviceSeenMs)}</div></div>
          <div><div className="text-[var(--color-text-muted)]">IP address</div><div>{deviceStatus?.ip_address || 'Unknown'}</div></div>
        </div>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold mb-4">Activity Log</h2>
        <div className="max-h-40 overflow-y-auto space-y-1">
          {activityLog.map((entry, i) => (<div key={i} className="text-sm flex gap-2"><span className="text-[var(--color-text-muted)]">{entry.time}</span><span>{entry.message}</span></div>))}
        </div>
      </Card>
    </div>
  );
});
