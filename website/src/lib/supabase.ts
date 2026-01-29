/**
 * Supabase Client Configuration
 *
 * Provides the Supabase client for authentication and database access.
 */

// Supabase URL and anon key are public - they're meant to be exposed
// Row Level Security (RLS) protects the data
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;

function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return (Promise.race([Promise.resolve(promise), timeoutPromise]) as Promise<T>).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

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
  approval_required: boolean;
  disabled: boolean;
  blacklisted: boolean;
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
      detectSessionInUrl: true,
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
  approval_required,
  disabled,
  blacklisted,
  registered_at,
  provisioned_at,
  metadata
`;

// Helper to get devices from the display schema
export async function getDevices(): Promise<Device[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("devices")
      .select(DEVICE_COLUMNS)
      .order("last_seen", { ascending: false }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading devices.",
  );

  if (error) throw error;
  return data || [];
}

// Helper to get a single device
export async function getDevice(serialNumber: string): Promise<Device | null> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("serial_number", serialNumber)
      .single(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading the device record.",
  );

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

// Helper to get device logs by device_id (legacy)
export async function getDeviceLogs(
  deviceId: string,
  limit = 100,
): Promise<DeviceLog[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("device_logs")
      .select("id, device_id, serial_number, level, message, metadata, created_at")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(limit),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading device logs.",
  );

  if (error) throw error;
  return data || [];
}

// Helper to get device logs by serial_number (preferred)
export async function getDeviceLogsBySerial(
  serialNumber: string,
  limit = 100,
): Promise<DeviceLog[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("device_logs")
      .select("id, device_id, serial_number, level, message, metadata, created_at")
      .eq("serial_number", serialNumber)
      .order("created_at", { ascending: false })
      .limit(limit),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading device logs.",
  );

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
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("releases")
      .select(RELEASE_COLUMNS)
      .order("created_at", { ascending: false }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading releases.",
  );

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

// Helper to approve a device (clear approval_required)
export async function setDeviceApprovalRequired(
  serialNumber: string,
  approvalRequired: boolean,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("devices")
    .update({ approval_required: approvalRequired })
    .eq("serial_number", serialNumber);

  if (error) throw error;
}

// Helper to enable/disable a device
export async function setDeviceDisabled(
  serialNumber: string,
  disabled: boolean,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("devices")
    .update({ disabled })
    .eq("serial_number", serialNumber);

  if (error) throw error;
}

// Helper to blacklist/unblacklist a device
export async function setDeviceBlacklisted(
  serialNumber: string,
  blacklisted: boolean,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("devices")
    .update({ blacklisted })
    .eq("serial_number", serialNumber);

  if (error) throw error;
}

// Helper to delete a device
export async function deleteDevice(serialNumber: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("devices")
    .delete()
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
  return withTimeout(
    supabase.auth.getSession(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while checking your session.",
  );
}

export async function getUser() {
  const supabase = await getSupabase();
  const { data: { user } } = await withTimeout(
    supabase.auth.getUser(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while fetching user details.",
  );
  return user;
}

export async function onAuthStateChange(
  callback: (event: string, session: unknown) => void,
) {
  const supabase = await getSupabase();
  return supabase.auth.onAuthStateChange(callback);
}

export async function isAdmin(): Promise<boolean> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase.schema("display").rpc("is_admin"),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while checking admin permissions.",
  );
  if (error) throw error;
  return Boolean(data);
}

export interface UserProfile {
  user_id: string;
  email: string;
  role: "admin" | "user";
  first_name: string | null;
  last_name: string | null;
  disabled: boolean;
  created_at: string;
  created_by: string | null;
}

export interface UserDeviceAssignment {
  id: string;
  user_id: string;
  serial_number: string;
  created_at: string;
  created_by: string | null;
}

export async function getUserProfiles(): Promise<UserProfile[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("user_profiles")
      .select(
        "user_id, email, role, first_name, last_name, disabled, created_at, created_by",
      )
      .order("email", { ascending: true }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading user profiles.",
  );

  if (error) throw error;
  return data || [];
}

export async function getUserDeviceAssignments(): Promise<
  UserDeviceAssignment[]
> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("user_devices")
      .select("id, user_id, serial_number, created_at, created_by")
      .order("created_at", { ascending: false }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading device assignments.",
  );

  if (error) throw error;
  return data || [];
}

export async function assignDeviceToUser(
  userId: string,
  serialNumber: string,
): Promise<void> {
  const supabase = await getSupabase();
  const user = await getUser();
  const { error } = await supabase
    .schema("display")
    .from("user_devices")
    .insert({
      user_id: userId,
      serial_number: serialNumber,
      created_by: user?.id ?? null,
    });

  if (error) throw error;
}

export async function removeUserDeviceAssignment(assignmentId: string) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("user_devices")
    .delete()
    .eq("id", assignmentId);

  if (error) throw error;
}

export async function createUserWithRole(
  email: string,
  password: string,
  role: "admin" | "user",
): Promise<{ userId: string; existing: boolean }> {
  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured.");
  }

  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-create-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email,
      password,
      role,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to create user.");
  }

  return { userId: body.user_id, existing: Boolean(body.existing) };
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("user_profiles")
      .select(
        "user_id, email, role, first_name, last_name, disabled, created_at, created_by",
      )
      .eq("user_id", user.id)
      .single(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading your profile.",
  );

  if (error && error.code !== "PGRST116") throw error;
  return data || null;
}

export async function updateAdminUser(params: {
  userId: string;
  email?: string;
  password?: string;
  role?: "admin" | "user";
  firstName?: string | null;
  lastName?: string | null;
  disabled?: boolean;
}): Promise<void> {
  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured.");
  }

  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-update-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      user_id: params.userId,
      email: params.email,
      password: params.password,
      role: params.role,
      first_name: params.firstName,
      last_name: params.lastName,
      disabled: params.disabled,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to update user.");
  }
}

export async function deleteAdminUser(userId: string): Promise<void> {
  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured.");
  }

  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-delete-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ user_id: userId }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to delete user.");
  }
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
  firmware_version: string | null;
  ssid: string | null;
  ota_partition: string | null;
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
