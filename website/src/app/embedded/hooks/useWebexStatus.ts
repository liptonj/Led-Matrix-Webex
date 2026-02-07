'use client';

import type { WebexStatus } from '@/hooks/useWebexSDK';
import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { CONFIG } from '../constants';
import type { WebexOAuthStatus } from '../types';

const API_TIMEOUT_MS = 15000;
const WEBEX_API_TIMEOUT_MS = 10000;

export interface UseWebexStatusOptions {
  isPaired: boolean;
  session: Session | null;
  deviceUuid?: string | null;
  supabaseRef: React.MutableRefObject<SupabaseClient | null>;
  addLog: (message: string) => void;
  broadcastToUserChannel?: (event: string, payload: Record<string, unknown>) => Promise<boolean>;
}

export interface UseWebexStatusResult {
  webexToken: string | null;
  webexTokenExpiresAt: string | null;
  apiWebexStatus: WebexStatus | null;
  webexOauthStatus: WebexOAuthStatus;
  webexNeedsAuth: boolean;
  webexPollIntervalMs: number;
  setWebexPollIntervalMs: (interval: number) => void;
  fetchWebexToken: () => Promise<string | null>;
  ensureWebexToken: () => Promise<string | null>;
  pollWebexStatus: () => Promise<void>;
  startWebexOAuth: () => Promise<void>;
  broadcastStatusUpdate: (status: WebexStatus, inCall?: boolean, cameraOn?: boolean, micMuted?: boolean, displayName?: string) => Promise<void>;
  normalizeWebexStatus: (status: string | null | undefined) => WebexStatus;
  shouldRefreshWebexToken: (expiresAt: string | null) => boolean;
}

