import { getSupabase } from "./core";
import { getSession } from "./auth";
import type { Command, Pairing } from "./types";

/**
 * Subscribe to pairing state changes for a specific pairing code.
 * Receives updates when device telemetry or connection state changes.
 */
export async function subscribeToPairing(
  pairingCode: string,
  onUpdate: (pairing: Partial<Pairing>) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
): Promise<() => void> {
  const supabase = await getSupabase();

  const channel = supabase
    .channel(`pairing-${pairingCode}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "display",
        table: "pairings",
        filter: `pairing_code=eq.${pairingCode}`,
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
        filter: `pairing_code=eq.${pairingCode}`,
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
 * Subscribe to command status changes for a specific pairing code.
 * Receives updates when commands are acked/failed by the device.
 */
export async function subscribeToCommands(
  pairingCode: string,
  onCommandUpdate: (command: Partial<Command>) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
): Promise<() => void> {
  const supabase = await getSupabase();

  const channel = supabase
    .channel(`commands-${pairingCode}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "display",
        table: "commands",
        filter: `pairing_code=eq.${pairingCode}`,
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
        filter: `pairing_code=eq.${pairingCode}`,
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
  serial_number,
  device_id,
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
  created_at,
  updated_at
`;

/**
 * Get a pairing by code
 */
export async function getPairing(pairingCode: string): Promise<Pairing | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("pairings")
    .select(PAIRING_COLUMNS)
    .eq("pairing_code", pairingCode)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

// Explicit column list for commands table
const COMMAND_COLUMNS = `
  id,
  pairing_code,
  serial_number,
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
 * Get pending commands for a pairing code
 */
export async function getPendingCommands(
  pairingCode: string,
): Promise<Command[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("commands")
    .select(COMMAND_COLUMNS)
    .eq("pairing_code", pairingCode)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getCommands(
  pairingCode: string,
  options: { status?: Command["status"] | "all"; limit?: number } = {},
): Promise<Command[]> {
  const supabase = await getSupabase();
  let query = supabase
    .schema("display")
    .from("commands")
    .select(COMMAND_COLUMNS)
    .eq("pairing_code", pairingCode)
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
  pairingCode: string,
  options: {
    status?: Command["status"] | "all";
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ data: Command[]; count: number | null }> {
  const supabase = await getSupabase();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, options.pageSize ?? 10);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .schema("display")
    .from("commands")
    .select(COMMAND_COLUMNS, { count: "exact" })
    .eq("pairing_code", pairingCode)
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
 */
export async function insertCommand(
  pairingCode: string,
  serialNumber: string,
  command: string,
  payload: Record<string, unknown> = {},
): Promise<Command> {
  const supabase = await getSupabase();
  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const { data, error } = await supabase
    .schema("display")
    .from("commands")
    .insert({
      pairing_code: pairingCode,
      serial_number: serialNumber,
      command,
      payload,
    })
    .select(COMMAND_COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error("Failed to insert command.");
  return data;
}
