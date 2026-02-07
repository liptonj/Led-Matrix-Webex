'use client';

import { getSupabaseClient } from '@/lib/supabaseClient';
import { type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG } from '../constants';
import type { RealtimeStatus, WebexStatusBroadcast } from '../types';

const API_TIMEOUT_MS = 15000;

export interface UsePairingOptions {
  addLog: (message: string) => void;
}

export interface UserDevice {
  device_uuid: string;
  serial_number: string;
  display_name?: string;
  last_seen?: string;
}

export interface UsePairingResult {
  isPaired: boolean;
  isPeerConnected: boolean;
  lastDeviceSeenAt: string | null;
  lastDeviceSeenMs: number | null;
  rtStatus: RealtimeStatus;
  connectionError: string | null;
  supabaseRef: React.MutableRefObject<SupabaseClient | null>;
  handleConnect: () => Promise<void>;
  handleDisconnect: () => void;
  refreshPairingSnapshot: (deviceUuid: string, reason: string) => Promise<void>;
  updatePairingState: (stateData: { webex_status?: string; camera_on?: boolean; mic_muted?: boolean; in_call?: boolean; display_name?: string }) => Promise<boolean>;
  broadcastToUserChannel: (event: string, payload: Record<string, unknown>) => Promise<boolean>;
  lastBroadcastConfig: Record<string, unknown> | null;
  requestDeviceConfig: () => Promise<boolean>;
  // Session-related exports
  session: Session | null;
  userDevices: UserDevice[];
  selectedDeviceUuid: string | null;
  setSelectedDeviceUuid: (deviceUuid: string) => void;
  isLoggedIn: boolean;
}

