'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase/core';
import type { RealtimeChannel } from '@supabase/supabase-js';

type EventHandler = (payload: Record<string, unknown>) => void;

interface UseSupportChannelOptions {
  /** Session ID to subscribe to (null = not subscribed) */
  sessionId: string | null;
  /** Map of event names to handlers */
  eventHandlers?: Record<string, EventHandler>;
}

interface UseSupportChannelReturn {
  /** Whether the channel is connected and subscribed */
  isConnected: boolean;
  /** Last channel error, if any */
  channelError: string | null;
  /** Send a broadcast event on the channel */
  send: (event: string, payload: Record<string, unknown>) => void;
}

/** Maximum broadcasts per second to prevent flooding */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 1000;

/**
 * Hook for bidirectional Supabase Realtime broadcast on a support session channel.
 *
 * Creates and manages a private broadcast channel `support:{sessionId}`.
 * Supports multiple event types via the eventHandlers map.
 * Reusable by both user-side (useSerialBridge) and admin-side (useRemoteConsole).
 */
export function useSupportChannel({
  sessionId,
  eventHandlers,
}: UseSupportChannelOptions): UseSupportChannelReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const eventHandlersRef = useRef(eventHandlers);
  const sendCountRef = useRef(0);
  const sendWindowRef = useRef(Date.now());

  // Keep handlers ref current
  useEffect(() => {
    eventHandlersRef.current = eventHandlers;
  }, [eventHandlers]);

  // Subscribe/unsubscribe when sessionId changes
  useEffect(() => {
    if (!sessionId) {
      // Clean up existing channel
      if (channelRef.current) {
        getSupabase().then((supabase) => {
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
          }
        });
      }
      setIsConnected(false);
      return;
    }

    let mounted = true;

    async function subscribe() {
      const supabase = await getSupabase();

      // Remove previous channel if any
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const channelName = `support:${sessionId}`;
      const channel = supabase.channel(channelName, {
        config: {
          broadcast: { self: false },
          private: true,
        },
      });

      // Register broadcast listeners for all known event types.
      // IMPORTANT: we read the handler from eventHandlersRef at invocation
      // time (not capture time) so that updated callbacks are always used.
      const handlerEntries = Object.entries(eventHandlersRef.current || {});
      for (const [event] of handlerEntries) {
        channel.on('broadcast', { event }, (msg) => {
          if (!mounted) return;
          const currentHandler = eventHandlersRef.current?.[event];
          if (currentHandler) {
            currentHandler(msg.payload as Record<string, unknown>);
          }
        });
      }

      // Subscribe
      channel.subscribe((status, err) => {
        if (!mounted) return;

        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          setChannelError(null);
        } else if (status === 'CHANNEL_ERROR') {
          setIsConnected(false);
          setChannelError(err?.message || 'Channel connection failed');
        } else if (status === 'TIMED_OUT') {
          setIsConnected(false);
          setChannelError('Channel subscription timed out');
        } else if (status === 'CLOSED') {
          setIsConnected(false);
        }
      });

      channelRef.current = channel;
    }

    subscribe();

    return () => {
      mounted = false;
      if (channelRef.current) {
        getSupabase().then((supabase) => {
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
          }
        });
      }
    };
  }, [sessionId]);

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!channelRef.current) return;

    // Rate limiting
    const now = Date.now();
    if (now - sendWindowRef.current > RATE_LIMIT_WINDOW_MS) {
      sendCountRef.current = 0;
      sendWindowRef.current = now;
    }
    if (sendCountRef.current >= RATE_LIMIT_MAX) {
      console.warn('[SupportChannel] Rate limit exceeded, dropping message');
      return;
    }
    sendCountRef.current++;

    channelRef.current.send({
      type: 'broadcast',
      event,
      payload,
    });
  }, []);

  return { isConnected, channelError, send };
}
