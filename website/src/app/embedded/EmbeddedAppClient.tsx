'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';
import Image from 'next/image';
import { Button, Card, Alert } from '@/components/ui';
import { formatStatus } from '@/lib/utils';
import type { WebexStatus } from '@/types';

// Configuration
const CONFIG = {
  storageKeyBridgeUrl: 'led_matrix_bridge_url',
  storageKeyPairingCode: 'led_matrix_pairing_code',
  bridgeConfigUrl: '/api/bridge-config.json',
};

type ConnectionMode = 'bridge' | 'direct';
type TabId = 'status' | 'display' | 'webex' | 'system';

interface AppState {
  connectionMode: ConnectionMode;
  connected: boolean;
  bridgeUrl: string;
  pairingCode: string;
  currentStatus: WebexStatus;
  displayName: string;
  cameraOn: boolean;
  micMuted: boolean;
  inCall: boolean;
}

const statusButtons: { status: WebexStatus; label: string; className: string }[] = [
  { status: 'active', label: 'Available', className: 'bg-status-active/20 text-status-active hover:bg-status-active/30' },
  { status: 'away', label: 'Away', className: 'bg-status-away/20 text-status-away hover:bg-status-away/30' },
  { status: 'meeting', label: 'In a Call', className: 'bg-status-meeting/20 text-status-meeting hover:bg-status-meeting/30' },
  { status: 'dnd', label: 'DND', className: 'bg-status-dnd/20 text-status-dnd hover:bg-status-dnd/30' },
];

