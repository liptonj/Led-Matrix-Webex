/**
 * Supabase Client Configuration
 *
 * Provides the Supabase client for authentication and database access.
 */

// Supabase URL and anon key are public - they're meant to be exposed
// Row Level Security (RLS) protects the data
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}

// Types for our display schema
export interface Device {
  id: string;
  serial_number: string;
  device_id: string;
  pairing_code: string;
  display_name: string | null;
  firmware_version: string | null;
  target_firmware_version: string | null;
  ip_address: string | null;
  last_seen: string;
  debug_enabled: boolean;
  is_provisioned: boolean;
  registered_at: string;
  provisioned_at: string | null;
  metadata: Record<string, unknown>;
}

export interface DeviceLog {
  id: string;
  device_id: string;
  serial_number: string | null;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Release {
  id: string;
  version: string;
  tag: string;
  name: string | null;
  notes: string | null;
  firmware_url: string;
  firmware_merged_url: string | null;
  firmware_size: number | null;
  build_id: string | null;
  build_date: string | null;
  is_latest: boolean;
  is_prerelease: boolean;
  rollout_percentage: number;
  created_at: string;
  created_by: string | null;
}

// Supabase client type (we'll create it dynamically)
let supabaseClient: Awaited<ReturnType<typeof createSupabaseClient>> | null = null;
let supabaseClientPromise: Promise<
  Awaited<ReturnType<typeof createSupabaseClient>>
> | null = null;

// Dynamic import to avoid bundling issues
async function createSupabaseClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export async function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  if (!supabaseClient) {
    if (!supabaseClientPromise) {
      supabaseClientPromise = createSupabaseClient();
    }
    supabaseClient = await supabaseClientPromise;
    supabaseClientPromise = null;
  }

  return supabaseClient;
}

// Explicit column list for devices - NEVER include key_hash for security
const DEVICE_COLUMNS = `
  id,
  serial_number,
  device_id,
  pairing_code,
  display_name,
  firmware_version,
  target_firmware_version,
  ip_address,
  last_seen,
  debug_enabled,
  is_provisioned,
  registered_at,
  provisioned_at,
  metadata
`;

// Helper to get devices from the display schema
export async function getDevices(): Promise<Device[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("devices")
    .select(DEVICE_COLUMNS)
    .order("last_seen", { ascending: false });

  if (error) throw error;
  return data || [];
}

// Helper to get a single device
export async function getDevice(serialNumber: string): Promise<Device | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("devices")
    .select(DEVICE_COLUMNS)
    .eq("serial_number", serialNumber)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

