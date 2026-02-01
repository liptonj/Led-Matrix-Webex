import type { Device, ConnectionHeartbeat } from "@/lib/supabase/types";

/**
 * Gets the last seen timestamp for a device, prioritizing heartbeat data over device record
 */
export function getLastSeenValue(
  device: Device,
  heartbeat?: ConnectionHeartbeat,
): string | null {
  return heartbeat?.device_last_seen ?? device.last_seen ?? null;
}

/**
 * Gets the last seen timestamp for a device from a heartbeat map
 */
export function getLastSeenValueFromMap(
  device: Device,
  heartbeatMap: Record<string, ConnectionHeartbeat>,
): string | null {
  return getLastSeenValue(device, heartbeatMap[device.pairing_code]);
}

/**
 * Gets the last seen time in milliseconds since epoch
 */
export function getLastSeenMs(
  device: Device,
  heartbeatMap: Record<string, ConnectionHeartbeat>,
): number {
  const lastSeen = getLastSeenValue(device, heartbeatMap[device.pairing_code]);
  return lastSeen ? new Date(lastSeen).getTime() : 0;
}

/**
 * Determines if a device is online based on heartbeat data
 * A device is considered online if its last seen time is within 5 minutes
 */
export function isDeviceOnline(
  device: Device,
  heartbeat: ConnectionHeartbeat | undefined,
  nowMs: number,
): boolean {
  const lastSeen = getLastSeenValue(device, heartbeat);
  const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;
  return lastSeenMs > nowMs - 5 * 60 * 1000;
}

/**
 * Determines if a device is online using a heartbeat map
 */
export function isDeviceOnlineFromMap(
  device: Device,
  heartbeatMap: Record<string, ConnectionHeartbeat>,
  nowMs: number,
): boolean {
  return isDeviceOnline(device, heartbeatMap[device.pairing_code], nowMs);
}

/**
 * Sorts devices by last seen time (most recent first)
 */
export function sortDevices(
  devices: Device[],
  heartbeatMap: Record<string, ConnectionHeartbeat>,
): Device[] {
  return [...devices].sort(
    (a, b) => getLastSeenMs(b, heartbeatMap) - getLastSeenMs(a, heartbeatMap),
  );
}
