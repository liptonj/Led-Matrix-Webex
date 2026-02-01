'use client';

import { Alert, Button, Card } from '@/components/ui';

export interface SetupScreenProps {
  pairingCode: string;
  onPairingCodeChange: (code: string) => void;
  connectionError: string | null;
  onConnect: () => void;
}

export function SetupScreen({ pairingCode, onPairingCodeChange, connectionError, onConnect }: SetupScreenProps) {
  return (
    <Card className="mb-6">
      <h2 className="text-lg font-semibold mb-4">Connect to Your Display</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">Connect using Supabase Realtime for status sync and configuration commands.</p>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Pairing Code</label>
          <input type="text" placeholder="e.g., ABC123" maxLength={6} value={pairingCode} onChange={(e) => onPairingCodeChange(e.target.value.toUpperCase())} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] uppercase" />
          <p className="text-xs text-[var(--color-text-muted)] mt-1">6-character code shown on your LED display</p>
        </div>
        {connectionError && <Alert variant="danger">{connectionError}</Alert>}
        <Button variant="primary" block onClick={onConnect}>Connect</Button>
      </div>
      <div className="mt-6 p-4 bg-[var(--color-surface-alt)] rounded-lg">
        <h3 className="font-medium mb-2">How it works:</h3>
        <ol className="text-sm text-[var(--color-text-muted)] list-decimal list-inside space-y-1">
          <li>Your LED display will show a 6-character pairing code</li>
          <li>Enter the pairing code above</li>
          <li>Status and commands are synced via Supabase</li>
        </ol>
      </div>
    </Card>
  );
}