export function usePairing({ addLog }: UsePairingOptions): UsePairingResult {
  const [isPaired, setIsPaired] = useState(false);
  const [isPeerConnected, setIsPeerConnected] = useState(false);
  const [lastDeviceSeenAt, setLastDeviceSeenAt] = useState<string | null>(null);
  const [lastDeviceSeenMs, setLastDeviceSeenMs] = useState<number | null>(null);
  const [rtStatus, setRtStatus] = useState<RealtimeStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  // Session-related state
  const [session, setSession] = useState<Session | null>(null);
  const [userDevices, setUserDevices] = useState<UserDevice[]>([]);
  const [selectedDeviceUuid, setSelectedDeviceUuid] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [lastBroadcastConfig, setLastBroadcastConfig] = useState<Record<string, unknown> | null>(null);

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const userChannelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const connectInFlightRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const lastPairingSnapshotRef = useRef(0);

  const subscribeToUserChannelRef = useRef<((userId: string) => Promise<void>) | null>(null);
  const attemptReconnectRef = useRef<((userId: string) => Promise<void>) | null>(null);


  const updatePairingState = useCallback(async (stateData: { 
    webex_status?: string;
    camera_on?: boolean;
    mic_muted?: boolean;
    in_call?: boolean;
    display_name?: string;
  }): Promise<boolean> => {
    if (!session || !selectedDeviceUuid || !supabaseRef.current) return false;
    try {
      const { error } = await supabaseRef.current
        .schema('display')
        .from('pairings')
        .update(stateData)
        .eq('device_uuid', selectedDeviceUuid);
      if (error) { addLog(`Pairing update failed: ${error.message}`); return false; }
      return true;
    } catch (err) { addLog(`Pairing update error: ${err instanceof Error ? err.message : 'unknown'}`); return false; }
  }, [session, selectedDeviceUuid, supabaseRef, addLog]);

  const broadcastToUserChannel = useCallback(async (event: string, payload: Record<string, unknown>): Promise<boolean> => {
    const channel = userChannelRef.current;
    if (!channel) {
      console.warn('[usePairing] No active user channel for broadcast');
      return false;
    }
    try {
      const sendResult = await channel.send({
        type: 'broadcast',
        event,
        payload,
      });
      if (sendResult !== 'ok') {
        addLog(`[usePairing] Broadcast failed: ${sendResult}`);
        return false;
      }
      return true;
    } catch (error) {
      addLog(`[usePairing] Broadcast error: ${error instanceof Error ? error.message : 'unknown error'}`);
      return false;
    }
  }, [addLog]);

  const requestDeviceConfig = useCallback(async (): Promise<boolean> => {
    if (!selectedDeviceUuid) return false;
    return broadcastToUserChannel('request_config', { device_uuid: selectedDeviceUuid });
  }, [selectedDeviceUuid, broadcastToUserChannel]);

  // Initialize Supabase client with session
  useEffect(() => {
    if (session && !supabaseRef.current) {
      const supabase = getSupabaseClient();
      supabaseRef.current = supabase;
    } else if (!session && supabaseRef.current) {
      // Clean up when session is lost
      if (userChannelRef.current) {
        supabaseRef.current.removeChannel(userChannelRef.current);
        userChannelRef.current = null;
      }
      supabaseRef.current = null;
    }
  }, [session]);

  const attemptReconnect = useCallback(async (userId: string) => {
    if (isReconnectingRef.current || reconnectAttemptsRef.current >= CONFIG.reconnectMaxAttempts) { 
      if (reconnectAttemptsRef.current >= CONFIG.reconnectMaxAttempts) { 
        setRtStatus('error'); 
        setConnectionError('Failed to reconnect after multiple attempts'); 
        addLog('Reconnection failed: maximum attempts reached'); 
        isReconnectingRef.current = false; 
        reconnectAttemptsRef.current = 0; 
      } 
      return; 
    }
    isReconnectingRef.current = true; 
    reconnectAttemptsRef.current += 1; 
    setRtStatus('connecting'); 
    addLog(`Reconnection attempt ${reconnectAttemptsRef.current}/${CONFIG.reconnectMaxAttempts}...`);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = setTimeout(async () => {
      try { 
        if (subscribeToUserChannelRef.current) {
          await subscribeToUserChannelRef.current(userId);
        } else {
          throw new Error('Subscribe function not available');
        }
      } catch (err) { 
        addLog(`Reconnection attempt failed: ${err instanceof Error ? err.message : 'Unknown error'}`); 
        if (reconnectAttemptsRef.current < CONFIG.reconnectMaxAttempts) {
          attemptReconnect(userId);
        } else { 
          setRtStatus('error'); 
          setConnectionError('Failed to reconnect'); 
          isReconnectingRef.current = false; 
          reconnectAttemptsRef.current = 0; 
        } 
      }
    }, CONFIG.reconnectDelayMs);
  }, [addLog]);
  attemptReconnectRef.current = attemptReconnect;

  const refreshPairingSnapshot = useCallback(async (deviceUuid: string, reason: string) => {
    if (!supabaseRef.current || !deviceUuid) return;
    try {
      // Query devices table by UUID to get pairing_code (always exists for assigned devices)
      // This avoids the 406 error when no pairing row exists yet
      const { data: device, error: deviceError } = await supabaseRef.current
        .schema('display')
        .from('devices')
        .select('pairing_code, last_seen')
        .eq('id', deviceUuid)
        .maybeSingle();

      if (!device || deviceError) {
        addLog(`No device found for UUID ${deviceUuid.slice(0, 8)}...`);
        setIsPeerConnected(false);
        return;
      }

      // Query pairing by pairing_code (may not exist yet if device hasn't connected)
      const { data: pairing } = await supabaseRef.current
        .schema('display')
        .from('pairings')
        .select('device_last_seen, device_connected')
        .eq('pairing_code', device.pairing_code)
        .maybeSingle();

      if (pairing) {
        const staleThresholdMs = 60_000;
        const lastSeen = pairing.device_last_seen 
          ? new Date(pairing.device_last_seen).getTime() 
          : 0;
        const isStale = Date.now() - lastSeen > staleThresholdMs;
        
        setIsPeerConnected(!!pairing.device_connected && !isStale);
        setLastDeviceSeenAt(pairing.device_last_seen ?? null);
        setLastDeviceSeenMs(lastSeen || null);
        lastPairingSnapshotRef.current = Date.now();
        addLog(`[${reason}] device_connected=${pairing.device_connected}, stale=${isStale}`);
      } else {
        // No pairing yet - device hasn't connected
        setIsPeerConnected(false);
        setLastDeviceSeenAt(null);
        setLastDeviceSeenMs(null);
        addLog(`[${reason}] No pairing found - device hasn't connected yet`);
      }
    } catch (err) { 
      addLog(`Failed to refresh display status: ${err instanceof Error ? err.message : 'unknown error'}`); 
    }
  }, [addLog]);

  const subscribeToUserChannel = useCallback(async (userId: string) => {
    if (!supabaseRef.current) {
      const supabase = getSupabaseClient();
      supabaseRef.current = supabase;
    }
    const supabase = supabaseRef.current;
    
    // Remove existing channel if any
    if (userChannelRef.current) { 
      supabase.removeChannel(userChannelRef.current); 
      userChannelRef.current = null; 
    }
    
    // Refresh device connection status for selected device
    if (selectedDeviceUuid) {
      await refreshPairingSnapshot(selectedDeviceUuid, 'initial connection');
    }
    
    const channelName = `user:${userId}`;
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: true },
        presence: { key: 'app' },
        private: true
      }
    })
    .on('broadcast', { event: 'webex_status' }, (payload: { payload: WebexStatusBroadcast }) => {
      // Handle webex_status broadcast events
      const broadcast = payload.payload;
      if (broadcast.device_uuid === selectedDeviceUuid) {
        lastPairingSnapshotRef.current = Date.now();
        addLog(`Received webex_status broadcast: ${broadcast.webex_status}`);
      }
    })
    .on('broadcast', { event: 'command_ack' }, async (payload: { payload: { command_id: string; status: 'acked' | 'failed'; response?: Record<string, unknown>; error?: string } }) => {
      // Handle command_ack broadcast events - update command status in DB
      const ack = payload.payload;
      if (!supabaseRef.current || !ack.command_id) return;
      
      try {
        const updateData: { status: 'acked' | 'failed'; acked_at?: string; response?: Record<string, unknown>; error?: string } = {
          status: ack.status,
        };
        
        if (ack.status === 'acked') {
          updateData.acked_at = new Date().toISOString();
          if (ack.response) {
            updateData.response = ack.response;
          }
        } else if (ack.status === 'failed') {
          updateData.error = ack.error || 'Command failed';
        }
        
        const { error: updateError } = await supabaseRef.current
          .schema('display')
          .from('commands')
          .update(updateData)
          .eq('id', ack.command_id);
        
        if (updateError) {
          addLog(`Failed to update command ${ack.command_id}: ${updateError.message}`);
        } else {
          addLog(`Command ${ack.command_id} ${ack.status}`);
        }
      } catch (err) {
        addLog(`Error handling command_ack: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    })
    .on('broadcast', { event: 'device_telemetry' }, (payload: { payload: { device_uuid: string; rssi?: number; free_heap?: number; uptime?: number; firmware_version?: string; temperature?: number; ssid?: string; timestamp?: number } }) => {
      const telemetry = payload.payload;
      if (telemetry.device_uuid === selectedDeviceUuid) {
        lastPairingSnapshotRef.current = Date.now();
        setLastDeviceSeenMs(Date.now());
        setIsPeerConnected(true);
        setLastDeviceSeenAt(new Date().toISOString());
      }
    })
    .on('broadcast', { event: 'device_config' }, (payload: { payload: { device_uuid: string; [key: string]: unknown } }) => {
      const config = payload.payload;
      if (config.device_uuid === selectedDeviceUuid) {
        lastPairingSnapshotRef.current = Date.now();
        setLastDeviceSeenMs(Date.now());
        setIsPeerConnected(true);
        setLastBroadcastConfig(config);
        addLog('Received device_config broadcast');
      }
    })
    .subscribe((status, err) => {
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
          attemptReconnectRef.current(userId); 
        } else if (!isPaired) { 
          setRtStatus('error'); 
          setConnectionError(`Realtime channel error${errorMsg}`); 
        }
      }
      else if (status === 'CLOSED') {
        addLog('Realtime connection closed');
        if (isPaired && !isReconnectingRef.current && attemptReconnectRef.current) { 
          setRtStatus('disconnected'); 
          attemptReconnectRef.current(userId); 
        } else if (!isPaired) { 
          setRtStatus('error'); 
          setConnectionError('Realtime connection closed'); 
        }
      }
      else if (status === 'TIMED_OUT') {
        addLog('Realtime connection timed out');
        if (isPaired && !isReconnectingRef.current && attemptReconnectRef.current) { 
          setRtStatus('disconnected'); 
          attemptReconnectRef.current(userId); 
        } else if (!isPaired) { 
          setRtStatus('error'); 
          setConnectionError('Realtime connection timed out'); 
        }
      }
    });
    userChannelRef.current = channel;
  }, [isPaired, selectedDeviceUuid, refreshPairingSnapshot, addLog]);
  subscribeToUserChannelRef.current = subscribeToUserChannel;

  const handleConnect = useCallback(async () => {
    if (!session?.user?.id) {
      setConnectionError('Please log in first');
      return;
    }
    if (connectInFlightRef.current) {
      addLog('Connect already in progress');
      return;
    }
    if (!selectedDeviceUuid) {
      setConnectionError('Please select a device');
      return;
    }
    
    connectInFlightRef.current = true;
    setConnectionError(null);
    setRtStatus('connecting');
    addLog('Connecting to Supabase...');
    
    try {
      const userId = session.user.id;
      await subscribeToUserChannel(userId);
      setIsPaired(true);
      setRtStatus('connected');
      addLog(`Connected to user channel`);
      
      // Start heartbeat interval - write to connection_heartbeats table
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = setInterval(async () => {
        if (!supabaseRef.current || !selectedDeviceUuid) return;
        try {
          await supabaseRef.current.schema('display').from('connection_heartbeats')
            .upsert({
              device_uuid: selectedDeviceUuid,
              app_last_seen: new Date().toISOString(),
              app_connected: true
            }, { onConflict: 'device_uuid' });
        } catch (error) {
          // Silently fail heartbeat update
        }
      }, CONFIG.heartbeatIntervalMs);
      
      // Start connection watchdog - force reconnect if no activity for 2 minutes
      if (connectionWatchdogRef.current) clearInterval(connectionWatchdogRef.current);
      connectionWatchdogRef.current = setInterval(() => {
        const timeSinceLastUpdate = Date.now() - lastPairingSnapshotRef.current;
        const staleThreshold = 120000; // 2 minutes
        if (timeSinceLastUpdate > staleThreshold && rtStatus === 'connected' && !isReconnectingRef.current) {
          addLog(`Connection appears stale (${Math.floor(timeSinceLastUpdate / 1000)}s since last update), forcing reconnect...`);
          if (attemptReconnectRef.current) {
            attemptReconnectRef.current(userId);
          }
        }
      }, 30000); // Check every 30 seconds
    } catch (err) {
      setRtStatus('error');
      setConnectionError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      connectInFlightRef.current = false;
    }
  }, [addLog, session, selectedDeviceUuid, subscribeToUserChannel, rtStatus]);

  const handleDisconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (connectionWatchdogRef.current) {
      clearInterval(connectionWatchdogRef.current);
      connectionWatchdogRef.current = null;
    }
    isReconnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (userChannelRef.current && supabaseRef.current) {
      supabaseRef.current.removeChannel(userChannelRef.current);
      userChannelRef.current = null;
    }
    setIsPaired(false);
    setIsPeerConnected(false);
    setRtStatus('disconnected');
    addLog('Disconnected');
  }, [addLog]);

  // Auto-reconnect when connection is lost
  useEffect(() => {
    if (isPaired && rtStatus === 'disconnected' && !isReconnectingRef.current && session?.user?.id && attemptReconnectRef.current) {
      addLog('Connection lost, attempting to reconnect...');
      attemptReconnectRef.current(session.user.id);
    }
  }, [isPaired, rtStatus, session?.user?.id, addLog]);
  
  // Poll device status when connected
  useEffect(() => {
    if (!isPaired || !selectedDeviceUuid || rtStatus !== 'connected') return;
    const pollInterval = setInterval(() => {
      refreshPairingSnapshot(selectedDeviceUuid, 'heartbeat poll').catch(() => {});
    }, 10000);
    return () => clearInterval(pollInterval);
  }, [isPaired, selectedDeviceUuid, rtStatus, refreshPairingSnapshot]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (connectionWatchdogRef.current) clearInterval(connectionWatchdogRef.current);
    };
  }, []);

  // Check for existing Supabase session on mount and listen for auth changes
  useEffect(() => {
    const supabase = getSupabaseClient();
    
    const checkSession = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) {
          setSession(currentSession);
          setIsLoggedIn(true);
          addLog('User session found');
          
          // Fetch user's devices - select device_uuid as primary identifier
          const { data, error } = await supabase
            .schema('display')
            .from('user_devices')
            .select('device_uuid, serial_number, devices!user_devices_device_uuid_fkey(display_name, last_seen)')
            .eq('user_id', currentSession.user.id);
          
          if (error) {
            addLog(`Failed to fetch devices: ${error.message}`);
          } else if (data) {
            // Transform nested devices data to flat structure
            const transformedDevices: UserDevice[] = data.map((item: any) => ({
              device_uuid: item.device_uuid || item.serial_number, // Fallback to serial_number if uuid missing
              serial_number: item.serial_number,
              display_name: item.devices?.display_name,
              last_seen: item.devices?.last_seen,
            }));
            setUserDevices(transformedDevices);
            addLog(`Found ${transformedDevices.length} devices`);
            
            // Auto-select first device if none selected
            const firstDevice = transformedDevices[0];
            if (!selectedDeviceUuid && firstDevice) {
              setSelectedDeviceUuid(firstDevice.device_uuid);
            }
          }
        } else {
          setIsLoggedIn(false);
          setSession(null);
          setUserDevices([]);
          setSelectedDeviceUuid(null);
          handleDisconnect();
        }
      } catch (err) {
        addLog(`Failed to check session: ${err instanceof Error ? err.message : 'unknown error'}`);
        setIsLoggedIn(false);
        setSession(null);
        setUserDevices([]);
        setSelectedDeviceUuid(null);
      }
    };
    
    checkSession();
    
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setSession(session);
        setIsLoggedIn(true);
        checkSession();
      } else {
        setIsLoggedIn(false);
        setSession(null);
        setUserDevices([]);
        setSelectedDeviceUuid(null);
        handleDisconnect();
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [addLog, selectedDeviceUuid, handleDisconnect]);
  
  // Auto-connect when logged in with devices selected
  useEffect(() => {
    if (isLoggedIn && session?.user?.id && selectedDeviceUuid && !isPaired && !connectInFlightRef.current) {
      handleConnect();
    }
  }, [isLoggedIn, session?.user?.id, selectedDeviceUuid, isPaired, handleConnect]);

  return {
    isPaired,
    isPeerConnected,
    lastDeviceSeenAt,
    lastDeviceSeenMs,
    rtStatus,
    connectionError,
    supabaseRef,
    handleConnect,
    handleDisconnect,
    refreshPairingSnapshot,
    updatePairingState,
    broadcastToUserChannel,
    lastBroadcastConfig,
    requestDeviceConfig,
    session,
    userDevices,
    selectedDeviceUuid,
    setSelectedDeviceUuid,
    isLoggedIn,
  };
}
