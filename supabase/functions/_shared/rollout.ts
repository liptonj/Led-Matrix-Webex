/**
 * Rollout Percentage Helper
 *
 * Determines if a device should receive a firmware update based on
 * the release's rollout percentage. Uses deterministic hashing to ensure
 * a device always gets the same result for the same version.
 */

/**
 * Check if a device is included in a rollout
 *
 * Uses deterministic hash so same device always gets same result for same version.
 * This ensures:
 * - Device "ABC123" checking version "1.5.1" at 50% rollout either always passes or always fails
 * - Increasing rollout to 75% adds more devices without removing any
 *
 * @param serialNumber - Device serial number (8-char CRC32 of eFuse MAC)
 * @param version - Firmware version being checked
 * @param rolloutPercentage - Percentage of devices that should receive the update (0-100)
 * @returns true if the device should receive the update
 */
export function isDeviceInRollout(
  serialNumber: string,
  version: string,
  rolloutPercentage: number,
): boolean {
  // Edge cases
  if (rolloutPercentage >= 100) return true;
  if (rolloutPercentage <= 0) return false;

  // Create deterministic hash from serial + version
  // This ensures the same device always gets the same result for the same version
  const input = `${serialNumber}:${version}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Convert to 0-99 range
  const devicePercentile = Math.abs(hash) % 100;

  // Device is included if its percentile is less than the rollout percentage
  return devicePercentile < rolloutPercentage;
}
