import { getSession } from "./auth";
import { getSupabase } from "./core";
import type { Command, Pairing } from "./types";
import { isValidPairingCode, isValidUUID } from "@/lib/utils/validation";

/**
 * Subscribe to pairing state changes for a specific device UUID.
 * Receives updates when device telemetry or connection state changes.
 */
export async function subscribeToPairing(
  deviceUuid: string,
  onUpdate: (pairing: Partial<Pairing>) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
): Promise<() => void> {
  // Validate UUID format to prevent filter injection
  if (!isValidUUID(deviceUuid)) {
    throw new Error('Invalid device UUID format');
  }

  const supabase = await getSupabase();

  const channel = supabase
    .channel(`device:${deviceUuid}:events`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "display",
        table: "pairings",
        filter: `device_uuid=eq.${deviceUuid}`,
      },
      (payload) => {
        onUpdate(payload.new as Partial<Pairing>);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "display",
        table: "pairings",
        filter: `device_uuid=eq.${deviceUuid}`,
      },
      (payload) => {
        onUpdate(payload.new as Partial<Pairing>);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onStatusChange?.(true);
      } else if (status === "CHANNEL_ERROR") {
        onError?.("Failed to subscribe to pairing updates");
        onStatusChange?.(false);
      } else if (status === "TIMED_OUT") {
        onError?.("Pairing subscription timed out");
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

/**
 * Subscribe to command status changes for a specific device UUID.
 * Receives updates when commands are acked/failed by the device.
 */
export async function subscribeToCommands(
  deviceUuid: string,
  onCommandUpdate: (command: Partial<Command>) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
): Promise<() => void> {
  // Validate UUID format to prevent filter injection
  if (!isValidUUID(deviceUuid)) {
    throw new Error('Invalid device UUID format');
  }

  const supabase = await getSupabase();

  const channel = supabase
    .channel(`device:${deviceUuid}:commands`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "display",
        table: "commands",
        filter: `device_uuid=eq.${deviceUuid}`,
      },
      (payload) => {
        onCommandUpdate(payload.new as Partial<Command>);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "display",
        table: "commands",
        filter: `device_uuid=eq.${deviceUuid}`,
      },
      (payload) => {
        onCommandUpdate(payload.new as Partial<Command>);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onStatusChange?.(true);
      } else if (status === "CHANNEL_ERROR") {
        onError?.("Failed to subscribe to command updates");
        onStatusChange?.(false);
      } else if (status === "TIMED_OUT") {
        onError?.("Command subscription timed out");
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

// Explicit column list for pairings table
const PAIRING_COLUMNS = `
  pairing_code,
  pairing_code_expires_at,
  serial_number,
  device_id,
  device_uuid,
  user_uuid,
  app_last_seen,
  device_last_seen,
  app_connected,
  device_connected,
  webex_status,
  camera_on,
  mic_muted,
  in_call,
  display_name,
  rssi,
  free_heap,
  uptime,
  temperature,
  firmware_version,
  ssid,
  ota_partition,
  config,
  status_updated_at,
  created_at,
  updated_at
`;

/**
 * Get a pairing by device UUID
 */
export async function getPairing(deviceUuid: string): Promise<Pairing | null> {
  // Validate UUID format for consistency and security
  if (!isValidUUID(deviceUuid)) {
    throw new Error('Invalid device UUID format');
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("pairings")
    .select(PAIRING_COLUMNS)
    .eq("device_uuid", deviceUuid)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

// Explicit column list for commands table (post-UUID migration)
const COMMAND_COLUMNS = `
  id,
  device_uuid,
  command,
  payload,
  status,
  created_at,
  acked_at,
  expires_at,
  response,
  error
`;

/**
 * Get pending commands for a device UUID
 */
export async function getPendingCommands(
  deviceUuid: string,
): Promise<Command[]> {
  // Validate UUID format
  if (!isValidUUID(deviceUuid)) {
    throw new Error('Invalid device UUID format');
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("commands")
    .select(COMMAND_COLUMNS)
    .eq("device_uuid", deviceUuid)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getCommands(
  deviceUuid: string,
  options: { status?: Command["status"] | "all"; limit?: number } = {},
): Promise<Command[]> {
  // Validate UUID format
  if (!isValidUUID(deviceUuid)) {
    throw new Error('Invalid device UUID format');
  }

  const supabase = await getSupabase();
  let query = supabase
    .schema("display")
    .from("commands")
    .select(COMMAND_COLUMNS)
    .eq("device_uuid", deviceUuid)
    .order("created_at", { ascending: false });

  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getCommandsPage(
  deviceUuid: string,
  options: {
    status?: Command["status"] | "all";
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ data: Command[]; count: number | null }> {
  // Validate UUID format
  if (!isValidUUID(deviceUuid)) {
    throw new Error('Invalid device UUID format');
  }

  const supabase = await getSupabase();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, options.pageSize ?? 10);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .schema("display")
    .from("commands")
    .select(COMMAND_COLUMNS, { count: "exact" })
    .eq("device_uuid", deviceUuid)
    .order("created_at", { ascending: false });

  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;
  return { data: data || [], count: count ?? null };
}

/**
 * Insert a command for a device (admin only).
 * Uses Edge Function to ensure real-time broadcast to device.
 */
export async function insertCommand(
  deviceUuid: string,
  serialNumber: string,
  command: string,
  payload: Record<string, unknown> = {},
): Promise<Command> {
  // Validate UUID format
  if (!isValidUUID(deviceUuid)) {
    throw new Error('Invalid device UUID format');
  }

  const supabase = await getSupabase();
  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("Supabase URL not configured.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/insert-command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      command,
      payload,
      device_uuid: deviceUuid,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Command insert failed: HTTP ${response.status}`);
  }

  const result = await response.json();
  
  // The edge function returns the command_id, fetch the full command record
  if (!result.command_id) {
    throw new Error("Edge function did not return command_id.");
  }

  const { data: cmd, error: cmdError } = await supabase
    .schema("display")
    .from("commands")
    .select(COMMAND_COLUMNS)
    .eq("id", result.command_id)
    .single();

  if (cmdError || !cmd) {
    throw new Error("Command inserted but failed to fetch record.");
  }

  return cmd;
}
