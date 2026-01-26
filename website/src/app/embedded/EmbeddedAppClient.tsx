'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Script from 'next/script';
import Image from 'next/image';
import { Button, Card, Alert } from '@/components/ui';
import { formatStatus } from '@/lib/utils';
import { useWebSocket, useWebexSDK } from '@/hooks';
import type { WebexStatus } from '@/hooks/useWebexSDK';

// Configuration
const CONFIG = {
  storageKeyBridgeUrl: 'led_matrix_bridge_url',
  storageKeyPairingCode: 'led_matrix_pairing_code',
  bridgeConfigUrl: '/api/bridge-config.json',
};

type TabId = 'status' | 'display' | 'webex' | 'system';

// Device config interface matching firmware response
interface DeviceConfig {
  device_name?: string;
  display_name?: string;
  brightness?: number;
  scroll_speed_ms?: number;
  poll_interval?: number;
  time_zone?: string;
  time_format?: string;
  date_format?: string;
  pairing_code?: string;
}

// Device status interface matching firmware response
interface DeviceStatus {
  wifi_connected?: boolean;
  webex_authenticated?: boolean;
  bridge_connected?: boolean;
  webex_status?: string;
  camera_on?: boolean;
  mic_muted?: boolean;
  in_call?: boolean;
  pairing_code?: string;
  ip_address?: string;
  firmware_version?: string;
  free_heap?: number;
  uptime?: number;
  rssi?: number;
  temperature?: number;
  humidity?: number;
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
  const [discoveredBridgeUrl, setDiscoveredBridgeUrl] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [manualStatus, setManualStatus] = useState<WebexStatus>('active');
  const [manualDisplayName, setManualDisplayName] = useState('User');
  const [manualCameraOn, setManualCameraOn] = useState(false);
  const [manualMicMuted, setManualMicMuted] = useState(false);
  const [manualInCall, setManualInCall] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [isPeerConnected, setIsPeerConnected] = useState(false);
  const [activityLog, setActivityLog] = useState<{ time: string; message: string }[]>([
    { time: new Date().toLocaleTimeString('en-US', { hour12: false }), message: 'Initializing...' },
  ]);
  
