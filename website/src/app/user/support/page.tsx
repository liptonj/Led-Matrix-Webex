'use client';

import { useSerialBridge } from '@/hooks/useSerialBridge';
import {
  BrowserGate,
  isWebSerialSupported,
  SupportLanding,
  SupportWaiting,
  SupportActive,
  SupportFlashing,
  SupportEnded,
} from '@/components/support';

/**
 * User support page -- remote support console.
 * Acts as a state router: renders the correct sub-component based on session and device status.
 */
export default function UserSupportPage() {
  const bridge = useSerialBridge();

  const {
    serialPort,
    flash,
    session: supportSession,
    channel,
    terminalLines,
    startSupport,
    endSupport,
  } = bridge;

  // Browser compatibility gate
  if (!isWebSerialSupported()) {
    return <BrowserGate />;
  }

  // Session ended
  if (supportSession.sessionStatus === 'closed') {
    return (
      <SupportEnded
        reason={supportSession.session?.close_reason ?? undefined}
        onNewSession={() => window.location.reload()}
      />
    );
  }

  // Not connected -- show landing
  if (serialPort.status === 'disconnected' && !supportSession.session) {
    return (
      <SupportLanding
        onConnect={startSupport}
        isConnecting={supportSession.isCreating}
        error={serialPort.error || supportSession.error}
      />
    );
  }

  // Connecting
  if (serialPort.status === 'connecting' || supportSession.isCreating) {
    return (
      <SupportLanding
        onConnect={startSupport}
        isConnecting={true}
        error={null}
      />
    );
  }

  // Flash in progress
  if (flash.isFlashing) {
    return (
      <SupportFlashing
        terminalLines={terminalLines}
        flashProgress={{
          phase: flash.progress.phase,
          percent: flash.progress.percent,
          message: flash.progress.message,
        }}
      />
    );
  }

  // Waiting for admin
  if (supportSession.sessionStatus === 'waiting') {
    return (
      <SupportWaiting
        sessionId={supportSession.session?.id ?? ''}
        terminalLines={terminalLines}
        onEndSession={() => endSupport('user_ended')}
      />
    );
  }

  // Active session (admin connected)
  if (supportSession.sessionStatus === 'active') {
    return (
      <SupportActive
        terminalLines={terminalLines}
        isFlashing={flash.isFlashing}
        onEndSession={() => endSupport('user_ended')}
      />
    );
  }

  // Fallback: connected but no session yet (shouldn't normally reach here)
  return (
    <SupportLanding
      onConnect={startSupport}
      isConnecting={false}
      error={serialPort.error || supportSession.error}
    />
  );
}
