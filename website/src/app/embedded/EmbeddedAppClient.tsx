'use client';

import { Button } from '@/components/ui';
import { useWebexSDK } from '@/hooks';
import type { WebexStatus } from '@/hooks/useWebexSDK';
import { formatStatus } from '@/lib/utils';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import pkg from '../../../package.json';
import { SetupScreen } from './components';
import { CONFIG, getAppVersion } from './constants';
import { useDebugConsole, useDeviceCommands, useDeviceConfig, usePairing, useWebexStatus } from './hooks';
import type { TabId } from './types';

// Lazy load tab components for better performance
const StatusTab = dynamic(() => import('./components/StatusTab').then(mod => ({ default: mod.StatusTab })), { ssr: false });
const DisplayTab = dynamic(() => import('./components/DisplayTab').then(mod => ({ default: mod.DisplayTab })), { ssr: false });
const MQTTTab = dynamic(() => import('./components/MQTTTab').then(mod => ({ default: mod.MQTTTab })), { ssr: false });
const WebexTab = dynamic(() => import('./components/WebexTab').then(mod => ({ default: mod.WebexTab })), { ssr: false });
const SystemTab = dynamic(() => import('./components/SystemTab').then(mod => ({ default: mod.SystemTab })), { ssr: false });
const DebugConsole = dynamic(() => import('./components/DebugConsole').then(mod => ({ default: mod.DebugConsole })), { ssr: false });

const APP_VERSION = getAppVersion() || pkg.version || 'unknown';

