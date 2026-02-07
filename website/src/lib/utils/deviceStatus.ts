import type { Device, Pairing } from "@/lib/supabase/types";

/**
 * Gets the last seen timestamp for a device, prioritizing pairing data over device record
 */
export function getLastSeenValue(
  device: Device,
  pairing?: Pairing,
): string | null {
  return pairing?.device_last_seen ?? device.last_seen ?? null;
}

/**
 * Gets the last seen timestamp for a device from a pairing map
 */
export function getLastSeenValueFromMap(
  device: Device,
  pairingMap: Record<string, Pairing>,
): string | null {
  return getLastSeenValue(device, pairingMap[device.pairing_code]);
}

/**
 * Gets the last seen time in milliseconds since epoch
 */
export function getLastSeenMs(
  device: Device,
  pairingMap: Record<string, Pairing>,
): number {
  const lastSeen = getLastSeenValue(device, pairingMap[device.pairing_code]);
  return lastSeen ? new Date(lastSeen).getTime() : 0;
}

/**
 * Determines if a device is online based on pairing data
 * A device is considered online if its last seen time is within 5 minutes
 */
export function isDeviceOnline(
  device: Device,
  pairing: Pairing | undefined,
  nowMs: number,
): boolean {
  const lastSeen = getLastSeenValue(device, pairing);
  const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;
  return lastSeenMs > nowMs - 5 * 60 * 1000;
}

/**
 * Determines if a device is online using a pairing map
 */
export function isDeviceOnlineFromMap(
  device: Device,
  pairingMap: Record<string, Pairing>,
  nowMs: number,
): boolean {
  return isDeviceOnline(device, pairingMap[device.pairing_code], nowMs);
}

/**
 * Sorts devices by last seen time (most recent first)
 */
export function sortDevices(
  devices: Device[],
  pairingMap: Record<string, Pairing>,
): Device[] {
  return [...devices].sort(
    (a, b) => getLastSeenMs(b, pairingMap) - getLastSeenMs(a, pairingMap),
  );
}