export function EmbeddedAppClient() {
  const [showSetup, setShowSetup] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('status');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [discoveredBridgeUrl, setDiscoveredBridgeUrl] = useState<string>('');
  const [activityLog, setActivityLog] = useState<{ time: string; message: string }[]>([
    { time: new Date().toLocaleTimeString('en-US', { hour12: false }), message: 'Initializing...' }
  ]);
  
  const [state, setState] = useState<AppState>({
    connectionMode: 'bridge',
    connected: false,
    bridgeUrl: '',
    pairingCode: '',
    currentStatus: 'active',
    displayName: 'User',
    cameraOn: false,
    micMuted: false,
    inCall: false,
  });

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setActivityLog(prev => [{ time, message }, ...prev.slice(0, 29)]);
  };

  // Fetch bridge config on mount
  useEffect(() => {
    async function fetchBridgeConfig() {
      try {
        const response = await fetch(CONFIG.bridgeConfigUrl);
        if (response.ok) {
          const config = await response.json();
          if (config.bridge?.url) {
            setDiscoveredBridgeUrl(config.bridge.url);
            addLog(`Bridge discovered: ${config.bridge.url}`);
          }
        }
      } catch {
        // Use default if discovery fails
        setDiscoveredBridgeUrl('wss://bridge.5ls.us');
      }
    }
    
    fetchBridgeConfig();
    
    // Check for saved connection
    const savedBridgeUrl = localStorage.getItem(CONFIG.storageKeyBridgeUrl);
    const savedPairingCode = localStorage.getItem(CONFIG.storageKeyPairingCode);
    if (savedBridgeUrl && savedPairingCode) {
      setState(prev => ({
        ...prev,
        bridgeUrl: savedBridgeUrl,
        pairingCode: savedPairingCode,
      }));
      // Auto-connect with saved credentials
      addLog('Found saved connection, reconnecting...');
    }
  }, []);

  const handleConnect = () => {
    if (!state.bridgeUrl || !state.pairingCode) {
      setConnectionError('Please enter both bridge URL and pairing code');
      return;
    }

    addLog(`Connecting to ${state.bridgeUrl}...`);
    
    // Save connection settings
    localStorage.setItem(CONFIG.storageKeyBridgeUrl, state.bridgeUrl);
    localStorage.setItem(CONFIG.storageKeyPairingCode, state.pairingCode);
    
    // Simulate connection (actual WebSocket logic would go here)
    setTimeout(() => {
      setState(prev => ({ ...prev, connected: true }));
      setShowSetup(false);
      setConnectionError(null);
      addLog('Connected successfully');
    }, 500);
  };

  const handleDisconnect = () => {
    localStorage.removeItem(CONFIG.storageKeyBridgeUrl);
    localStorage.removeItem(CONFIG.storageKeyPairingCode);
    setState(prev => ({
      ...prev,
      connected: false,
      bridgeUrl: '',
      pairingCode: '',
    }));
    setShowSetup(true);
    addLog('Disconnected');
  };

  const handleStatusChange = (status: WebexStatus) => {
    setState(prev => ({ ...prev, currentStatus: status }));
    addLog(`Status set to: ${formatStatus(status)}`);
  };

  const toggleCamera = () => {
    setState(prev => ({ ...prev, cameraOn: !prev.cameraOn }));
    addLog(`Camera: ${!state.cameraOn ? 'On' : 'Off'}`);
  };

  const toggleMic = () => {
    setState(prev => ({ ...prev, micMuted: !prev.micMuted }));
    addLog(`Mic: ${state.micMuted ? 'On' : 'Muted'}`);
  };

  return (
    <>
      {/* Webex SDK Script */}
      <Script 
        src="https://binaries.webex.com/static-content-pipeline/webex-embedded-app/v1/webex-embedded-app-sdk.js"
        strategy="lazyOnload"
      />

      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="max-w-2xl mx-auto p-4">
          {/* Header */}
          <header className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Image src="/icon-512.png" alt="LED Matrix Display" width={40} height={40} className="rounded-lg" />
              <h1 className="text-xl font-semibold">LED Matrix Display</h1>
            </div>
            <div className={`flex items-center gap-2 text-sm ${state.connected ? 'text-success' : 'text-[var(--color-text-muted)]'}`}>
              <span className={`w-2 h-2 rounded-full ${state.connected ? 'bg-success' : 'bg-[var(--color-text-muted)]'}`} />
              <span>{state.connected ? 'Connected' : 'Connecting...'}</span>
            </div>
          </header>

          {/* Setup Screen */}
          {showSetup && (
            <Card className="mb-6">
              <h2 className="text-lg font-semibold mb-4">Connect to Your Display</h2>
              <p className="text-sm text-[var(--color-text-muted)] mb-6">
                Connect via WebSocket bridge for real-time status sync.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Bridge URL</label>
                  <input
                    type="text"
                    placeholder={discoveredBridgeUrl || 'wss://bridge.example.com'}
                    value={state.bridgeUrl}
                    onChange={(e) => setState(prev => ({ ...prev, bridgeUrl: e.target.value }))}
                    className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                  />
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    {discoveredBridgeUrl && `Auto-discovered: ${discoveredBridgeUrl}`}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Pairing Code</label>
                  <input
                    type="text"
                    placeholder="e.g., ABC123"
                    maxLength={6}
                    value={state.pairingCode}
                    onChange={(e) => setState(prev => ({ ...prev, pairingCode: e.target.value.toUpperCase() }))}
                    className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] uppercase"
                  />
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    6-character code shown on your LED display
                  </p>
                </div>

                {connectionError && (
                  <Alert variant="danger">{connectionError}</Alert>
                )}

                <Button variant="primary" block onClick={handleConnect}>
                  Connect via Bridge
                </Button>
              </div>

              <div className="mt-6 p-4 bg-[var(--color-surface-alt)] rounded-lg">
                <h3 className="font-medium mb-2">Bridge Connection (Recommended):</h3>
                <ol className="text-sm text-[var(--color-text-muted)] list-decimal list-inside space-y-1">
                  <li>Install the Webex Bridge add-on in Home Assistant</li>
                  <li>Expose via Cloudflare Tunnel</li>
                  <li>Your LED display will show a 6-character pairing code</li>
                  <li>Enter the bridge URL and pairing code above</li>
                </ol>
              </div>
            </Card>
          )}

          {/* Main App Screen */}
          {!showSetup && (
            <>
              {/* Tab Navigation */}
              <nav className="flex gap-1 mb-6 p-1 bg-[var(--color-surface-alt)] rounded-lg">
                {(['status', 'display', 'webex', 'system'] as TabId[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors capitalize ${
                      activeTab === tab
                        ? 'bg-[var(--color-bg-card)] text-[var(--color-text)] shadow'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </nav>

              {/* Status Tab */}
              {activeTab === 'status' && (
                <div className="space-y-6">
                  {/* Current Status */}
                  <Card>
                    <h2 className="text-lg font-semibold mb-4">Your Webex Status</h2>
                    <div className="flex items-center gap-4 mb-6">
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white bg-status-${state.currentStatus}`}>
                        {state.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium">{state.displayName}</div>
                        <div className="text-[var(--color-text-muted)]">{formatStatus(state.currentStatus)}</div>
                      </div>
                    </div>

                    <h3 className="text-sm font-medium mb-3">Set Your Status</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {statusButtons.map(({ status, label, className }) => (
                        <button
                          key={status}
                          onClick={() => handleStatusChange(status)}
                          className={`p-3 rounded-lg text-sm font-medium transition-colors ${className} ${
                            state.currentStatus === status ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-card)]' : ''
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full inline-block mr-1 bg-status-${status}`} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </Card>

                  {/* Camera & Mic */}
                  <Card>
                    <h3 className="text-sm font-medium mb-3">Camera & Microphone</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={toggleCamera}
                        className={`p-4 rounded-lg border transition-colors ${
                          state.cameraOn
                            ? 'bg-primary/20 border-primary text-primary'
                            : 'bg-[var(--color-surface-alt)] border-[var(--color-border)]'
                        }`}
                      >
                        <span className="text-2xl">{state.cameraOn ? '📹' : '📷'}</span>
                        <div className="text-sm mt-1">{state.cameraOn ? 'Camera On' : 'Camera Off'}</div>
                      </button>
                      <button
                        onClick={toggleMic}
                        className={`p-4 rounded-lg border transition-colors ${
                          !state.micMuted
                            ? 'bg-primary/20 border-primary text-primary'
                            : 'bg-[var(--color-surface-alt)] border-[var(--color-border)]'
                        }`}
                      >
                        <span className="text-2xl">{state.micMuted ? '🔇' : '🎤'}</span>
                        <div className="text-sm mt-1">{state.micMuted ? 'Mic Muted' : 'Mic On'}</div>
                      </button>
                    </div>
                  </Card>

                  {/* Activity Log */}
                  <Card>
                    <h2 className="text-lg font-semibold mb-4">Activity Log</h2>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {activityLog.map((entry, i) => (
                        <div key={i} className="text-sm flex gap-2">
                          <span className="text-[var(--color-text-muted)]">{entry.time}</span>
                          <span>{entry.message}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}

              {/* Display Tab */}
              {activeTab === 'display' && (
                <Card>
                  <h2 className="text-lg font-semibold mb-4">Display Settings</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Device Name</label>
                      <input
                        type="text"
                        placeholder="webex-display"
                        className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Your Name</label>
                      <input
                        type="text"
                        placeholder="John Doe"
                        className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Brightness: 128</label>
                      <input
                        type="range"
                        min="10"
                        max="255"
                        defaultValue="128"
                        className="w-full"
                      />
                    </div>
                    <Button variant="primary">Save Display Settings</Button>
                  </div>

                  <hr className="my-6 border-[var(--color-border)]" />

                  <h3 className="font-medium mb-4">Connected Display</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--color-text-muted)]">Address:</span>
                      <span className="ml-2">via Bridge</span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-muted)]">Pairing Code:</span>
                      <span className="ml-2">{state.pairingCode}</span>
                    </div>
                  </div>
                  <Button variant="warning" className="mt-4" onClick={handleDisconnect}>
                    Disconnect Display
                  </Button>
                </Card>
              )}

              {/* Webex Tab */}
              {activeTab === 'webex' && (
                <Card>
                  <h2 className="text-lg font-semibold mb-4">Webex Configuration</h2>
                  <p className="text-sm text-[var(--color-text-muted)] mb-4">
                    The embedded app automatically detects your Webex status when running inside Webex.
                  </p>
                  <Alert variant="info">
                    When running in standalone mode, you can manually set your status using the buttons on the Status tab.
                  </Alert>
                </Card>
              )}

              {/* System Tab */}
              {activeTab === 'system' && (
                <div className="space-y-6">
                  <Card>
                    <h2 className="text-lg font-semibold mb-4">System Information</h2>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-[var(--color-text-muted)]">App Version:</span>
                        <span className="ml-2">v1.2.0</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)]">Connection:</span>
                        <span className="ml-2">{state.connected ? 'Bridge' : 'Disconnected'}</span>
                      </div>
                    </div>
                  </Card>

                  <Card className="border-danger/50">
                    <h2 className="text-lg font-semibold mb-4 text-danger">Danger Zone</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mb-4">
                      These actions cannot be undone.
                    </p>
                    <div className="flex gap-3">
                      <Button variant="warning">Reboot Device</Button>
                      <Button variant="danger">Factory Reset</Button>
                    </div>
                  </Card>
                </div>
              )}
            </>
          )}

          {/* Footer */}
          <footer className="mt-8 text-center text-sm text-[var(--color-text-muted)]">
            <span>LED Matrix Webex Display</span>
            <span className="ml-2">v1.2.0</span>
          </footer>
        </div>
      </div>
    </>
  );
}