export function EmbeddedAppClient() {
  const [showSetup, setShowSetup] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('status');
  const [manualStatus, setManualStatus] = useState<WebexStatus>('active');
  const [manualCameraOn, setManualCameraOn] = useState(false);
  const [manualMicMuted, setManualMicMuted] = useState(false);
  const [manualInCall, setManualInCall] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);

  const { debugVisible, setDebugVisible, debugLogs, clearDebugLogs, activityLog, addLog, handleCopyDebug, formatRelativeTime } = useDebugConsole();
  const { isPaired, isPeerConnected, lastDeviceSeenMs, rtStatus, appToken, pairingCode, connectionError, setPairingCode, supabaseRef, handleConnect, handleDisconnect, refreshPairingSnapshot, updateAppStateViaEdge } = usePairing({ addLog });
  const { sendCommand } = useDeviceCommands({ appToken, pairingCode, supabaseRef, addLog });
  const { deviceStatus, brightness, scrollSpeedMs, setScrollSpeedMs, pageIntervalMs, setPageIntervalMs, displayPages, setDisplayPages, statusLayout, setStatusLayout, deviceName, setDeviceName, manualDisplayName, setManualDisplayName, dateColor, setDateColor, timeColor, setTimeColor, nameColor, setNameColor, metricColor, setMetricColor, mqttBroker, setMqttBroker, mqttPort, setMqttPort, mqttUsername, setMqttUsername, mqttPassword, setMqttPassword, mqttTopic, setMqttTopic, hasMqttPassword, displaySensorMac, setDisplaySensorMac, displayMetric, setDisplayMetric, isSaving, isRebooting, handleSaveSettings, handleReboot, handleBrightnessChange, setDeviceStatus } = useDeviceConfig({ isPeerConnected, sendCommand, addLog });
  const { apiWebexStatus, webexOauthStatus, webexNeedsAuth, webexPollIntervalMs, setWebexPollIntervalMs, startWebexOAuth } = useWebexStatus({ appToken, isPaired, addLog });
  const { isReady: webexReady, user, status: webexStatus, isVideoOn, isMuted, isInCall, error: webexError, initialize } = useWebexSDK();

  const autoConnectRef = useRef(false);
  const joinRequestedRef = useRef(false);
  const prevPeerConnectedRef = useRef(false);
  const lastOfflineCommandRef = useRef(0);
  const lastPairingUpdateRef = useRef(0);

  useEffect(() => { if (sdkLoaded) initialize(); }, [initialize, sdkLoaded]);
  useEffect(() => { if (typeof window === 'undefined') return; const params = new URLSearchParams(window.location.search); const pairingParam = params.get('pairing'); if (pairingParam) { const code = pairingParam.trim().toUpperCase(); if (code) { setPairingCode(code); localStorage.setItem(CONFIG.storageKeyPairingCode, code); autoConnectRef.current = true; addLog(`Pairing code detected in URL: ${code}`); } } }, [addLog, setPairingCode]);
  useEffect(() => { const savedPairingCode = localStorage.getItem(CONFIG.storageKeyPairingCode); if (savedPairingCode) { setPairingCode(savedPairingCode); autoConnectRef.current = true; } }, [setPairingCode]);
  useEffect(() => { if (autoConnectRef.current && pairingCode && rtStatus === 'disconnected') { addLog('Found saved connection, reconnecting...'); autoConnectRef.current = false; handleConnect(); } }, [addLog, pairingCode, rtStatus, handleConnect]);
  useEffect(() => { if (rtStatus !== 'connected') { joinRequestedRef.current = false; return; } if (!pairingCode || joinRequestedRef.current) return; const code = pairingCode.toUpperCase(); const displayNameValue = user?.displayName || manualDisplayName; supabaseRef.current?.schema('display').from('pairings').update({ app_connected: true, app_last_seen: new Date().toISOString(), display_name: displayNameValue }).eq('pairing_code', code).then(() => {}, () => {}); joinRequestedRef.current = true; addLog(`Joined pairing ${code}`); }, [rtStatus, pairingCode, user, manualDisplayName, addLog, supabaseRef]);
  useEffect(() => { if (rtStatus === 'disconnected') setShowSetup(!isPaired); }, [rtStatus, isPaired]);
  useEffect(() => { if (isPaired && rtStatus === 'connected') setShowSetup(false); }, [isPaired, rtStatus]);
  useEffect(() => { const OFFLINE_COMMAND_COOLDOWN = 10000; if (!isPaired || rtStatus !== 'connected') { prevPeerConnectedRef.current = isPeerConnected; return; } if (prevPeerConnectedRef.current && !isPeerConnected) { const now = Date.now(); if (now - lastOfflineCommandRef.current < OFFLINE_COMMAND_COOLDOWN) { addLog('Device offline - skipping command (rate limited)'); prevPeerConnectedRef.current = isPeerConnected; return; } lastOfflineCommandRef.current = now; addLog('Device appears offline - requesting status update via get_telemetry...'); sendCommand('get_telemetry', {}).then((result) => { if (result.success) addLog('Status update received from device'); else addLog(`Status request failed: ${result.error || 'Unknown error'}`); }, (error: Error) => { addLog(`Status request error: ${error.message}`); }); } if (!prevPeerConnectedRef.current && isPeerConnected) lastOfflineCommandRef.current = 0; prevPeerConnectedRef.current = isPeerConnected; }, [isPeerConnected, isPaired, rtStatus, sendCommand, addLog]);
  useEffect(() => { if (!isPaired || !pairingCode || !appToken) return; const interval = setInterval(() => { const now = Date.now(); if (rtStatus !== 'connected') return; if (lastPairingUpdateRef.current === 0) lastPairingUpdateRef.current = now; const staleMs = now - lastPairingUpdateRef.current; if (staleMs > 45000) refreshPairingSnapshot(pairingCode, appToken.token, 'realtime stale').catch(() => {}); if (!isPeerConnected && staleMs > 30000 && now - lastOfflineCommandRef.current > 20000) { lastOfflineCommandRef.current = now; addLog('Display offline - sending get_telemetry ping...'); sendCommand('get_telemetry', {}).catch((err: Error) => { addLog(`Display ping failed: ${err.message}`); }); } }, 15000); return () => clearInterval(interval); }, [isPaired, rtStatus, pairingCode, appToken, refreshPairingSnapshot, addLog, sendCommand, isPeerConnected]);

  const effectiveWebexStatus = apiWebexStatus ?? webexStatus;
  const statusToDisplay = webexReady ? effectiveWebexStatus : manualStatus;
  const displayName = user?.displayName || manualDisplayName;
  const cameraOn = webexReady ? isVideoOn : manualCameraOn;
  const micMuted = webexReady ? isMuted : manualMicMuted;
  const inCall = webexReady ? isInCall : manualInCall;
  const normalizedStatus = statusToDisplay === 'call' || statusToDisplay === 'presenting' ? 'meeting' : statusToDisplay;
  const statusColor = normalizedStatus === 'active' || normalizedStatus === 'away' || normalizedStatus === 'meeting' || normalizedStatus === 'dnd' || normalizedStatus === 'offline' ? normalizedStatus : 'offline';

  useEffect(() => { if (rtStatus !== 'connected' || !isPaired) return; const code = pairingCode.trim().toUpperCase(); if (!code) return; if (CONFIG.useEdgeFunctions) updateAppStateViaEdge({ webex_status: statusToDisplay, camera_on: cameraOn, mic_muted: micMuted, in_call: inCall, display_name: displayName }).catch(() => {}); else { const supabase = supabaseRef.current; if (!supabase) return; supabase.schema('display').from('pairings').update({ app_connected: true, app_last_seen: new Date().toISOString(), webex_status: statusToDisplay, camera_on: cameraOn, mic_muted: micMuted, in_call: inCall, display_name: displayName }).eq('pairing_code', code).then(({ error }) => { if (error) addLog(`pairings update failed: ${error.message}`); }); } }, [rtStatus, isPaired, pairingCode, statusToDisplay, cameraOn, micMuted, inCall, displayName, updateAppStateViaEdge, addLog, supabaseRef]);

  const handleStatusChange = (status: WebexStatus) => { if (webexReady) { addLog('Webex manages your status while embedded.'); return; } setManualStatus(status); addLog(`Status set to: ${formatStatus(status)}`); };
  const toggleCamera = () => { if (webexReady) { addLog('Webex controls camera state while embedded.'); return; } const nextValue = !manualCameraOn; setManualCameraOn(nextValue); addLog(`Camera: ${nextValue ? 'On' : 'Off'}`); };
  const toggleMic = () => { if (webexReady) { addLog('Webex controls mic state while embedded.'); return; } const nextValue = !manualMicMuted; setManualMicMuted(nextValue); addLog(`Mic: ${nextValue ? 'Muted' : 'On'}`); };
  const handleRefreshDisplay = useCallback(async () => { if (!pairingCode || !appToken) { addLog('Missing pairing info - cannot refresh display status'); return; } await refreshPairingSnapshot(pairingCode, appToken.token, 'manual refresh'); if (rtStatus === 'connected') { try { const result = await sendCommand('get_status'); if (result.success && result.data) { setDeviceStatus(result.data as Parameters<typeof setDeviceStatus>[0]); addLog('Display status refreshed'); } } catch (err) { addLog(`Display refresh failed: ${err instanceof Error ? err.message : 'unknown error'}`); } } }, [pairingCode, appToken, rtStatus, refreshPairingSnapshot, sendCommand, addLog, setDeviceStatus]);
  const handleDisplayNameChange = useCallback((newName: string) => { setManualDisplayName(newName); if (isPaired && rtStatus === 'connected' && pairingCode) { const code = pairingCode.trim().toUpperCase(); const name = user?.displayName || newName; if (CONFIG.useEdgeFunctions) updateAppStateViaEdge({ display_name: name }).catch(() => {}); else { const supabase = supabaseRef.current; if (supabase) supabase.schema('display').from('pairings').update({ display_name: name, app_last_seen: new Date().toISOString() }).eq('pairing_code', code).then(() => {}, () => {}); } } }, [isPaired, rtStatus, pairingCode, user, updateAppStateViaEdge, supabaseRef, setManualDisplayName]);
  const handleDisplayNameBlur = useCallback(() => { if (isPaired && rtStatus === 'connected' && pairingCode) { const code = pairingCode.trim().toUpperCase(); const name = user?.displayName || manualDisplayName; if (CONFIG.useEdgeFunctions) updateAppStateViaEdge({ display_name: name }).catch(() => {}); else { const supabase = supabaseRef.current; if (supabase) supabase.schema('display').from('pairings').update({ display_name: name, app_last_seen: new Date().toISOString() }).eq('pairing_code', code).then(() => {}, () => {}); } } }, [isPaired, rtStatus, pairingCode, user, manualDisplayName, updateAppStateViaEdge, supabaseRef]);

  const isBridgeConnected = rtStatus === 'connected';
  const connectionLabel = isBridgeConnected ? (isPeerConnected ? 'Connected' : 'Waiting for display') : rtStatus === 'connecting' ? 'Connecting...' : 'Disconnected';
  const connectionTextColor = isBridgeConnected ? (isPeerConnected ? 'text-success' : 'text-warning') : 'text-[var(--color-text-muted)]';
  const connectionDotColor = isBridgeConnected ? (isPeerConnected ? 'bg-success' : 'bg-warning') : 'bg-[var(--color-text-muted)]';

  return (
    <>
      <Script src="https://unpkg.com/@webex/embedded-app-sdk@latest" strategy="afterInteractive" onLoad={() => setSdkLoaded(true)} onError={() => { addLog('Failed to load Webex SDK'); }} />
      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="max-w-2xl mx-auto p-4">
          <header className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3"><Image src="/icon-512.png" alt="LED Matrix Display" width={40} height={40} className="rounded-lg" /><h1 className="text-xl font-semibold">LED Matrix Display</h1></div>
            <div className="flex items-center gap-2"><div className={`flex items-center gap-2 text-sm ${connectionTextColor}`}><span className={`w-2 h-2 rounded-full ${connectionDotColor}`} /><span>{connectionLabel}</span></div><Button size="sm" variant={debugVisible ? 'success' : 'default'} onClick={() => setDebugVisible((prev) => !prev)}>{debugVisible ? 'Debug On' : 'Debug Off'}</Button></div>
          </header>
          {showSetup && <SetupScreen pairingCode={pairingCode} onPairingCodeChange={setPairingCode} connectionError={connectionError} onConnect={handleConnect} />}
          {!showSetup && (
            <>
              <nav className="flex gap-1 mb-6 p-1 bg-[var(--color-surface-alt)] rounded-lg">{(['status', 'display', 'mqtt', 'webex', 'system'] as TabId[]).map((tab) => (<button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors capitalize ${activeTab === tab ? 'bg-[var(--color-bg-card)] text-[var(--color-text)] shadow' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>{tab === 'mqtt' ? 'MQTT' : tab}</button>))}</nav>
              {activeTab === 'status' && <StatusTab displayName={displayName} statusToDisplay={statusToDisplay} normalizedStatus={normalizedStatus} statusColor={statusColor} webexReady={webexReady} webexNeedsAuth={webexNeedsAuth} cameraOn={cameraOn} micMuted={micMuted} rtStatus={rtStatus} isPeerConnected={isPeerConnected} isPaired={isPaired} lastDeviceSeenMs={lastDeviceSeenMs} deviceStatus={deviceStatus} activityLog={activityLog} onStatusChange={handleStatusChange} onToggleCamera={toggleCamera} onToggleMic={toggleMic} onRefreshDisplay={handleRefreshDisplay} formatRelativeTime={formatRelativeTime} />}
              {activeTab === 'display' && <DisplayTab deviceName={deviceName} onDeviceNameChange={setDeviceName} manualDisplayName={manualDisplayName} onDisplayNameChange={handleDisplayNameChange} onDisplayNameBlur={handleDisplayNameBlur} brightness={brightness} onBrightnessChange={handleBrightnessChange} scrollSpeedMs={scrollSpeedMs} onScrollSpeedChange={setScrollSpeedMs} pageIntervalMs={pageIntervalMs} onPageIntervalChange={setPageIntervalMs} displayPages={displayPages} onDisplayPagesChange={setDisplayPages} statusLayout={statusLayout} onStatusLayoutChange={setStatusLayout} dateColor={dateColor} onDateColorChange={setDateColor} timeColor={timeColor} onTimeColorChange={setTimeColor} nameColor={nameColor} onNameColorChange={setNameColor} metricColor={metricColor} onMetricColorChange={setMetricColor} deviceStatus={deviceStatus} pairingCode={pairingCode} isPeerConnected={isPeerConnected} isSaving={isSaving} onSaveSettings={handleSaveSettings} onDisconnect={handleDisconnect} />}
              {activeTab === 'mqtt' && <MQTTTab mqttBroker={mqttBroker} onMqttBrokerChange={setMqttBroker} mqttPort={mqttPort} onMqttPortChange={setMqttPort} mqttUsername={mqttUsername} onMqttUsernameChange={setMqttUsername} mqttPassword={mqttPassword} onMqttPasswordChange={setMqttPassword} mqttTopic={mqttTopic} onMqttTopicChange={setMqttTopic} hasMqttPassword={hasMqttPassword} displaySensorMac={displaySensorMac} onDisplaySensorMacChange={setDisplaySensorMac} displayMetric={displayMetric} onDisplayMetricChange={setDisplayMetric} isPeerConnected={isPeerConnected} isSaving={isSaving} onSaveSettings={handleSaveSettings} />}
              {activeTab === 'webex' && <WebexTab appToken={appToken} webexReady={webexReady} displayName={displayName} webexError={webexError} webexOauthStatus={webexOauthStatus} webexNeedsAuth={webexNeedsAuth} webexPollIntervalMs={webexPollIntervalMs} onWebexPollIntervalChange={setWebexPollIntervalMs} onStartWebexOAuth={startWebexOAuth} />}
              {activeTab === 'system' && <SystemTab deviceStatus={deviceStatus} appVersion={APP_VERSION} isBridgeConnected={isBridgeConnected} isPeerConnected={isPeerConnected} isRebooting={isRebooting} onReboot={handleReboot} />}
            </>
          )}
          <footer className="mt-8 text-center text-sm text-[var(--color-text-muted)]"><span>LED Matrix Webex Display</span><span className="ml-2">{APP_VERSION}</span></footer>
        </div>
        {debugVisible && <DebugConsole debugLogs={debugLogs} onClear={clearDebugLogs} onCopy={handleCopyDebug} onClose={() => setDebugVisible(false)} />}
      </div>
    </>
  );
}
