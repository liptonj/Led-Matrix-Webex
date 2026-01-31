import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  getSupabase,
  withTimeout,
} from "./core";
import type { ConnectionHeartbeat, Device, DeviceChangeEvent, DeviceLog } from "./types";

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

// Helper to get connection heartbeats for a set of pairing codes
export async function getConnectionHeartbeats(
  pairingCodes: string[],
): Promise<ConnectionHeartbeat[]> {
  if (!pairingCodes.length) return [];

  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("connection_heartbeats")
      .select("pairing_code, app_last_seen, device_last_seen, app_connected, device_connected")
      .in("pairing_code", pairingCodes),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading connection heartbeats.",
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

// Subscribe to realtime device logs via Supabase Realtime (broadcast)
export async function subscribeToDeviceLogs(
  serialNumber: string,
  onLog: (log: DeviceLog) => void,
  onStatusChange?: (subscribed: boolean) => void,
  onError?: (error: string) => void,
): Promise<() => void> {
  const supabase = await getSupabase();

  const channel = supabase
    .channel(`device_logs:${serialNumber}`)
    .on(
      "broadcast",
      { event: "log" },
      (payload) => {
        const record = payload.payload as {
          serial_number: string;
          device_id: string;
          level: "debug" | "info" | "warn" | "error";
          message: string;
          metadata: Record<string, unknown>;
          ts?: number;
        };
        onLog({
          id: `${record.device_id}-${record.ts ?? Date.now()}`,
          device_id: record.device_id,
          serial_number: record.serial_number,
          level: record.level,
          message: record.message,
          metadata: record.metadata || {},
          created_at: new Date(record.ts ?? Date.now()).toISOString(),
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
