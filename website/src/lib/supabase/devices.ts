import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  getSupabase,
  withTimeout,
} from "./core";
import type { Device, DeviceChangeEvent, DeviceLog, Pairing } from "./types";

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
  metadata,
  release_channel
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


// Helper to get pairings for a set of pairing codes
export async function getPairingsForDevices(
  pairingCodes: string[],
): Promise<Pick<Pairing, 'pairing_code' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>[]> {
  if (!pairingCodes.length) return [];

  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("pairings")
      .select("pairing_code, app_last_seen, device_last_seen, app_connected, device_connected")
      .in("pairing_code", pairingCodes),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading pairings.",
  );

  if (error) throw error;
  return data || [];
}

// Helper to get user_id for a device
export async function getDeviceUserId(deviceUuid: string): Promise<string | null> {
  const supabase = await getSupabase();
  const { data: userDevice, error: userDeviceError } = await withTimeout(
    supabase
      .schema("display")
      .from("user_devices")
      .select("user_id")
      .eq("device_uuid", deviceUuid)
      .maybeSingle(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading user device assignment.",
  );

  if (userDeviceError) throw userDeviceError;
  return userDevice?.user_id ?? null;
}

// Helper to get paired user for a device
export async function getPairedUser(deviceUuid: string): Promise<{ name?: string; email?: string } | null> {
  const supabase = await getSupabase();
  
  // Query 1: Get user_id from user_devices
  const { data: userDevice, error: userDeviceError } = await withTimeout(
    supabase
      .schema("display")
      .from("user_devices")
      .select("user_id")
      .eq("device_uuid", deviceUuid)
      .maybeSingle(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading user device assignment.",
  );

  if (userDeviceError) throw userDeviceError;
  if (!userDevice?.user_id) return null;

  // Query 2: Get user profile from user_profiles
  const { data: profile, error: profileError } = await withTimeout(
    supabase
      .schema("display")
      .from("user_profiles")
      .select("first_name, last_name, email")
      .eq("user_id", userDevice.user_id)
      .maybeSingle(),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading user profile.",
  );

  if (profileError) throw profileError;
  if (!profile) return null;

  // Build name from first_name and last_name
  const nameParts: string[] = [];
  if (profile.first_name) nameParts.push(profile.first_name);
  if (profile.last_name) nameParts.push(profile.last_name);
  const name = nameParts.length > 0 ? nameParts.join(" ") : undefined;

  return {
    name,
    email: profile.email,
  };
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
  
  // If device found, enrich with paired user info
  if (data) {
    try {
      const pairedUser = await getPairedUser(data.id);
      if (pairedUser) {
        return {
          ...data,
          paired_user_name: pairedUser.name ?? null,
          paired_user_email: pairedUser.email ?? null,
        };
      } else {
        return {
          ...data,
          paired_user_name: null,
          paired_user_email: null,
        };
      }
    } catch (err) {
      // If paired user lookup fails, return device without paired user info
      // This allows the device to still be displayed even if user lookup fails
      console.error("Failed to load paired user:", err);
      return {
        ...data,
        paired_user_name: null,
        paired_user_email: null,
      };
    }
  }
  
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

// Subscribe to realtime device logs via Supabase Realtime (broadcast)
// Now uses user-centric channel: user:{userUuid} with debug_log event
export async function subscribeToDeviceLogs(
  userUuid: string,
  onLog: (log: DeviceLog) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
  deviceUuid?: string, // Optional filter for specific device
): Promise<() => void> {
  const supabase = await getSupabase();
  const channelName = `user:${userUuid}`;

  const channel = supabase
    .channel(channelName, {
      config: {
        broadcast: { self: true },
        private: true
      }
    })
    .on(
      "broadcast",
      { event: "debug_log" },
      (payload) => {
        const record = payload.payload as {
          device_uuid?: string;
          serial_number?: string;
          device_id?: string;
          level: "debug" | "info" | "warn" | "error";
          message: string;
          metadata: Record<string, unknown>;
          ts?: number;
        };
        
        // Filter by deviceUuid if provided
        if (deviceUuid && record.device_uuid !== deviceUuid) {
          return;
        }
        
        onLog({
          id: `${record.device_id ?? record.device_uuid ?? 'unknown'}-${record.ts ?? Date.now()}`,
          device_id: record.device_id ?? record.device_uuid ?? '',
          serial_number: record.serial_number ?? null,
          level: record.level,
          message: record.message,
          metadata: record.metadata || {},
          created_at: new Date(record.ts ?? Date.now()).toISOString(),
        });
      },
    )
    .on(
      "broadcast",
      { event: "device_telemetry" },
      (payload) => {
        const record = payload.payload as {
          device_uuid?: string;
          rssi?: number;
          free_heap?: number;
          uptime?: number;
          firmware_version?: string;
          temperature?: number;
          ssid?: string;
          timestamp?: number;
        };

        // Filter by deviceUuid if provided
        if (deviceUuid && record.device_uuid !== deviceUuid) {
          return;
        }

        // Emit as a special "telemetry" log entry for display in admin panel
        onLog({
          id: `telemetry-${record.device_uuid ?? 'unknown'}-${record.timestamp ?? Date.now()}`,
          device_id: record.device_uuid ?? '',
          serial_number: null,
          level: 'info',
          message: `Telemetry: RSSI=${record.rssi}, Heap=${record.free_heap}, Uptime=${record.uptime}s`,
          metadata: record as Record<string, unknown>,
          created_at: new Date(record.timestamp ? record.timestamp * 1000 : Date.now()).toISOString(),
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

// Helper to set device release channel (beta/production)
export async function setDeviceReleaseChannel(
  serialNumber: string,
  channel: 'beta' | 'production',
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("devices")
    .update({ release_channel: channel })
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
