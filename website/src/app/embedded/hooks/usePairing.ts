'use client';

import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { type SupabaseClient, type Session } from '@supabase/supabase-js';
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
  updateAppStateViaEdge: (stateData: { webex_status?: string; camera_on?: boolean; mic_muted?: boolean; in_call?: boolean; display_name?: string }) => Promise<boolean>;
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


  const updateAppStateViaEdge = useCallback(async (stateData: { webex_status?: string; camera_on?: boolean; mic_muted?: boolean; in_call?: boolean; display_name?: string }): Promise<boolean> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || !session || !selectedDeviceUuid) return false;
    
    const supabase = getSupabaseClient();
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession) return false;
    
    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/update-app-state`,
        { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${currentSession.access_token}` 
          }, 
          body: JSON.stringify({ ...stateData, device_uuid: selectedDeviceUuid }) 
        },
        API_TIMEOUT_MS
      );
      if (!response.ok) { const error = await response.json().catch(() => ({ error: 'Unknown error' })); addLog(`update-app-state failed: ${error.error || response.status}`); return false; }
      const result = await response.json();
      if (typeof result.device_connected === 'boolean') setIsPeerConnected(result.device_connected);
      return true;
    } catch (err) { addLog(`update-app-state error: ${err instanceof Error ? err.message : 'unknown error'}`); return false; }
  }, [session, selectedDeviceUuid, addLog]);

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
      // Get pairing_code from pairings table first, then query connection_heartbeats
      const { data: pairing } = await supabaseRef.current
        .schema('display')
        .from('pairings')
        .select('pairing_code')
        .eq('device_uuid', deviceUuid)
        .single();
      
      if (pairing?.pairing_code) {
        const { data: heartbeat } = await supabaseRef.current
          .schema('display')
          .from('connection_heartbeats')
          .select('device_last_seen, device_connected')
          .eq('pairing_code', pairing.pairing_code)
          .single();
        
        if (heartbeat) {
          const lastSeen = heartbeat.device_last_seen ? new Date(heartbeat.device_last_seen).getTime() : 0;
          setIsPeerConnected(!!heartbeat.device_connected && Date.now() - lastSeen < 60_000);
          setLastDeviceSeenAt(heartbeat.device_last_seen ?? null);
          setLastDeviceSeenMs(lastSeen || null);
          lastPairingSnapshotRef.current = Date.now();
          addLog(`Refreshed display status (${reason})`);
        }
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
        presence: { key: 'app' }
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
      
      // Start heartbeat interval
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = setInterval(() => {
        if (CONFIG.useEdgeFunctions) {
          updateAppStateViaEdge({}).catch(() => {});
        } else if (supabaseRef.current && selectedDeviceUuid) {
          // Update pairings table for heartbeat (deprecated but kept for compatibility)
          supabaseRef.current
            .schema('display')
            .from('pairings')
            .update({ app_connected: true, app_last_seen: new Date().toISOString() })
            .eq('device_uuid', selectedDeviceUuid)
            .then(({ error }) => {
              if (error) addLog(`pairings heartbeat failed: ${error.message}`);
            });
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
  }, [addLog, session, selectedDeviceUuid, subscribeToUserChannel, updateAppStateViaEdge, rtStatus]);

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
    updateAppStateViaEdge,
    session,
    userDevices,
    selectedDeviceUuid,
    setSelectedDeviceUuid,
    isLoggedIn,
  };
}