// Helper to get device logs by device_id (legacy)
export async function getDeviceLogs(
  deviceId: string,
  limit = 100,
): Promise<DeviceLog[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("device_logs")
    .select("id, device_id, serial_number, level, message, metadata, created_at")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Helper to get device logs by serial_number (preferred)
export async function getDeviceLogsBySerial(
  serialNumber: string,
  limit = 100,
): Promise<DeviceLog[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("device_logs")
    .select("id, device_id, serial_number, level, message, metadata, created_at")
    .eq("serial_number", serialNumber)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Subscribe to realtime device logs via Supabase Realtime (postgres_changes)
export async function subscribeToDeviceLogs(
  serialNumber: string,
  onLog: (log: DeviceLog) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
): Promise<() => void> {
  const supabase = await getSupabase();

  const channel = supabase
    .channel(`device-logs-${serialNumber}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "display",
        table: "device_logs",
        filter: `serial_number=eq.${serialNumber}`,
      },
      (payload) => {
        const record = payload.new as {
          id: string;
          device_id: string;
          serial_number: string | null;
          level: "debug" | "info" | "warn" | "error";
          message: string;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        onLog({
          id: record.id,
          device_id: record.device_id,
          serial_number: record.serial_number,
          level: record.level,
          message: record.message,
          metadata: record.metadata,
          created_at: record.created_at,
        });
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onStatusChange?.(true);
      } else if (status === "CHANNEL_ERROR") {
        onError?.("Failed to subscribe to realtime logs");
        onStatusChange?.(false);
      } else if (status === "TIMED_OUT") {
        onError?.("Subscription timed out");
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

export interface DeviceChangeEvent {
  event: "INSERT" | "UPDATE" | "DELETE";
  new: Device | null;
  old: Device | null;
}

// Subscribe to realtime device updates via Supabase Realtime (postgres_changes)
export async function subscribeToDevices(
  onChange: (event: DeviceChangeEvent) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
): Promise<() => void> {
  const supabase = await getSupabase();

  const channel = supabase
    .channel("admin-devices")
    .on(
      "postgres_changes",
      { event: "*", schema: "display", table: "devices" },
      (payload) => {
        const event = payload.eventType as DeviceChangeEvent["event"];
        const recordNew = (payload.new || null) as Device | null;
        const recordOld = (payload.old || null) as Device | null;
        onChange({ event, new: recordNew, old: recordOld });
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onStatusChange?.(true);
      } else if (status === "CHANNEL_ERROR") {
        onError?.("Failed to subscribe to realtime device updates");
        onStatusChange?.(false);
      } else if (status === "TIMED_OUT") {
        onError?.("Realtime device updates timed out");
        onStatusChange?.(false);
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

// Explicit column list for releases
const RELEASE_COLUMNS = `
  id,
  version,
  tag,
  name,
  notes,
  firmware_url,
  firmware_merged_url,
  firmware_size,
  build_id,
  build_date,
  is_latest,
  is_prerelease,
  rollout_percentage,
  created_at,
  created_by
`;

// Helper to get releases
export async function getReleases(): Promise<Release[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .schema("display")
    .from("releases")
    .select(RELEASE_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

// Helper to update device debug mode
export async function setDeviceDebugMode(
  serialNumber: string,
  enabled: boolean,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("devices")
    .update({ debug_enabled: enabled })
    .eq("serial_number", serialNumber);

  if (error) throw error;
}

// Helper to update device target firmware
export async function setDeviceTargetFirmware(
  serialNumber: string,
  version: string | null,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("devices")
    .update({ target_firmware_version: version })
    .eq("serial_number", serialNumber);

  if (error) throw error;
}

// Helper to update release rollout percentage
export async function setReleaseRollout(
  version: string,
  percentage: number,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("releases")
    .update({ rollout_percentage: percentage })
    .eq("version", version);

  if (error) throw error;
}

// Helper to set latest release (uses atomic RPC function to avoid race conditions)
export async function setLatestRelease(version: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("set_latest_release", {
    target_version: version,
  });

  if (error) throw error;
}

// Auth helpers
export async function signIn(email: string, password: string) {
  const supabase = await getSupabase();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  const supabase = await getSupabase();
  return supabase.auth.signOut();
}

export async function getSession() {
  const supabase = await getSupabase();
  return supabase.auth.getSession();
}

export async function getUser() {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function onAuthStateChange(
  callback: (event: string, session: unknown) => void,
) {
  const supabase = await getSupabase();
  return supabase.auth.onAuthStateChange(callback);
}

// ============================================================================
// Pairing Types and Subscriptions
// ============================================================================

export interface Pairing {
  pairing_code: string;
  serial_number: string;
  device_id: string | null;
  app_last_seen: string | null;
  device_last_seen: string | null;
  app_connected: boolean;
  device_connected: boolean;
  webex_status: string;
  camera_on: boolean;
  mic_muted: boolean;
  in_call: boolean;
  display_name: string | null;
  rssi: number | null;
  free_heap: number | null;
  uptime: number | null;
  temperature: number | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Command {
  id: string;
  pairing_code: string;
  serial_number: string;
  command: string;
  payload: Record<string, unknown>;
  status: "pending" | "acked" | "failed" | "expired";
  created_at: string;
  acked_at: string | null;
  expires_at: string;
  response: Record<string, unknown> | null;
  error: string | null;
}

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
