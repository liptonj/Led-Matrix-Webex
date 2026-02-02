'use client';

import type { WebexStatus } from '@/hooks/useWebexSDK';
import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG } from '../constants';
import type { AppToken, WebexOAuthStatus } from '../types';

const API_TIMEOUT_MS = 15000;
const WEBEX_API_TIMEOUT_MS = 10000;

export interface UseWebexStatusOptions {
  appToken: AppToken | null;
  isPaired: boolean;
  addLog: (message: string) => void;
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
  normalizeWebexStatus: (status: string | null | undefined) => WebexStatus;
  shouldRefreshWebexToken: (expiresAt: string | null) => boolean;
}

export function useWebexStatus({ appToken, isPaired, addLog }: UseWebexStatusOptions): UseWebexStatusResult {
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
    if (!appToken) return null;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return null;
    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/webex-token`,
        { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            Authorization: `Bearer ${appToken.token}` 
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
  }, [appToken, addLog]);

  const ensureWebexToken = useCallback(async () => {
    if (!appToken) return null;
    if (webexToken && !shouldRefreshWebexToken(webexTokenExpiresAt)) return webexToken;
    return await fetchWebexToken();
  }, [appToken, webexToken, webexTokenExpiresAt, shouldRefreshWebexToken, fetchWebexToken]);

  const pollWebexStatus = useCallback(async () => {
    if (!appToken || !isPaired) return;
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
  }, [appToken, isPaired, ensureWebexToken, addLog, normalizeWebexStatus]);

  const startWebexOAuth = useCallback(async () => {
    if (!appToken) { addLog('Missing app token - connect to the display first.'); return; }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) { addLog('Supabase URL not configured.'); return; }
    setWebexOauthStatus('starting');
    try {
      const response = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/webex-oauth-start`,
        { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            Authorization: `Bearer ${appToken.token}` 
          }, 
          body: JSON.stringify({}) 
        },
        API_TIMEOUT_MS
      );
      const data = await response.json();
      if (!response.ok || !data?.auth_url) throw new Error(data?.error || 'Failed to start Webex authorization');
      window.open(data.auth_url as string, '_blank', 'noopener,noreferrer');
      setWebexOauthStatus('idle');
      addLog('Opened Webex authorization flow.');
    } catch (err) { setWebexOauthStatus('error'); addLog(`Webex OAuth start failed: ${err instanceof Error ? err.message : 'unknown error'}`); }
  }, [appToken, addLog]);

  // Check auth status once when paired (don't include fetchWebexToken in deps to avoid loops)
  useEffect(() => {
    if (!appToken || !isPaired) return;
    // Check if we have valid auth
    fetchWebexToken().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appToken, isPaired]);

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

  return { webexToken, webexTokenExpiresAt, apiWebexStatus, webexOauthStatus, webexNeedsAuth, webexPollIntervalMs, setWebexPollIntervalMs, fetchWebexToken, ensureWebexToken, pollWebexStatus, startWebexOAuth, normalizeWebexStatus, shouldRefreshWebexToken };
}