export function useWebexStatus({ isPaired, session, deviceUuid, supabaseRef, addLog, broadcastToUserChannel }: UseWebexStatusOptions): UseWebexStatusResult {
  const [apiWebexStatus, setApiWebexStatus] = useState<WebexStatus | null>(null);
  const [webexOauthStatus, setWebexOauthStatus] = useState<WebexOAuthStatus>('idle');
  const [webexNeedsAuth, setWebexNeedsAuth] = useState<boolean>(true); // Default true until we verify
  const [webexPollIntervalMs, setWebexPollIntervalMsState] = useState(60000);
  const [webexToken, setWebexToken] = useState<string | null>(null);
  const [webexTokenExpiresAt, setWebexTokenExpiresAt] = useState<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoggedNeedsAuth = useRef<boolean>(false); // Track if we've logged the needs-auth message

  useEffect(() => {
    const savedInterval = localStorage.getItem(CONFIG.storageKeyWebexPollInterval);
    if (savedInterval) { const v = parseInt(savedInterval, 10); if (!Number.isNaN(v) && v >= 5000) setWebexPollIntervalMsState(v); }
  }, []);

  const setWebexPollIntervalMs = useCallback((interval: number) => {
    setWebexPollIntervalMsState(interval);
    localStorage.setItem(CONFIG.storageKeyWebexPollInterval, String(interval));
  }, []);

  const normalizeWebexStatus = useCallback((status: string | null | undefined): WebexStatus => {
    const key = (status || '').trim().toLowerCase();
    const statusMap: Record<string, WebexStatus> = { active: 'active', available: 'active', meeting: 'meeting', call: 'call', busy: 'busy', presenting: 'presenting', dnd: 'dnd', donotdisturb: 'dnd', away: 'away', inactive: 'away', brb: 'away', offline: 'offline', outofoffice: 'ooo', ooo: 'ooo', pending: 'pending' };
    return statusMap[key] || 'unknown';
  }, []);

  const shouldRefreshWebexToken = useCallback((expiresAt: string | null): boolean => {
    if (!expiresAt) return true;
    return (new Date(expiresAt).getTime() - Date.now()) < CONFIG.tokenRefreshThresholdMs;
  }, []);

  const fetchWebexToken = useCallback(async () => {
    if (!session?.access_token) return null;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return null;
    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/webex-token`,
        { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            Authorization: `Bearer ${session.access_token}` 
          } 
        },
        API_TIMEOUT_MS
      );
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 404) {
          // Token not found - user needs to authorize
          setWebexNeedsAuth(true);
          // Only log once to avoid spamming
          if (!hasLoggedNeedsAuth.current) {
            addLog('Webex not connected - authorize via the Webex tab');
            hasLoggedNeedsAuth.current = true;
          }
        } else {
          addLog(`webex-token failed: ${data?.error || response.status}`);
        }
        return null;
      }
      // Success - user is authorized
      setWebexNeedsAuth(false);
      hasLoggedNeedsAuth.current = false; // Reset so we can log again if auth is lost
      setWebexToken(data.access_token);
      setWebexTokenExpiresAt(data.expires_at || null);
      return data.access_token as string;
    } catch (err) { addLog(`webex-token error: ${err instanceof Error ? err.message : 'unknown error'}`); return null; }
  }, [session?.access_token, addLog]);

  const ensureWebexToken = useCallback(async () => {
    if (!session?.access_token) return null;
    if (webexToken && !shouldRefreshWebexToken(webexTokenExpiresAt)) return webexToken;
    return await fetchWebexToken();
  }, [session?.access_token, webexToken, webexTokenExpiresAt, shouldRefreshWebexToken, fetchWebexToken]);

  const pollWebexStatus = useCallback(async () => {
    if (!session?.access_token || !isPaired) return;
    const token = await ensureWebexToken();
    if (!token) return;
    try {
      const response = await fetchWithTimeout(
        'https://webexapis.com/v1/people/me',
        { headers: { Authorization: `Bearer ${token}` } },
        WEBEX_API_TIMEOUT_MS
      );
      const data = await response.json();
      if (!response.ok) { addLog(`Webex API error: ${data?.message || data?.error || response.status}`); return; }
      const rawStatus = data?.status || data?.presence || data?.availability || data?.state || data?.activity;
      setApiWebexStatus(normalizeWebexStatus(rawStatus));
    } catch (err) { addLog(`Webex API error: ${err instanceof Error ? err.message : 'unknown error'}`); }
  }, [session?.access_token, isPaired, ensureWebexToken, addLog, normalizeWebexStatus]);

  const startWebexOAuth = useCallback(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) { addLog('Supabase URL not configured.'); return; }
    setWebexOauthStatus('starting');
    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/webex-user-login`,
        { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json'
          }, 
          body: JSON.stringify({ redirect_to: '/embedded' }) 
        },
        API_TIMEOUT_MS
      );
      const data = await response.json();
      if (!response.ok || !data?.auth_url) throw new Error(data?.error || 'Failed to start Webex authorization');
      window.location.href = data.auth_url as string;
      setWebexOauthStatus('idle');
      addLog('Redirecting to Webex authorization...');
    } catch (err) { setWebexOauthStatus('error'); addLog(`Webex OAuth start failed: ${err instanceof Error ? err.message : 'unknown error'}`); }
  }, [addLog]);

  // Broadcast status update to user channel using persistent channel from usePairing
  // webex_status is USER-SCOPED: all devices on the user channel receive it.
  // The device dropdown is only for device-specific settings, not status filtering.
  const broadcastStatusUpdate = useCallback(async (
    status: WebexStatus,
    inCall?: boolean,
    cameraOn?: boolean,
    micMuted?: boolean,
    displayName?: string
  ): Promise<void> => {
    if (!session?.user?.id) {
      addLog('Cannot broadcast status: missing session');
      return;
    }

    const payload = {
      webex_status: status,
      ...(deviceUuid && { device_uuid: deviceUuid }),
      in_call: inCall,
      camera_on: cameraOn,
      mic_muted: micMuted,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    };

    // Use broadcastToUserChannel if available (from usePairing)
    if (broadcastToUserChannel) {
      try {
        const success = await broadcastToUserChannel('webex_status', payload);
        if (success) {
          addLog(`Broadcasted webex_status to all devices: ${status}`);
        }
      } catch (err) {
        addLog(`Broadcast error: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
      return;
    }

    // Fallback: create temporary channel if broadcastToUserChannel is not available
    // This should rarely happen, but provides backward compatibility
    if (!supabaseRef.current) {
      addLog('Cannot broadcast status: missing Supabase client and broadcastToUserChannel');
      return;
    }

    const supabase = supabaseRef.current;
    const userId = session.user.id;
    const channelName = `user:${userId}`;

    try {
      // Get or create channel for broadcasting
      // Note: Channel must be subscribed before broadcasting
      const channel = supabase.channel(channelName, {
        config: {
          broadcast: { self: true },
          private: true
        },
      });

      // Subscribe to channel if not already subscribed
      const subscribePromise = new Promise<void>((resolve, reject) => {
        channel
          .subscribe((subscribeStatus) => {
            if (subscribeStatus === 'SUBSCRIBED') {
              resolve();
            } else if (subscribeStatus === 'CHANNEL_ERROR') {
              reject(new Error('Channel subscription failed'));
            }
          });
      });

      await subscribePromise;

      // Send broadcast
      const sendResult = await channel.send({
        type: 'broadcast',
        event: 'webex_status',
        payload,
      });

      if (sendResult !== 'ok') {
        addLog(`Failed to broadcast status: ${sendResult}`);
      } else {
        addLog(`Broadcasted webex_status to ${channelName} (fallback mode)`);
      }

      // Clean up channel after broadcast
      supabase.removeChannel(channel);
    } catch (err) {
      addLog(`Broadcast error: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }, [session?.user?.id, deviceUuid, supabaseRef, addLog, broadcastToUserChannel]);

  // Check auth status once when paired (don't include fetchWebexToken in deps to avoid loops)
  useEffect(() => {
    if (!session?.access_token || !isPaired) return;
    // Check if we have valid auth
    fetchWebexToken().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, isPaired]);

  // Only poll Webex status if authorized
  useEffect(() => {
    if (!isPaired || webexPollIntervalMs < 5000 || webexNeedsAuth) return;
    
    // Initial poll
    pollWebexStatus().catch(() => {});
    
    // Set up interval polling only when authorized
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => { pollWebexStatus().catch(() => {}); }, webexPollIntervalMs);
    return () => { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; } };
  }, [isPaired, webexPollIntervalMs, webexNeedsAuth, pollWebexStatus]);

  return { webexToken, webexTokenExpiresAt, apiWebexStatus, webexOauthStatus, webexNeedsAuth, webexPollIntervalMs, setWebexPollIntervalMs, fetchWebexToken, ensureWebexToken, pollWebexStatus, startWebexOAuth, broadcastStatusUpdate, normalizeWebexStatus, shouldRefreshWebexToken };
}
