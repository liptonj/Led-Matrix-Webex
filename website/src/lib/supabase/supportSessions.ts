import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  getSupabase,
  withTimeout,
} from "./core";
import { createRealtimeSubscription } from "./helpers/createRealtimeSubscription";
import type { SupportSession } from "@/types/support";

const SESSION_COLUMNS = `
  id,
  user_id,
  admin_id,
  status,
  device_serial,
  device_chip,
  device_firmware,
  created_at,
  joined_at,
  closed_at,
  close_reason
`;

/**
 * Create a new support session for the given user.
 * Returns the newly created session.
 */
export async function createSupportSession(
  userId: string,
): Promise<SupportSession> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("support_sessions")
      .insert({ user_id: userId })
      .select(SESSION_COLUMNS)
      .single(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while creating support session.",
  );

  if (error) throw error;
  return data;
}

/**
 * Admin joins a waiting support session.
 * Updates status to 'active' and records the admin_id and joined_at timestamp.
 * Only joins sessions that are currently in 'waiting' status to prevent
 * accidentally re-opening closed sessions.
 */
export async function joinSupportSession(
  sessionId: string,
  adminId: string,
): Promise<SupportSession> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("support_sessions")
      .update({
        admin_id: adminId,
        status: "active",
        joined_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("status", "waiting")
      .select(SESSION_COLUMNS),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while joining support session.",
  );

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Session is not available or has already been joined.");
  }
  return data[0];
}

/**
 * Close a support session with the given reason.
 */
export async function closeSupportSession(
  sessionId: string,
  reason: string,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await withTimeout(
    supabase
      .schema("display")
      .from("support_sessions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        close_reason: reason,
      })
      .eq("id", sessionId),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while closing support session.",
  );

  if (error) throw error;
}

/**
 * Revert an active session back to 'waiting' status.
 * Used when an admin disconnects (closes tab, loses internet).
 */
export async function revertSessionToWaiting(
  sessionId: string,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await withTimeout(
    supabase
      .schema("display")
      .from("support_sessions")
      .update({
        admin_id: null,
        status: "waiting",
        joined_at: null,
      })
      .eq("id", sessionId),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while reverting support session.",
  );

  if (error) throw error;
}

/**
 * Get all active (waiting or active) support sessions.
 * Used by admin dashboard to list sessions.
 */
export async function getActiveSessions(): Promise<SupportSession[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("support_sessions")
      .select(SESSION_COLUMNS)
      .in("status", ["waiting", "active"])
      .order("created_at", { ascending: true }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading support sessions.",
  );

  if (error) throw error;
  return data || [];
}

/**
 * Get the user's current open support session (if any).
 * A user should only have one open session at a time.
 */
export async function getUserSession(
  userId: string,
): Promise<SupportSession | null> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("support_sessions")
      .select(SESSION_COLUMNS)
      .eq("user_id", userId)
      .in("status", ["waiting", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading user support session.",
  );

  if (error) throw error;
  return data;
}

/**
 * Update device information on a support session.
 * Called when the user's browser detects device details via serial.
 */
export async function updateSessionDeviceInfo(
  sessionId: string,
  info: {
    device_serial?: string;
    device_chip?: string;
    device_firmware?: string;
  },
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await withTimeout(
    supabase
      .schema("display")
      .from("support_sessions")
      .update(info)
      .eq("id", sessionId),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while updating session device info.",
  );

  if (error) throw error;
}

/**
 * Run stale session cleanup.
 * Calls the database function that closes sessions older than 24 hours.
 */
export async function cleanupStaleSessions(): Promise<number> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("cleanup_stale_sessions");

  if (error) throw error;
  return (data as number) ?? 0;
}

/**
 * Subscribe to realtime changes on the support_sessions table.
 * Used by admin dashboard to update session list in real-time.
 * Returns an unsubscribe function.
 */
export async function subscribeToSessionChanges(
  callback: (payload: { eventType: string; new: unknown; old: unknown }) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
): Promise<() => void> {
  return createRealtimeSubscription(
    "admin-support-sessions",
    {
      type: "postgres_changes",
      event: "*",
      schema: "display",
      table: "support_sessions",
    },
    {
      onMessage: callback,
      onStatusChange,
      onError,
    },
  );
}
