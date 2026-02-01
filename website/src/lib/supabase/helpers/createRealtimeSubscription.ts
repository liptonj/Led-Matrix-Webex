import type { REALTIME_SUBSCRIBE_STATES, RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../core";

/**
 * Configuration for postgres_changes subscription type.
 */
export interface PostgresChangesConfig {
  type: "postgres_changes";
  /** Event type to listen for: INSERT, UPDATE, DELETE, or * for all */
  event: "INSERT" | "UPDATE" | "DELETE" | "*";
  /** Database schema name */
  schema: string;
  /** Table name */
  table: string;
  /** Optional filter (e.g., "pairing_code=eq.ABC123") */
  filter?: string;
}

/**
 * Configuration for broadcast subscription type.
 */
export interface BroadcastConfig {
  type: "broadcast";
  /** Event name to listen for */
  event: string;
}

/**
 * Union type for all subscription configurations.
 */
export type SubscriptionConfig = PostgresChangesConfig | BroadcastConfig;

/**
 * Callback functions for subscription lifecycle events.
 */
export interface SubscriptionCallbacks<T> {
  /** Called when a new message/change is received */
  onMessage: (payload: T) => void;
  /** Called when subscription status changes */
  onStatusChange?: (subscribed: boolean) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
}

/**
 * Create a Supabase Realtime subscription with automatic cleanup.
 * 
 * This helper consolidates the common pattern of creating Realtime subscriptions
 * for both postgres_changes (database table changes) and broadcast (custom events).
 * It handles status changes, errors, and provides a cleanup function.
 * 
 * @template T - The expected type of the message payload
 * @param channelName - Unique name for the subscription channel
 * @param config - Subscription configuration (postgres_changes or broadcast)
 * @param callbacks - Callback functions for handling messages and status changes
 * @returns Promise resolving to an unsubscribe function
 * 
 * @example
 * // Subscribe to device table changes
 * const unsubscribe = await createRealtimeSubscription<Device>(
 *   "admin-devices",
 *   {
 *     type: "postgres_changes",
 *     event: "*",
 *     schema: "display",
 *     table: "devices"
 *   },
 *   {
 *     onMessage: (device) => {
 *       console.log("Device changed:", device);
 *     },
 *     onStatusChange: (subscribed) => {
 *       setConnected(subscribed);
 *     },
 *     onError: (error) => {
 *       console.error("Subscription error:", error);
 *     }
 *   }
 * );
 * 
 * // Clean up when done
 * unsubscribe();
 * 
 * @example
 * // Subscribe to broadcast events
 * const unsubscribe = await createRealtimeSubscription<DeviceLog>(
 *   `device_logs:${serialNumber}`,
 *   {
 *     type: "broadcast",
 *     event: "log"
 *   },
 *   {
 *     onMessage: (log) => {
 *       console.log("New log:", log);
 *     }
 *   }
 * );
 * 
 * @example
 * // Subscribe to filtered postgres changes
 * const unsubscribe = await createRealtimeSubscription<Pairing>(
 *   `pairing-${pairingCode}`,
 *   {
 *     type: "postgres_changes",
 *     event: "UPDATE",
 *     schema: "display",
 *     table: "pairings",
 *     filter: `pairing_code=eq.${pairingCode}`
 *   },
 *   {
 *     onMessage: (pairing) => {
 *       setPairingData(pairing);
 *     },
 *     onStatusChange: setSubscribed,
 *     onError: setError
 *   }
 * );
 */
export async function createRealtimeSubscription<T>(
  channelName: string,
  config: SubscriptionConfig,
  callbacks: SubscriptionCallbacks<T>
): Promise<() => void> {
  const supabase = await getSupabase();
  const { onMessage, onStatusChange, onError } = callbacks;

  // Create channel
  let channel: RealtimeChannel = supabase.channel(channelName);

  // Configure subscription based on type
  // Note: Using type assertion due to complex Supabase Realtime generic types
  // that don't fully match runtime behavior
  if (config.type === "postgres_changes") {
    const postgresConfig = {
      event: config.event,
      schema: config.schema,
      table: config.table,
      ...(config.filter ? { filter: config.filter } : {}),
    };

    // Supabase's RealtimeChannel.on() has complex overloads that don't match
    // the runtime flexibility. We use type assertion to maintain type safety
    // in the callback while allowing the generic subscription pattern.
    (channel as RealtimeChannel).on(
      "postgres_changes" as const,
      postgresConfig as { event: "*"; schema: string; table: string },
      (payload: { eventType: string; new: unknown; old: unknown }) => {
        // For postgres_changes, payload structure is { eventType, new, old }
        // We pass the entire payload to the callback
        onMessage(payload as T);
      }
    );
  } else if (config.type === "broadcast") {
    channel.on(
      "broadcast",
      { event: config.event },
      (payload: { payload: unknown }) => {
        // For broadcast, payload.payload contains the actual message
        onMessage(payload.payload as T);
      }
    );
  }

  // Subscribe with status handling
  channel.subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`, err?: Error) => {
    if (status === "SUBSCRIBED") {
      onStatusChange?.(true);
    } else if (status === "CHANNEL_ERROR") {
      onError?.(err?.message || "Failed to subscribe to realtime updates");
      onStatusChange?.(false);
    } else if (status === "TIMED_OUT") {
      onError?.("Realtime subscription timed out");
      onStatusChange?.(false);
    } else if (status === "CLOSED") {
      onStatusChange?.(false);
    }
  });

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(channel);
  };
}
