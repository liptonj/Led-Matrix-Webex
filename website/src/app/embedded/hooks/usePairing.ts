'use client';

import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG } from '../constants';
import type { AppToken, RealtimeStatus } from '../types';

const API_TIMEOUT_MS = 15000;

export interface UsePairingOptions {
  addLog: (message: string) => void;
}

export interface UsePairingResult {
  isPaired: boolean;
  isPeerConnected: boolean;
  lastDeviceSeenAt: string | null;
  lastDeviceSeenMs: number | null;
  rtStatus: RealtimeStatus;
  appToken: AppToken | null;
  pairingCode: string;
  connectionError: string | null;
  setPairingCode: (code: string) => void;
  supabaseRef: React.MutableRefObject<SupabaseClient | null>;
  handleConnect: () => Promise<void>;
  handleDisconnect: () => void;
  refreshPairingSnapshot: (code: string, token: string, reason: string) => Promise<void>;
  exchangePairingCode: (code: string) => Promise<AppToken | null>;
  updateAppStateViaEdge: (stateData: { webex_status?: string; camera_on?: boolean; mic_muted?: boolean; in_call?: boolean; display_name?: string }) => Promise<boolean>;
  shouldRefreshToken: (token: AppToken) => boolean;
}

export function usePairing({ addLog }: UsePairingOptions): UsePairingResult {
  const [isPaired, setIsPaired] = useState(false);
  const [isPeerConnected, setIsPeerConnected] = useState(false);
  const [lastDeviceSeenAt, setLastDeviceSeenAt] = useState<string | null>(null);
  const [lastDeviceSeenMs, setLastDeviceSeenMs] = useState<number | null>(null);
  const [rtStatus, setRtStatus] = useState<RealtimeStatus>('disconnected');
  const [appToken, setAppToken] = useState<AppToken | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const supabaseAuthRef = useRef<string | null>(null);
  const pairingChannelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);
  const tokenRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const connectInFlightRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const lastPairingSnapshotRef = useRef(0);

  const subscribeToPairingRef = useRef<((code: string, token: string) => Promise<void>) | null>(null);
  const attemptReconnectRef = useRef<((code: string, token: string) => Promise<void>) | null>(null);

  const exchangePairingCode = useCallback(async (code: string): Promise<AppToken | null> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) { addLog('Supabase URL not configured'); return null; }
    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/exchange-pairing-code`,
        { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ pairing_code: code }) 
        },
        API_TIMEOUT_MS
      );
      if (!response.ok) { const error = await response.json(); addLog(`Token exchange failed: ${error.error || 'Unknown error'}`); return null; }
      const token: AppToken = await response.json();
      setAppToken(token);
      addLog('Authentication token obtained');
      return token;
    } catch (err) { addLog('Failed to obtain auth token'); return null; }
  }, [addLog]);

  const shouldRefreshToken = useCallback((token: AppToken): boolean => {
    const expiresAt = new Date(token.expires_at).getTime();
    return (expiresAt - Date.now()) < CONFIG.tokenRefreshThresholdMs;
  }, []);

  const refreshTokenIfNeeded = useCallback(async () => {
    if (!appToken || !pairingCode) return;
    if (shouldRefreshToken(appToken)) { addLog('Refreshing authentication token...'); await exchangePairingCode(pairingCode); }
  }, [appToken, pairingCode, shouldRefreshToken, exchangePairingCode, addLog]);

  const updateAppStateViaEdge = useCallback(async (stateData: { webex_status?: string; camera_on?: boolean; mic_muted?: boolean; in_call?: boolean; display_name?: string }): Promise<boolean> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || !appToken) return false;
    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/update-app-state`,
        { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${appToken.token}` 
          }, 
          body: JSON.stringify(stateData) 
        },
        API_TIMEOUT_MS
      );
      if (!response.ok) { const error = await response.json().catch(() => ({ error: 'Unknown error' })); addLog(`update-app-state failed: ${error.error || response.status}`); return false; }
      const result = await response.json();
      if (typeof result.device_connected === 'boolean') setIsPeerConnected(result.device_connected);
      return true;
    } catch (err) { addLog(`update-app-state error: ${err instanceof Error ? err.message : 'unknown error'}`); return false; }
  }, [appToken, addLog]);

  const getSupabaseClient = useCallback((token: string): SupabaseClient => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase not configured');
    if (supabaseRef.current && supabaseAuthRef.current === token) return supabaseRef.current;
    if (supabaseRef.current) supabaseRef.current.removeAllChannels();
    const client = createClient(supabaseUrl, supabaseAnonKey, { 
      auth: { 
        persistSession: false, 
        autoRefreshToken: false, 
        detectSessionInUrl: false, 
        storageKey: 'sb-embedded-app' 
      }, 
      global: { 
        headers: { Authorization: `Bearer ${token}` } 
      },
      realtime: {
        // Configure realtime options for better connection stability
        params: {
          eventsPerSecond: 10
        },
        timeout: 30000, // 30 second timeout for operations
        heartbeatIntervalMs: 15000, // Send heartbeat every 15 seconds
        reconnectAfterMs: (tries: number) => {
          // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
          return Math.min(1000 * Math.pow(2, tries), 10000);
        }
      }
    });
    client.realtime.setAuth(token);
    supabaseRef.current = client;
    supabaseAuthRef.current = token;
    return client;
  }, []);

  const attemptReconnect = useCallback(async (code: string, token: string) => {
    if (isReconnectingRef.current || reconnectAttemptsRef.current >= CONFIG.reconnectMaxAttempts) { if (reconnectAttemptsRef.current >= CONFIG.reconnectMaxAttempts) { setRtStatus('error'); setConnectionError('Failed to reconnect after multiple attempts'); addLog('Reconnection failed: maximum attempts reached'); isReconnectingRef.current = false; reconnectAttemptsRef.current = 0; } return; }
    isReconnectingRef.current = true; reconnectAttemptsRef.current += 1; setRtStatus('connecting'); addLog(`Reconnection attempt ${reconnectAttemptsRef.current}/${CONFIG.reconnectMaxAttempts}...`);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = setTimeout(async () => {
      try { if (subscribeToPairingRef.current) await subscribeToPairingRef.current(code, token); else throw new Error('Subscribe function not available'); }
      catch (err) { addLog(`Reconnection attempt failed: ${err instanceof Error ? err.message : 'Unknown error'}`); if (reconnectAttemptsRef.current < CONFIG.reconnectMaxAttempts) attemptReconnect(code, token); else { setRtStatus('error'); setConnectionError('Failed to reconnect'); isReconnectingRef.current = false; reconnectAttemptsRef.current = 0; } }
    }, CONFIG.reconnectDelayMs);
  }, [addLog]);
  attemptReconnectRef.current = attemptReconnect;

  const subscribeToPairing = useCallback(async (code: string, token: string) => {
    const supabase = getSupabaseClient(token);
    if (pairingChannelRef.current) { supabase.removeChannel(pairingChannelRef.current); pairingChannelRef.current = null; }
    const { data: heartbeat } = await supabase.schema('display').from('connection_heartbeats').select('device_last_seen, device_connected').eq('pairing_code', code).single();
    if (heartbeat) { const lastSeen = heartbeat.device_last_seen ? new Date(heartbeat.device_last_seen).getTime() : 0; setIsPeerConnected(!!heartbeat.device_connected && Date.now() - lastSeen < 60_000); setLastDeviceSeenAt(heartbeat.device_last_seen ?? null); setLastDeviceSeenMs(lastSeen || null); lastPairingSnapshotRef.current = Date.now(); }
    const channel = supabase.channel(`pairing:${code}`, {
      config: {
        broadcast: { self: true },
        presence: { key: 'app' }
      }
    }).on('postgres_changes', { event: 'UPDATE', schema: 'display', table: 'pairings', filter: `pairing_code=eq.${code}` }, () => { 
      // Pairing update received - connection is alive
      lastPairingSnapshotRef.current = Date.now();
    }).subscribe((status, err) => {
      if (status === 'SUBSCRIBED') { 
        setRtStatus('connected'); 
        reconnectAttemptsRef.current = 0; 
        isReconnectingRef.current = false; 
        if (reconnectTimeoutRef.current) { 
          clearTimeout(reconnectTimeoutRef.current); 
          reconnectTimeoutRef.current = null; 
        }
        addLog('Realtime connection established');
      }
      else if (status === 'CHANNEL_ERROR') {
        const errorMsg = err ? `: ${err.message}` : '';
        addLog(`Realtime channel error${errorMsg}`);
        if (isPaired && !isReconnectingRef.current && attemptReconnectRef.current) { 
          setRtStatus('disconnected'); 
          attemptReconnectRef.current(code, token); 
        } else if (!isPaired) { 
          setRtStatus('error'); 
          setConnectionError(`Realtime channel error${errorMsg}`); 
        }
      }
      else if (status === 'CLOSED') {
        addLog('Realtime connection closed');
        if (isPaired && !isReconnectingRef.current && attemptReconnectRef.current) { 
          setRtStatus('disconnected'); 
          attemptReconnectRef.current(code, token); 
        } else if (!isPaired) { 
          setRtStatus('error'); 
          setConnectionError('Realtime connection closed'); 
        }
      }
      else if (status === 'TIMED_OUT') {
        addLog('Realtime connection timed out');
        if (isPaired && !isReconnectingRef.current && attemptReconnectRef.current) { 
          setRtStatus('disconnected'); 
          attemptReconnectRef.current(code, token); 
        } else if (!isPaired) { 
          setRtStatus('error'); 
          setConnectionError('Realtime connection timed out'); 
        }
      }
    });
    pairingChannelRef.current = channel;
  }, [getSupabaseClient, isPaired, addLog]);
  subscribeToPairingRef.current = subscribeToPairing;

  const refreshPairingSnapshot = useCallback(async (code: string, token: string, reason: string) => {
    try {
      const supabase = getSupabaseClient(token);
      const { data: heartbeat } = await supabase.schema('display').from('connection_heartbeats').select('device_last_seen, device_connected').eq('pairing_code', code).single();
      if (heartbeat) { const lastSeen = heartbeat.device_last_seen ? new Date(heartbeat.device_last_seen).getTime() : 0; setIsPeerConnected(!!heartbeat.device_connected && Date.now() - lastSeen < 60_000); setLastDeviceSeenAt(heartbeat.device_last_seen ?? null); setLastDeviceSeenMs(lastSeen || null); lastPairingSnapshotRef.current = Date.now(); addLog(`Refreshed display status (${reason})`); }
    } catch (err) { addLog(`Failed to refresh display status: ${err instanceof Error ? err.message : 'unknown error'}`); }
  }, [addLog, getSupabaseClient]);

  const handleConnect = useCallback(async () => {
    const code = pairingCode.trim().toUpperCase();
    if (!code) { setConnectionError('Please enter a pairing code'); return; }
    if (connectInFlightRef.current) { addLog('Connect already in progress'); return; }
    connectInFlightRef.current = true; setPairingCode(code); localStorage.setItem(CONFIG.storageKeyPairingCode, code); setConnectionError(null); setRtStatus('connecting'); addLog('Connecting to Supabase...');
    let token = appToken;
    if (!token || shouldRefreshToken(token)) token = await exchangePairingCode(code);
    if (!token) { setRtStatus('error'); setConnectionError('Failed to obtain auth token'); connectInFlightRef.current = false; return; }
    try {
      await subscribeToPairing(code, token.token); setIsPaired(true); setRtStatus('connected'); addLog(`Connected (pairing ${code})`);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = setInterval(() => { if (CONFIG.useEdgeFunctions) updateAppStateViaEdge({}).catch(() => {}); else supabaseRef.current?.schema('display').from('pairings').update({ app_connected: true, app_last_seen: new Date().toISOString() }).eq('pairing_code', code).then(({ error }) => { if (error) addLog(`pairings heartbeat failed: ${error.message}`); }); }, CONFIG.heartbeatIntervalMs);
      
      // Start connection watchdog - force reconnect if no activity for 2 minutes
      if (connectionWatchdogRef.current) clearInterval(connectionWatchdogRef.current);
      connectionWatchdogRef.current = setInterval(() => {
        const timeSinceLastUpdate = Date.now() - lastPairingSnapshotRef.current;
        const staleThreshold = 120000; // 2 minutes
        if (timeSinceLastUpdate > staleThreshold && rtStatus === 'connected' && !isReconnectingRef.current) {
          addLog(`Connection appears stale (${Math.floor(timeSinceLastUpdate / 1000)}s since last update), forcing reconnect...`);
          if (attemptReconnectRef.current && token) {
            attemptReconnectRef.current(code, token.token);
          }
        }
      }, 30000); // Check every 30 seconds
    } catch (err) { setRtStatus('error'); setConnectionError(err instanceof Error ? err.message : 'Failed to connect'); } finally { connectInFlightRef.current = false; }
  }, [addLog, appToken, exchangePairingCode, pairingCode, shouldRefreshToken, subscribeToPairing, updateAppStateViaEdge, rtStatus]);

  const handleDisconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
    if (connectionWatchdogRef.current) { clearInterval(connectionWatchdogRef.current); connectionWatchdogRef.current = null; }
    isReconnectingRef.current = false; reconnectAttemptsRef.current = 0;
    if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); heartbeatIntervalRef.current = null; }
    if (pairingChannelRef.current && supabaseRef.current) { supabaseRef.current.removeChannel(pairingChannelRef.current); pairingChannelRef.current = null; }
    supabaseRef.current = null; localStorage.removeItem(CONFIG.storageKeyPairingCode); setIsPaired(false); setIsPeerConnected(false); setRtStatus('disconnected'); addLog('Disconnected');
  }, [addLog]);

  useEffect(() => { if (appToken && isPaired) { tokenRefreshIntervalRef.current = setInterval(refreshTokenIfNeeded, 60 * 1000); return () => { if (tokenRefreshIntervalRef.current) { clearInterval(tokenRefreshIntervalRef.current); tokenRefreshIntervalRef.current = null; } }; } }, [appToken, isPaired, refreshTokenIfNeeded]);
  useEffect(() => { if (isPaired && rtStatus === 'disconnected' && !isReconnectingRef.current && pairingCode && appToken && attemptReconnectRef.current) { addLog('Connection lost, attempting to reconnect...'); attemptReconnectRef.current(pairingCode, appToken.token); } }, [isPaired, rtStatus, pairingCode, appToken, addLog]);
  useEffect(() => { if (!isPaired || !pairingCode || !appToken || rtStatus !== 'connected') return; const pollInterval = setInterval(() => { refreshPairingSnapshot(pairingCode, appToken.token, 'heartbeat poll').catch(() => {}); }, 10000); return () => clearInterval(pollInterval); }, [isPaired, pairingCode, appToken, rtStatus, refreshPairingSnapshot]);
  useEffect(() => { return () => { if (tokenRefreshIntervalRef.current) clearInterval(tokenRefreshIntervalRef.current); if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current); if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current); if (connectionWatchdogRef.current) clearInterval(connectionWatchdogRef.current); }; }, []);

  return { isPaired, isPeerConnected, lastDeviceSeenAt, lastDeviceSeenMs, rtStatus, appToken, pairingCode, connectionError, setPairingCode, supabaseRef, handleConnect, handleDisconnect, refreshPairingSnapshot, exchangePairingCode, updateAppStateViaEdge, shouldRefreshToken };
}
