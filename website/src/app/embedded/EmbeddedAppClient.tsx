'use client';

import { Alert, Button, Card } from '@/components/ui';
import { useWebexSDK } from '@/hooks';
import type { WebexStatus } from '@/hooks/useWebexSDK';
import { formatStatus } from '@/lib/utils';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Image from 'next/image';
import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import pkg from '../../../package.json';

// Configuration
const CONFIG = {
  storageKeyPairingCode: 'led_matrix_pairing_code',
  storageKeyDebugVisible: 'led_matrix_debug_visible',
  tokenRefreshThresholdMs: 5 * 60 * 1000, // Refresh token 5 minutes before expiry
  heartbeatIntervalMs: 30 * 1000, // Update app_last_seen every 30 seconds
  // Feature flag: use Edge Functions instead of direct DB updates for better security
  useEdgeFunctions: process.env.NEXT_PUBLIC_USE_SUPABASE_EDGE_FUNCTIONS === 'true',
};

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || pkg.version || 'unknown';

// Token exchange types
interface AppToken {
  serial_number: string;
  device_id: string;
  token: string;
  expires_at: string;
}

type TabId = 'status' | 'display' | 'webex' | 'system';

type DebugLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'activity';

// Device config interface matching firmware response
interface DeviceConfig {
  device_name?: string;
  display_name?: string;
  brightness?: number;
  scroll_speed_ms?: number;
  page_interval_ms?: number;
  sensor_page_enabled?: boolean;
  poll_interval?: number;
  time_zone?: string;
  time_format?: string;
  date_format?: string;
  pairing_code?: string;
  mqtt_broker?: string;
  mqtt_port?: number;
  mqtt_username?: string;
  has_mqtt_password?: boolean;
  mqtt_topic?: string;
  display_sensor_mac?: string;
  display_metric?: string;
  sensor_macs?: string;
  sensor_serial?: string;
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
  mac_address?: string;
  serial_number?: string;
  firmware_version?: string;
  free_heap?: number;
  uptime?: number;
  rssi?: number;
  temperature?: number;
  humidity?: number;
}