  // Device settings state
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig>({});
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>({});
  const [brightness, setBrightness] = useState(128);
  const [deviceName, setDeviceName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  const addLog = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setActivityLog(prev => [{ time, message }, ...prev.slice(0, 29)]);
  }, []);

  const bridgeUrlToUse = bridgeUrl || discoveredBridgeUrl;

  const {
    status: wsStatus,
    lastMessage,
    connect,
    disconnect,
    send,
    sendCommand,
  } = useWebSocket({
    url: bridgeUrlToUse,
    onError: () => setConnectionError('WebSocket connection error. Check the bridge URL and network.'),
    onClose: () => {
      setIsPaired(false);
      setIsPeerConnected(false);
      setDeviceConfig({});
      setDeviceStatus({});
    },
  });

  const {
    isReady: webexReady,
    user,
    status: webexStatus,
    isVideoOn,
    isMuted,
    isInCall,
    error: webexError,
    initialize,
  } = useWebexSDK();

  const autoConnectRef = useRef(false);
  const joinRequestedRef = useRef(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

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
        setDiscoveredBridgeUrl('wss://bridge.5ls.us');
      }
    }

    fetchBridgeConfig();

    const savedBridgeUrl = localStorage.getItem(CONFIG.storageKeyBridgeUrl);
    const savedPairingCode = localStorage.getItem(CONFIG.storageKeyPairingCode);
    if (savedBridgeUrl && savedPairingCode) {
      setBridgeUrl(savedBridgeUrl);
      setPairingCode(savedPairingCode);
      autoConnectRef.current = true;
    }
  }, [addLog]);

  useEffect(() => {
    if (autoConnectRef.current && bridgeUrlToUse && pairingCode && wsStatus === 'disconnected') {
      addLog('Found saved connection, reconnecting...');
      connect();
      autoConnectRef.current = false;
    }
  }, [addLog, bridgeUrlToUse, pairingCode, wsStatus, connect]);

  useEffect(() => {
    if (wsStatus !== 'connected') {
      joinRequestedRef.current = false;
      return;
    }
    if (!pairingCode || joinRequestedRef.current) return;

    const code = pairingCode.toUpperCase();
    const displayName = user?.displayName || manualDisplayName;

    send({
      type: 'join',
      code,
      clientType: 'app',
      deviceId: user?.id || 'webex-app',
      display_name: displayName,
    });
    joinRequestedRef.current = true;
    addLog(`Joining room ${code}...`);
  }, [wsStatus, pairingCode, send, user, manualDisplayName, addLog]);

  // Fetch device config when peer connects
  const fetchDeviceConfig = useCallback(async () => {
    if (!isPeerConnected) return;
    
    try {
      addLog('Fetching device config...');
      const response = await sendCommand('get_config');
      if (response.success && response.data) {
        const config = response.data as unknown as DeviceConfig;
        setDeviceConfig(config);
        if (config.brightness !== undefined) {
          setBrightness(config.brightness);
        }
        if (config.device_name) {
          setDeviceName(config.device_name);
        }
        if (config.display_name) {
          setManualDisplayName(config.display_name);
        }
        addLog('Device config loaded');
      }
    } catch (error) {
      addLog(`Failed to fetch config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [isPeerConnected, sendCommand, addLog]);

  // Fetch device status
  const fetchDeviceStatus = useCallback(async () => {
    if (!isPeerConnected) return;
    
    try {
      const response = await sendCommand('get_status');
      if (response.success && response.data) {
        setDeviceStatus(response.data as unknown as DeviceStatus);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  }, [isPeerConnected, sendCommand]);

  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'connection':
        addLog('Bridge connection established');
        break;
      case 'joined': {
        const data = lastMessage.data as { code?: string; displayConnected?: boolean };
        setIsPaired(true);
        setShowSetup(false);
        setConnectionError(null);
        if (typeof data?.displayConnected === 'boolean') {
          setIsPeerConnected(data.displayConnected);
        }
        if (data?.code) {
          addLog(`Joined room ${data.code}`);
        }
        break;
      }
      case 'peer_connected':
        setIsPeerConnected(true);
        addLog('Display connected');
        break;
      case 'peer_disconnected':
        setIsPeerConnected(false);
        addLog('Display disconnected');
        break;
      case 'status':
        if (!webexReady) {
          if (typeof lastMessage.status === 'string') {
            setManualStatus(lastMessage.status as WebexStatus);
          }
          if (typeof lastMessage.camera_on === 'boolean') {
            setManualCameraOn(lastMessage.camera_on);
          }
          if (typeof lastMessage.mic_muted === 'boolean') {
            setManualMicMuted(lastMessage.mic_muted);
          }
          if (typeof lastMessage.in_call === 'boolean') {
            setManualInCall(lastMessage.in_call);
          }
        }
        break;
      case 'config':
        // Config response from display
        if (lastMessage.data) {
          const config = lastMessage.data as unknown as DeviceConfig;
          setDeviceConfig(config);
          if (config.brightness !== undefined) {
            setBrightness(config.brightness);
          }
          if (config.device_name) {
            setDeviceName(config.device_name);
          }
        }
        break;
      case 'error':
        setConnectionError(lastMessage.message as string || 'Bridge error');
        addLog(`Bridge error: ${lastMessage.message || 'Unknown error'}`);
        break;
      default:
        break;
    }
  }, [lastMessage, addLog, webexReady]);
  
  // Fetch config when display connects
  useEffect(() => {
    if (isPeerConnected) {
      fetchDeviceConfig();
      fetchDeviceStatus();
    }
  }, [isPeerConnected, fetchDeviceConfig, fetchDeviceStatus]);

  useEffect(() => {
    if (wsStatus === 'disconnected') {
      setShowSetup(true);
      setIsPaired(false);
      setIsPeerConnected(false);
    }
  }, [wsStatus]);

  const statusToDisplay = webexReady ? webexStatus : manualStatus;
  const displayName = user?.displayName || manualDisplayName;
  const cameraOn = webexReady ? isVideoOn : manualCameraOn;
  const micMuted = webexReady ? isMuted : manualMicMuted;
  const inCall = webexReady ? isInCall : manualInCall;

  const normalizedStatus =
    statusToDisplay === 'call' || statusToDisplay === 'presenting'
      ? 'meeting'
      : statusToDisplay;
  const statusColor =
    normalizedStatus === 'active' ||
    normalizedStatus === 'away' ||
    normalizedStatus === 'meeting' ||
    normalizedStatus === 'dnd' ||
    normalizedStatus === 'offline'
      ? normalizedStatus
      : 'offline';

  useEffect(() => {
    if (wsStatus !== 'connected' || !isPaired) return;

    send({
      type: 'status',
      status: statusToDisplay,
      camera_on: cameraOn,
      mic_muted: micMuted,
      in_call: inCall,
      display_name: displayName,
    });
  }, [wsStatus, isPaired, statusToDisplay, cameraOn, micMuted, inCall, displayName, send]);

  const handleConnect = () => {
    const url = bridgeUrlToUse.trim();
    const code = pairingCode.trim().toUpperCase();
    if (!url || !code) {
      setConnectionError('Please enter both bridge URL and pairing code');
      return;
    }

    if (!bridgeUrl) {
      setBridgeUrl(url);
    }
    setPairingCode(code);
    localStorage.setItem(CONFIG.storageKeyBridgeUrl, url);
    localStorage.setItem(CONFIG.storageKeyPairingCode, code);
    setConnectionError(null);
    addLog(`Connecting to ${url}...`);
    connect();
  };

  const handleDisconnect = () => {
    disconnect();
    localStorage.removeItem(CONFIG.storageKeyBridgeUrl);
    localStorage.removeItem(CONFIG.storageKeyPairingCode);
    setShowSetup(true);
    setIsPaired(false);
    setIsPeerConnected(false);
    addLog('Disconnected');
  };

  const handleStatusChange = (status: WebexStatus) => {
    if (webexReady) {
      addLog('Webex manages your status while embedded.');
      return;
    }
    setManualStatus(status);
    addLog(`Status set to: ${formatStatus(status)}`);
  };

  const toggleCamera = () => {
    if (webexReady) {
      addLog('Webex controls camera state while embedded.');
      return;
    }
    const nextValue = !manualCameraOn;
    setManualCameraOn(nextValue);
    addLog(`Camera: ${nextValue ? 'On' : 'Off'}`);
  };

  const toggleMic = () => {
    if (webexReady) {
      addLog('Webex controls mic state while embedded.');
      return;
    }
    const nextValue = !manualMicMuted;
    setManualMicMuted(nextValue);
    addLog(`Mic: ${nextValue ? 'Muted' : 'On'}`);
  };

  // Debounced brightness sender
  const brightnessTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Handle brightness change (debounced - sends after slider stops moving)
  const handleBrightnessChange = useCallback((value: number) => {
    setBrightness(value);
    
    if (!isPeerConnected) return;
    
    // Clear previous timeout
    if (brightnessTimeoutRef.current) {
      clearTimeout(brightnessTimeoutRef.current);
    }
    
    // Debounce - send after 150ms of no changes
    brightnessTimeoutRef.current = setTimeout(async () => {
      try {
        await sendCommand('set_brightness', { value });
      } catch (error) {
        console.error('Failed to set brightness:', error);
      }
    }, 150);
  }, [isPeerConnected, sendCommand]);
  
  // Cleanup brightness timeout on unmount
  useEffect(() => {
    return () => {
      if (brightnessTimeoutRef.current) {
        clearTimeout(brightnessTimeoutRef.current);
      }
    };
  }, []);

  // Handle save display settings
  const handleSaveSettings = useCallback(async () => {
    if (!isPeerConnected) {
      addLog('Cannot save - display not connected');
      return;
    }
    
    setIsSaving(true);
    addLog('Saving display settings...');
    
    try {
      const response = await sendCommand('set_config', {
        display_name: manualDisplayName,
        brightness,
      });
      
      if (response.success) {
        addLog('Settings saved successfully');
        // Update local config from response
        if (response.data) {
          setDeviceConfig(response.data as unknown as DeviceConfig);
        }
      } else {
        addLog(`Failed to save: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      addLog(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  }, [isPeerConnected, sendCommand, manualDisplayName, brightness, addLog]);

  // Handle reboot
  const handleReboot = useCallback(async () => {
    if (!isPeerConnected) {
      addLog('Cannot reboot - display not connected');
      return;
    }
    
    setIsRebooting(true);
    addLog('Sending reboot command...');
    
    try {
      await sendCommand('reboot');
      addLog('Reboot command sent - device will restart');
    } catch (error) {
      addLog(`Reboot failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRebooting(false);
    }
  }, [isPeerConnected, sendCommand, addLog]);

  const isBridgeConnected = wsStatus === 'connected';
  const connectionLabel = isBridgeConnected
    ? isPeerConnected
      ? 'Connected'
      : 'Waiting for display'
    : wsStatus === 'connecting'
      ? 'Connecting...'
      : 'Disconnected';
  const connectionTextColor = isBridgeConnected
    ? isPeerConnected
      ? 'text-success'
      : 'text-warning'
    : 'text-[var(--color-text-muted)]';
  const connectionDotColor = isBridgeConnected
    ? isPeerConnected
      ? 'bg-success'
      : 'bg-warning'
    : 'bg-[var(--color-text-muted)]';

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
            <div className={`flex items-center gap-2 text-sm ${connectionTextColor}`}>
              <span className={`w-2 h-2 rounded-full ${connectionDotColor}`} />
              <span>{connectionLabel}</span>
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
                    value={bridgeUrl}
                    onChange={(event) => setBridgeUrl(event.target.value)}
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
                    value={pairingCode}
                    onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
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
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white bg-status-${statusColor}`}>
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium">{displayName}</div>
                        <div className="text-[var(--color-text-muted)]">{formatStatus(statusToDisplay)}</div>
                      </div>
                    </div>

                    <h3 className="text-sm font-medium mb-3">Set Your Status</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {statusButtons.map(({ status, label, className }) => (
                        <button
                          key={status}
                          onClick={() => handleStatusChange(status)}
                          disabled={webexReady}
                          className={`p-3 rounded-lg text-sm font-medium transition-colors ${className} ${
                            normalizedStatus === status ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-card)]' : ''
                          } ${webexReady ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                        disabled={webexReady}
                        className={`p-4 rounded-lg border transition-colors ${
                          cameraOn
                            ? 'bg-primary/20 border-primary text-primary'
                            : 'bg-[var(--color-surface-alt)] border-[var(--color-border)]'
                        } ${webexReady ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <span className="text-2xl">{cameraOn ? '📹' : '📷'}</span>
                        <div className="text-sm mt-1">{cameraOn ? 'Camera On' : 'Camera Off'}</div>
                      </button>
                      <button
                        onClick={toggleMic}
                        disabled={webexReady}
                        className={`p-4 rounded-lg border transition-colors ${
                          !micMuted
                            ? 'bg-primary/20 border-primary text-primary'
                            : 'bg-[var(--color-surface-alt)] border-[var(--color-border)]'
                        } ${webexReady ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <span className="text-2xl">{micMuted ? '🔇' : '🎤'}</span>
                        <div className="text-sm mt-1">{micMuted ? 'Mic Muted' : 'Mic On'}</div>
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
                        value={deviceName}
                        onChange={(event) => setDeviceName(event.target.value)}
                        className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                        disabled={!isPeerConnected}
                      />
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        mDNS hostname for the device
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Your Name</label>
                      <input
                        type="text"
                        placeholder="John Doe"
                        value={manualDisplayName}
                        onChange={(event) => setManualDisplayName(event.target.value)}
                        className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                      />
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Name shown on the display
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Brightness: {brightness}
                      </label>
                      <input
                        type="range"
                        min="10"
                        max="255"
                        value={brightness}
                        onChange={(e) => handleBrightnessChange(parseInt(e.target.value, 10))}
                        className="w-full"
                        disabled={!isPeerConnected}
                      />
                      <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                        <span>Dim</span>
                        <span>Bright</span>
                      </div>
                    </div>
                    <Button 
                      variant="primary" 
                      onClick={handleSaveSettings}
                      disabled={!isPeerConnected || isSaving}
                    >
                      {isSaving ? 'Saving...' : 'Save Display Settings'}
                    </Button>
                  </div>

                  <hr className="my-6 border-[var(--color-border)]" />

                  <h3 className="font-medium mb-4">Connected Display</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--color-text-muted)]">IP Address:</span>
                      <span className="ml-2">{deviceStatus.ip_address || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-muted)]">Pairing Code:</span>
                      <span className="ml-2 font-mono">{pairingCode}</span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-muted)]">Firmware:</span>
                      <span className="ml-2">{deviceStatus.firmware_version || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-muted)]">WiFi Signal:</span>
                      <span className="ml-2">{deviceStatus.rssi ? `${deviceStatus.rssi} dBm` : 'Unknown'}</span>
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
                  {webexError ? (
                    <Alert variant="warning">
                      {webexError}
                    </Alert>
                  ) : (
                    <Alert variant="info">
                      {webexReady
                        ? `Connected as ${displayName}.`
                        : 'When running in standalone mode, you can manually set your status using the buttons on the Status tab.'}
                    </Alert>
                  )}
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
                        <span className="ml-2">v1.4.2</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)]">Connection:</span>
                        <span className="ml-2">{isBridgeConnected ? 'Bridge Connected' : 'Disconnected'}</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)]">Display Connected:</span>
                        <span className="ml-2">{isPeerConnected ? 'Yes' : 'No'}</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)]">Firmware:</span>
                        <span className="ml-2">{deviceStatus.firmware_version || 'Unknown'}</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)]">Free Memory:</span>
                        <span className="ml-2">
                          {deviceStatus.free_heap 
                            ? `${Math.round(deviceStatus.free_heap / 1024)} KB` 
                            : 'Unknown'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)]">Uptime:</span>
                        <span className="ml-2">
                          {deviceStatus.uptime 
                            ? `${Math.floor(deviceStatus.uptime / 3600)}h ${Math.floor((deviceStatus.uptime % 3600) / 60)}m` 
                            : 'Unknown'}
                        </span>
                      </div>
                    </div>
                    
                    {deviceStatus.temperature !== undefined && deviceStatus.temperature > 0 && (
                      <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                        <h3 className="font-medium mb-2">Sensor Data</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-[var(--color-text-muted)]">Temperature:</span>
                            <span className="ml-2">{deviceStatus.temperature}°C</span>
                          </div>
                          {deviceStatus.humidity !== undefined && deviceStatus.humidity > 0 && (
                            <div>
                              <span className="text-[var(--color-text-muted)]">Humidity:</span>
                              <span className="ml-2">{deviceStatus.humidity}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>

                  <Card>
                    <h2 className="text-lg font-semibold mb-4">Device Actions</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mb-4">
                      Restart the display device if it&apos;s not responding correctly.
                    </p>
                    
                    <Button 
                      variant="warning" 
                      onClick={handleReboot}
                      disabled={isRebooting || !isPeerConnected}
                    >
                      {isRebooting ? 'Rebooting...' : 'Reboot Device'}
                    </Button>
                    
                    {!isPeerConnected && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-2">
                        Connect to a display to use this function.
                      </p>
                    )}
                  </Card>
                </div>
              )}
            </>
          )}

          {/* Footer */}
          <footer className="mt-8 text-center text-sm text-[var(--color-text-muted)]">
            <span>LED Matrix Webex Display</span>
            <span className="ml-2">v1.4.2</span>
          </footer>
        </div>
      </div>
    </>
  );
}
