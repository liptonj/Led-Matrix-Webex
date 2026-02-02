'use client';

import { Alert, Button, Card } from '@/components/ui';
import { memo } from 'react';
import type { AppToken, WebexOAuthStatus } from '../types';

export interface WebexTabProps {
  appToken: AppToken | null;
  webexReady: boolean;
  displayName: string;
  webexError: string | null;
  webexOauthStatus: WebexOAuthStatus;
  webexNeedsAuth: boolean;
  webexPollIntervalMs: number;
  onWebexPollIntervalChange: (value: number) => void;
  onStartWebexOAuth: () => void;
}

export const WebexTab = memo(function WebexTab({ appToken, webexReady, displayName, webexError, webexOauthStatus, webexNeedsAuth, webexPollIntervalMs, onWebexPollIntervalChange, onStartWebexOAuth }: WebexTabProps) {
  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Webex Configuration</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">The embedded app automatically detects your Webex status when running inside Webex.</p>
      
      {/* Auth status indicator */}
      {webexNeedsAuth ? (
        <Alert variant="warning" className="mb-4">
          <strong>Webex not connected.</strong> Click below to authorize this device.
        </Alert>
      ) : (
        <Alert variant="success" className="mb-4">
          Webex account connected.
        </Alert>
      )}
      
      <div className="mb-4"><Button variant="primary" onClick={onStartWebexOAuth} disabled={!appToken || webexOauthStatus === 'starting'}>{webexOauthStatus === 'starting' ? 'Starting...' : 'Connect Webex Account'}</Button><p className="text-xs text-[var(--color-text-muted)] mt-2">Opens Webex authorization in a new tab.</p></div>
      <div className="mb-4"><label className="block text-sm font-medium mb-2">Webex API poll interval (seconds)</label><input type="number" min={5} max={300} value={Math.round(webexPollIntervalMs / 1000)} onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) onWebexPollIntervalChange(Math.max(5, Math.min(300, v)) * 1000); }} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" /></div>
      {webexError ? <Alert variant="warning">{webexError}</Alert> : <Alert variant="info">{webexReady ? (displayName ? `Connected as ${displayName}.` : 'Connected to Webex SDK.') : 'Set your status manually on the Status tab.'}</Alert>}
    </Card>
  );
});