interface DebugEntry {
  time: string;
  level: DebugLevel;
  message: string;
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
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugEntry[]>([]);
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
  const [scrollSpeedMs, setScrollSpeedMs] = useState(250);
  const [pageIntervalMs, setPageIntervalMs] = useState(5000);
  const [sensorPageEnabled, setSensorPageEnabled] = useState(true);
  const [deviceName, setDeviceName] = useState('');
  const [mqttBroker, setMqttBroker] = useState('');
  const [mqttPort, setMqttPort] = useState(1883);
  const [mqttUsername, setMqttUsername] = useState('');
  const [mqttPassword, setMqttPassword] = useState('');
  const [mqttTopic, setMqttTopic] = useState('meraki/v1/mt/#');
  const [hasMqttPassword, setHasMqttPassword] = useState(false);
  const [displaySensorMac, setDisplaySensorMac] = useState('');
  const [displayMetric, setDisplayMetric] = useState('tvoc');
  const [isSaving, setIsSaving] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);

  // App authentication token state
  const [appToken, setAppToken] = useState<AppToken | null>(null);
  const tokenRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Supabase realtime client state
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const supabaseAuthRef = useRef<string | null>(null);
  const pairingChannelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);
  const [rtStatus, setRtStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectInFlightRef = useRef(false);
  const prevPeerConnectedRef = useRef(false);
  const lastOfflineCommandRef = useRef(0);

  const appendDebugLog = useCallback((level: DebugLevel, message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setDebugLogs(prev => [{ time, level, message }, ...prev].slice(0, 200));
  }, []);

  const formatDebugValue = useCallback((value: unknown): string => {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }, []);

  const formatDebugArgs = useCallback((args: unknown[]): string => {
    return args.map(formatDebugValue).join(' ');
  }, [formatDebugValue]);

  const addLog = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setActivityLog(prev => [{ time, message }, ...prev.slice(0, 29)]);
    appendDebugLog('activity', message);
  }, [appendDebugLog]);

  // Exchange pairing code for app token
  const exchangePairingCode = useCallback(async (code: string): Promise<AppToken | null> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      console.warn('Supabase URL not configured, skipping token exchange');
      return null;
    }

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/exchange-pairing-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pairing_code: code }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Token exchange failed:', error);
        addLog(`Token exchange failed: ${error.error || 'Unknown error'}`);
        return null;
      }

      const token: AppToken = await response.json();
      setAppToken(token);
      addLog('Authentication token obtained');
      return token;
    } catch (err) {
      console.error('Token exchange error:', err);
      addLog('Failed to obtain auth token');
      return null;
    }
  }, [addLog]);

  // Check if token needs refresh
  const shouldRefreshToken = useCallback((token: AppToken): boolean => {
    const expiresAt = new Date(token.expires_at).getTime();
    const now = Date.now();
    return (expiresAt - now) < CONFIG.tokenRefreshThresholdMs;
  }, []);

  // Update app state via Edge Function (more secure than direct DB update)
  const updateAppStateViaEdge = useCallback(async (stateData: {
    webex_status?: string;
    camera_on?: boolean;
    mic_muted?: boolean;
    in_call?: boolean;
    display_name?: string;
  }): Promise<boolean> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || !appToken) {
      return false;
    }

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/update-app-state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${appToken.token}`,
        },
        body: JSON.stringify(stateData),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('update-app-state failed:', error);
        addLog(`update-app-state failed: ${error.error || response.status}`);
        return false;
      }

      const result = await response.json();
      // Update peer connection status from Edge Function response
      if (typeof result.device_connected === 'boolean') {
        setIsPeerConnected(result.device_connected);
      }
      return true;
    } catch (err) {
      console.error('update-app-state error:', err);
      addLog(`update-app-state error: ${err instanceof Error ? err.message : 'unknown error'}`);
      return false;
    }
  }, [appToken, addLog]);

  // Insert command via Edge Function (more secure than direct DB insert)
  const insertCommandViaEdge = useCallback(async (
    command: string,
    payload: Record<string, unknown> = {}
  ): Promise<{ success: boolean; command_id?: string; error?: string }> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || !appToken) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/insert-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${appToken.token}`,
        },
        body: JSON.stringify({ command, payload }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return { success: false, error: error.error || 'Command insert failed' };
      }

      const result = await response.json();
      return { success: true, command_id: result.command_id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }, [appToken]);

  // Refresh token if needed
  const refreshTokenIfNeeded = useCallback(async () => {
    if (!appToken || !pairingCode) return;

    if (shouldRefreshToken(appToken)) {
      addLog('Refreshing authentication token...');
      await exchangePairingCode(pairingCode);
    }
  }, [appToken, pairingCode, shouldRefreshToken, exchangePairingCode, addLog]);

  // Setup token refresh interval
  useEffect(() => {
    if (appToken && isPaired) {
      // Check every minute if token needs refresh
      tokenRefreshIntervalRef.current = setInterval(refreshTokenIfNeeded, 60 * 1000);

      return () => {
        if (tokenRefreshIntervalRef.current) {
          clearInterval(tokenRefreshIntervalRef.current);
          tokenRefreshIntervalRef.current = null;
        }
      };
    }
  }, [appToken, isPaired, refreshTokenIfNeeded]);

  const getSupabaseClient = useCallback((token: string): SupabaseClient => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase not configured (missing NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY)');
    }
    if (supabaseRef.current) {
      if (supabaseAuthRef.current !== token) {
        supabaseAuthRef.current = token;
        supabaseRef.current.realtime.setAuth(token);
      }
      return supabaseRef.current;
    }
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'sb-embedded-app',
      },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    client.realtime.setAuth(token);
    supabaseRef.current = client;
    supabaseAuthRef.current = token;
    return client;
  }, []);

  const subscribeToPairing = useCallback(async (code: string, token: string) => {
    const supabase = getSupabaseClient(token);

    if (pairingChannelRef.current) {
      supabase.removeChannel(pairingChannelRef.current);
      pairingChannelRef.current = null;
    }

    // Fetch initial pairing row
    const { data: pairing } = await supabase
      .schema('display')
      .from('pairings')
      .select('*')
      .eq('pairing_code', code)
      .single();

    if (pairing) {
      const lastSeen = pairing.device_last_seen ? new Date(pairing.device_last_seen).getTime() : 0;
      setIsPeerConnected(!!pairing.device_connected && Date.now() - lastSeen < 60_000);
    }

    const channel = supabase
      .channel(`pairing:${code}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'display', table: 'pairings', filter: `pairing_code=eq.${code}` },
        (evt) => {
          const row = (evt as { new: Record<string, unknown> }).new;
          const lastSeen = row?.device_last_seen ? new Date(String(row.device_last_seen)).getTime() : 0;
          if (typeof row?.device_connected === 'boolean') {
            setIsPeerConnected(!!row.device_connected && Date.now() - lastSeen < 60_000);
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRtStatus('connected');
        } else if (status === 'CHANNEL_ERROR') {
          setRtStatus('error');
          setConnectionError('Realtime subscription error');
        }
      });

    pairingChannelRef.current = channel;
  }, [getSupabaseClient]);

  const sendCommand = useCallback(async (command: string, payload: Record<string, unknown> = {}) => {
    if (!supabaseRef.current || !appToken) {
      throw new Error('Not connected');
    }
    const supabase = supabaseRef.current;
    let commandId: string;

    // Insert command - use Edge Function or direct DB based on feature flag
    if (CONFIG.useEdgeFunctions) {
      const result = await insertCommandViaEdge(command, payload);
      if (!result.success || !result.command_id) {
        throw new Error(result.error || 'Failed to queue command');
      }
      commandId = result.command_id;
    } else {
      // Direct database insert
      const code = pairingCode.trim().toUpperCase();
      const { data: inserted, error } = await supabase
        .schema('display')
        .from('commands')
        .insert({
          pairing_code: code,
          serial_number: appToken.serial_number,
          command,
          payload,
          status: 'pending',
        })
        .select('id')
        .single();

      if (error || !inserted?.id) {
        addLog(`Command insert failed: ${error?.message || 'Unknown error'}`);
        throw new Error(error?.message || 'Failed to queue command');
      }
      commandId = inserted.id as string;
    }

    // Subscribe to command updates (same for both modes)
    return await new Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Command "${command}" timed out`)), 10_000);

      const channel = supabase
        .channel(`cmd:${commandId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'display', table: 'commands', filter: `id=eq.${commandId}` },
          (evt) => {
            const row = (evt as { new: Record<string, unknown> }).new;
            if (row?.status === 'acked') {
              clearTimeout(timeout);
              supabase.removeChannel(channel);
              resolve({ success: true, data: (row.response as Record<string, unknown>) || undefined });
            } else if (row?.status === 'failed' || row?.status === 'expired') {
              clearTimeout(timeout);
              supabase.removeChannel(channel);
              resolve({ success: false, error: String(row.error || `Command ${row.status}`) });
            }
          },
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            clearTimeout(timeout);
            supabase.removeChannel(channel);
            reject(new Error('Failed to subscribe to command updates'));
          }
        });
    });
  }, [addLog, appToken, pairingCode, insertCommandViaEdge]);

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
    if (sdkLoaded) {
      initialize();
    }
  }, [initialize, sdkLoaded]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const pairingParam = params.get('pairing');
    if (pairingParam) {
      const code = pairingParam.trim().toUpperCase();
      if (code) {
        setPairingCode(code);
        localStorage.setItem(CONFIG.storageKeyPairingCode, code);
        autoConnectRef.current = true;
        addLog(`Pairing code detected in URL: ${code}`);
      }
    }
  }, [addLog]);

  useEffect(() => {
    const savedDebugVisible = localStorage.getItem(CONFIG.storageKeyDebugVisible);
    if (savedDebugVisible === 'true') {
      setDebugVisible(true);
    }
    const savedPairingCode = localStorage.getItem(CONFIG.storageKeyPairingCode);
    if (savedPairingCode) {
      setPairingCode(savedPairingCode);
      autoConnectRef.current = true;
    }
  }, [addLog]);

  useEffect(() => {
    localStorage.setItem(CONFIG.storageKeyDebugVisible, debugVisible ? 'true' : 'false');
  }, [debugVisible]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    const wrap = (level: Exclude<DebugLevel, 'activity'>) => (...args: unknown[]) => {
      const handler = original[level] || original.log;
      handler(...args);
      appendDebugLog(level, formatDebugArgs(args));
    };

    console.log = wrap('log');
    console.info = wrap('info');
    console.warn = wrap('warn');
    console.error = wrap('error');
    console.debug = wrap('debug');

    const handleError = (event: ErrorEvent) => {
      appendDebugLog(
        'error',
        `Window error: ${event.message} (${event.filename}:${event.lineno}:${event.colno})`
      );
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      appendDebugLog('error', `Unhandled rejection: ${formatDebugValue(event.reason)}`);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [appendDebugLog, formatDebugArgs, formatDebugValue]);

  useEffect(() => {
    if (autoConnectRef.current && pairingCode && rtStatus === 'disconnected') {
      addLog('Found saved connection, reconnecting...');
      // connect happens via handleConnect (below)
      autoConnectRef.current = false;
    }
  }, [addLog, pairingCode, rtStatus]);

  useEffect(() => {
    if (rtStatus !== 'connected') {
      joinRequestedRef.current = false;
      return;
    }
    if (!pairingCode || joinRequestedRef.current) return;

    const code = pairingCode.toUpperCase();
    const displayName = user?.displayName || manualDisplayName;
    // Mark app connected + set initial state
    supabaseRef.current?.schema('display').from('pairings').update({
      app_connected: true,
      app_last_seen: new Date().toISOString(),
      display_name: displayName,
    }).eq('pairing_code', code).then(() => {}, () => {});

    joinRequestedRef.current = true;
    addLog(`Joined pairing ${code}`);
  }, [rtStatus, pairingCode, user, manualDisplayName, addLog]);

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
        if (config.scroll_speed_ms !== undefined) {
          setScrollSpeedMs(config.scroll_speed_ms);
        }
        if (config.page_interval_ms !== undefined) {
          setPageIntervalMs(config.page_interval_ms);
        }
        if (config.sensor_page_enabled !== undefined) {
          setSensorPageEnabled(config.sensor_page_enabled);
        }
        if (config.device_name) {
          setDeviceName(config.device_name);
        }
        if (config.display_name) {
          setManualDisplayName(config.display_name);
        }
        if (config.mqtt_broker) {
          setMqttBroker(config.mqtt_broker);
        }
        if (config.mqtt_port !== undefined) {
          setMqttPort(config.mqtt_port);
        }
        if (config.mqtt_username !== undefined) {
          setMqttUsername(config.mqtt_username);
        }
        if (config.has_mqtt_password !== undefined) {
          setHasMqttPassword(config.has_mqtt_password);
        }
        if (config.mqtt_topic) {
          setMqttTopic(config.mqtt_topic);
        }
        if (config.display_sensor_mac) {
          setDisplaySensorMac(config.display_sensor_mac);
        }
        if (config.display_metric) {
          setDisplayMetric(config.display_metric);
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

  // Bridge websocket message handling removed (Supabase Realtime is the transport)

  // Fetch config when display connects
  useEffect(() => {
    if (isPeerConnected) {
      fetchDeviceConfig();
      fetchDeviceStatus();
    }
  }, [isPeerConnected, fetchDeviceConfig, fetchDeviceStatus]);

  // Request status update when device appears offline (via realtime command)
  useEffect(() => {
    const OFFLINE_COMMAND_COOLDOWN = 10000; // Don't spam commands - wait 10 seconds between requests

    // Only act if we're paired and realtime is connected
    if (!isPaired || rtStatus !== 'connected') {
      prevPeerConnectedRef.current = isPeerConnected;
      return;
    }

    // Device just went offline (transitioned from connected to disconnected)
    if (prevPeerConnectedRef.current && !isPeerConnected) {
      const now = Date.now();
      
      // Rate limit offline commands
      if (now - lastOfflineCommandRef.current < OFFLINE_COMMAND_COOLDOWN) {
        addLog('Device offline - skipping command (rate limited)');
        prevPeerConnectedRef.current = isPeerConnected;
        return;
      }

      lastOfflineCommandRef.current = now;
      addLog('Device appears offline - requesting status update via get_telemetry...');
      
      // Send get_telemetry command to request device state update
      // This will trigger postDeviceState() on firmware, updating device_last_seen
      sendCommand('get_telemetry', {}).then(
        (result) => {
          if (result.success) {
            addLog('Status update received from device');
            // Device should now appear online if it responds (device_last_seen will be updated)
          } else {
            addLog(`Status request failed: ${result.error || 'Unknown error'}`);
          }
        },
        (error) => {
          addLog(`Status request error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      );
    }

    // Device just came back online - reset cooldown so we can request status again if needed
    if (!prevPeerConnectedRef.current && isPeerConnected) {
      lastOfflineCommandRef.current = 0;
    }

    // Update previous state
    prevPeerConnectedRef.current = isPeerConnected;
  }, [isPeerConnected, isPaired, rtStatus, sendCommand, addLog]);

  useEffect(() => {
    if (rtStatus === 'disconnected') {
      setShowSetup(true);
      setIsPaired(false);
      setIsPeerConnected(false);
    }
  }, [rtStatus]);

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

  // Push current status into display.pairings (cached + realtime)
  // Uses Edge Function when feature flag is enabled for better security/rate limiting
  useEffect(() => {
    if (rtStatus !== 'connected' || !isPaired) return;
    const code = pairingCode.trim().toUpperCase();
    if (!code) return;

    if (CONFIG.useEdgeFunctions) {
      // Use Edge Function for status update (includes rate limiting)
      updateAppStateViaEdge({
        webex_status: statusToDisplay,
        camera_on: cameraOn,
        mic_muted: micMuted,
        in_call: inCall,
        display_name: displayName,
      }).catch(() => {});
    } else {
      // Direct database update (fallback)
      const supabase = supabaseRef.current;
      if (!supabase) return;
      supabase
        .schema('display')
        .from('pairings')
        .update({
          app_connected: true,
          app_last_seen: new Date().toISOString(),
          webex_status: statusToDisplay,
          camera_on: cameraOn,
          mic_muted: micMuted,
          in_call: inCall,
          display_name: displayName,
        })
        .eq('pairing_code', code)
        .then(({ error }) => {
          if (error) {
            addLog(`pairings update failed: ${error.message}`);
          }
        });
    }
  }, [rtStatus, isPaired, pairingCode, statusToDisplay, cameraOn, micMuted, inCall, displayName, updateAppStateViaEdge]);

  const handleConnect = useCallback(async () => {
    const code = pairingCode.trim().toUpperCase();
    if (!code) {
      setConnectionError('Please enter a pairing code');
      return;
    }

    if (connectInFlightRef.current) {
      addLog('Connect already in progress, skipping duplicate request');
      return;
    }
    connectInFlightRef.current = true;

    setPairingCode(code);
    localStorage.setItem(CONFIG.storageKeyPairingCode, code);
    setConnectionError(null);
    setRtStatus('connecting');
    addLog('Connecting to Supabase...');

    let token = appToken;
    if (!token || shouldRefreshToken(token)) {
      token = await exchangePairingCode(code);
    }
    if (!token) {
      setRtStatus('error');
      setConnectionError('Failed to obtain auth token');
      connectInFlightRef.current = false;
      return;
    }

    try {
      await subscribeToPairing(code, token.token);
      setIsPaired(true);
      setShowSetup(false);
      setRtStatus('connected');
      addLog(`Connected (pairing ${code})`);

      // Heartbeat: keep app_connected and app_last_seen fresh
      // Uses Edge Function when feature flag is enabled for consistent rate limiting
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      heartbeatIntervalRef.current = setInterval(() => {
        if (CONFIG.useEdgeFunctions) {
          // Edge Function heartbeat - just send empty update to refresh app_last_seen
          updateAppStateViaEdge({}).catch(() => {});
        } else {
          // Direct database heartbeat
          supabaseRef.current?.schema('display').from('pairings').update({
            app_connected: true,
            app_last_seen: new Date().toISOString(),
          }).eq('pairing_code', code).then(({ error }) => {
            if (error) {
              addLog(`pairings heartbeat failed: ${error.message}`);
            }
          });
        }
      }, CONFIG.heartbeatIntervalMs);
    } catch (err) {
      setRtStatus('error');
      setConnectionError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      connectInFlightRef.current = false;
    }
  }, [addLog, appToken, exchangePairingCode, pairingCode, shouldRefreshToken, subscribeToPairing, updateAppStateViaEdge]);

  const handleDisconnect = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (pairingChannelRef.current && supabaseRef.current) {
      supabaseRef.current.removeChannel(pairingChannelRef.current);
      pairingChannelRef.current = null;
    }
    supabaseRef.current = null;

    localStorage.removeItem(CONFIG.storageKeyPairingCode);
    setShowSetup(true);
    setIsPaired(false);
    setIsPeerConnected(false);
    setRtStatus('disconnected');
    addLog('Disconnected');
  }, [addLog]);

  const handleCopyDebug = useCallback(async () => {
    if (!navigator.clipboard) {
      addLog('Clipboard not available in this context');
      return;
    }
    try {
      const payload = debugLogs
        .slice()
        .reverse()
        .map(entry => `[${entry.time}] [${entry.level}] ${entry.message}`)
        .join('\n');
      await navigator.clipboard.writeText(payload);
      addLog('Debug log copied to clipboard');
    } catch (error) {
      addLog(`Failed to copy debug log: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [debugLogs, addLog]);

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
      const configPayload: Record<string, unknown> = {
        device_name: deviceName,
        display_name: manualDisplayName,
        brightness,
        scroll_speed_ms: scrollSpeedMs,
        page_interval_ms: pageIntervalMs,
        sensor_page_enabled: sensorPageEnabled,
      };

      // MQTT settings (only include if broker is set)
      if (mqttBroker.trim()) {
        configPayload.mqtt_broker = mqttBroker.trim();
        configPayload.mqtt_port = mqttPort;
        // Always send username (even if empty, to allow clearing it)
        // This ensures username is updated if user cleared it
        configPayload.mqtt_username = mqttUsername;
        // Only send password if user entered a new one (not empty)
        // If empty, password field is omitted and current password is preserved
        if (mqttPassword.trim()) {
          configPayload.mqtt_password = mqttPassword.trim();
        }
        // Always send topic to ensure it's updated
        configPayload.mqtt_topic = mqttTopic.trim() || 'meraki/v1/mt/#';
      }

      // Sensor settings
      if (displaySensorMac.trim()) {
        configPayload.display_sensor_mac = displaySensorMac.trim();
      }
      if (displayMetric) {
        configPayload.display_metric = displayMetric;
      }

      const response = await sendCommand('set_config', configPayload);

      if (response.success) {
        addLog('Settings saved successfully');
        // Update local config from response
        if (response.data) {
          const config = response.data as unknown as DeviceConfig;
          setDeviceConfig(config);
          // Update local state from response
          if (config.brightness !== undefined) setBrightness(config.brightness);
          if (config.scroll_speed_ms !== undefined) setScrollSpeedMs(config.scroll_speed_ms);
          if (config.page_interval_ms !== undefined) setPageIntervalMs(config.page_interval_ms);
          if (config.sensor_page_enabled !== undefined) setSensorPageEnabled(config.sensor_page_enabled);
          if (config.has_mqtt_password !== undefined) setHasMqttPassword(config.has_mqtt_password);
          // Clear password field after save (don't keep it in memory)
          setMqttPassword('');
        }
      } else {
        addLog(`Failed to save: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      addLog(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  }, [isPeerConnected, sendCommand, deviceName, manualDisplayName, brightness, scrollSpeedMs, pageIntervalMs, sensorPageEnabled, mqttBroker, mqttPort, mqttUsername, mqttPassword, mqttTopic, displaySensorMac, displayMetric, addLog]);

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

  const isBridgeConnected = rtStatus === 'connected';
  const connectionLabel = isBridgeConnected
    ? isPeerConnected
      ? 'Connected'
      : 'Waiting for display'
    : rtStatus === 'connecting'
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
        src="https://unpkg.com/@webex/embedded-app-sdk@latest"
        strategy="afterInteractive"
        onLoad={() => setSdkLoaded(true)}
        onError={(e) => {
          console.error('Failed to load Webex SDK:', e);
          addLog('Failed to load Webex SDK');
        }}
      />

      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="max-w-2xl mx-auto p-4">
          {/* Header */}
          <header className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Image src="/icon-512.png" alt="LED Matrix Display" width={40} height={40} className="rounded-lg" />
              <h1 className="text-xl font-semibold">LED Matrix Display</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-2 text-sm ${connectionTextColor}`}>
                <span className={`w-2 h-2 rounded-full ${connectionDotColor}`} />
                <span>{connectionLabel}</span>
              </div>
              <Button
                size="sm"
                variant={debugVisible ? 'success' : 'default'}
                onClick={() => setDebugVisible(prev => !prev)}
              >
                {debugVisible ? 'Debug On' : 'Debug Off'}
              </Button>
            </div>
          </header>

          {/* Setup Screen */}
          {showSetup && (
            <Card className="mb-6">
              <h2 className="text-lg font-semibold mb-4">Connect to Your Display</h2>
              <p className="text-sm text-[var(--color-text-muted)] mb-6">
                Connect using Supabase Realtime for status sync and configuration commands.
              </p>

              <div className="space-y-4">
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
                  Connect
                </Button>
              </div>

              <div className="mt-6 p-4 bg-[var(--color-surface-alt)] rounded-lg">
                <h3 className="font-medium mb-2">How it works:</h3>
                <ol className="text-sm text-[var(--color-text-muted)] list-decimal list-inside space-y-1">
                  <li>Your LED display will show a 6-character pairing code</li>
                  <li>Enter the pairing code above</li>
                  <li>Status and commands are synced via Supabase (cached in the database)</li>
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
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Scroll Speed: {scrollSpeedMs}ms
                      </label>
                      <input
                        type="range"
                        min="50"
                        max="1000"
                        step="50"
                        value={scrollSpeedMs}
                        onChange={(e) => setScrollSpeedMs(parseInt(e.target.value, 10))}
                        className="w-full"
                        disabled={!isPeerConnected}
                      />
                      <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                        <span>Fast (50ms)</span>
                        <span>Slow (1000ms)</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Page Rotation Interval: {pageIntervalMs / 1000}s
                      </label>
                      <input
                        type="range"
                        min="2000"
                        max="30000"
                        step="1000"
                        value={pageIntervalMs}
                        onChange={(e) => setPageIntervalMs(parseInt(e.target.value, 10))}
                        className="w-full"
                        disabled={!isPeerConnected}
                      />
                      <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                        <span>2s</span>
                        <span>30s</span>
                      </div>
                    </div>
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium mb-2">
                        <input
                          type="checkbox"
                          checked={sensorPageEnabled}
                          onChange={(e) => setSensorPageEnabled(e.target.checked)}
                          disabled={!isPeerConnected}
                          className="rounded"
                        />
                        Enable Sensor Page Rotation
                      </label>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Show sensor data page when rotating between status pages
                      </p>
                    </div>

                    <hr className="my-6 border-[var(--color-border)]" />

                    <h3 className="font-medium mb-4">MQTT Settings</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">MQTT Broker</label>
                        <input
                          type="text"
                          placeholder="mqtt.example.com"
                          value={mqttBroker}
                          onChange={(e) => setMqttBroker(e.target.value)}
                          className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                          disabled={!isPeerConnected}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">Port</label>
                          <input
                            type="number"
                            min="1"
                            max="65535"
                            value={mqttPort}
                            onChange={(e) => setMqttPort(parseInt(e.target.value, 10) || 1883)}
                            className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                            disabled={!isPeerConnected}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">Username</label>
                          <input
                            type="text"
                            placeholder="Optional"
                            value={mqttUsername}
                            onChange={(e) => setMqttUsername(e.target.value)}
                            className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                            disabled={!isPeerConnected}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          Password
                          {hasMqttPassword && (
                            <span className="ml-2 text-xs text-[var(--color-text-muted)] font-normal">
                              (Password is set)
                            </span>
                          )}
                        </label>
                        <input
                          type="password"
                          placeholder={hasMqttPassword ? "Enter new password to change" : "Enter password"}
                          value={mqttPassword}
                          onChange={(e) => setMqttPassword(e.target.value)}
                          className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                          disabled={!isPeerConnected}
                        />
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                          {hasMqttPassword 
                            ? "Leave empty to keep current password, or enter new password to change it"
                            : "Password will be set when you save"}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Topic</label>
                        <input
                          type="text"
                          placeholder="meraki/v1/mt/#"
                          value={mqttTopic}
                          onChange={(e) => setMqttTopic(e.target.value)}
                          className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                          disabled={!isPeerConnected}
                        />
                      </div>
                    </div>

                    <hr className="my-6 border-[var(--color-border)]" />

                    <h3 className="font-medium mb-4">Sensor Settings</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Display Sensor MAC</label>
                        <input
                          type="text"
                          placeholder="AA:BB:CC:DD:EE:FF"
                          value={displaySensorMac}
                          onChange={(e) => setDisplaySensorMac(e.target.value)}
                          className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] font-mono"
                          disabled={!isPeerConnected}
                        />
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                          Specific sensor MAC to display (leave empty to use first available)
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Display Metric</label>
                        <select
                          value={displayMetric}
                          onChange={(e) => setDisplayMetric(e.target.value)}
                          className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                          disabled={!isPeerConnected}
                        >
                          <option value="tvoc">TVOC</option>
                          <option value="co2">CO2</option>
                          <option value="pm2_5">PM2.5</option>
                          <option value="noise">Noise</option>
                        </select>
                      </div>
                    </div>

                    <Button
                      variant="primary"
                      onClick={handleSaveSettings}
                      disabled={!isPeerConnected || isSaving}
                      className="mt-6"
                    >
                      {isSaving ? 'Saving...' : 'Save All Settings'}
                    </Button>
                  </div>

                  <hr className="my-6 border-[var(--color-border)]" />

                  <h3 className="font-medium mb-4">Connected Display</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--color-text-muted)]">Serial Number:</span>
                      <span className="ml-2 font-mono">{deviceStatus.serial_number || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-muted)]">Pairing Code:</span>
                      <span className="ml-2 font-mono">{pairingCode}</span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-muted)]">IP Address:</span>
                      <span className="ml-2">{deviceStatus.ip_address || 'Unknown'}</span>
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
                        ? user
                          ? `Connected as ${displayName}.`
                          : 'Connected to Webex SDK. Status detection is active (user info unavailable in this context).'
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
                        <span className="text-[var(--color-text-muted)]">Serial Number:</span>
                        <span className="ml-2 font-mono">{deviceStatus.serial_number || 'Unknown'}</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)]">App Version:</span>
                        <span className="ml-2">v{APP_VERSION}</span>
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
            <span className="ml-2">1.5.6</span>
          </footer>
        </div>

        {debugVisible && (
          <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-[520px] z-50">
            <Card className="shadow-lg border border-[var(--color-border)] bg-[var(--color-bg-card)]">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold">Debug Console</div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="default" onClick={() => setDebugLogs([])}>
                    Clear
                  </Button>
                  <Button size="sm" variant="default" onClick={handleCopyDebug}>
                    Copy
                  </Button>
                  <Button size="sm" variant="warning" onClick={() => setDebugVisible(false)}>
                    Close
                  </Button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2 font-mono text-xs whitespace-pre-wrap">
                {debugLogs.length === 0 && (
                  <div className="text-[var(--color-text-muted)]">No logs captured yet.</div>
                )}
                {debugLogs.map((entry, index) => (
                  <div key={`${entry.time}-${index}`} className="flex gap-2">
                    <span className="text-[var(--color-text-muted)]">[{entry.time}]</span>
                    <span
                      className={
                        entry.level === 'error'
                          ? 'text-danger'
                          : entry.level === 'warn'
                            ? 'text-warning'
                            : entry.level === 'info'
                              ? 'text-primary'
                              : entry.level === 'activity'
                                ? 'text-success'
                              : 'text-[var(--color-text)]'
                      }
                    >
                      {entry.level}
                    </span>
                    <span className="flex-1">{entry.message}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
