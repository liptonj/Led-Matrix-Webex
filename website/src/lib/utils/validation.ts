/**
 * Validates a pairing code format.
 * Valid codes are 6 characters using A-H, J-N, P-Z and 2-9.
 * (Excludes I, O, 0, 1 to avoid visual confusion)
 *
 * @param code - The pairing code to validate
 * @returns `true` if the code matches the required format, `false` otherwise
 */
export function isValidPairingCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}

/**
 * Validates a UUID format (UUID v4).
 *
 * @param uuid - The UUID to validate
 * @returns `true` if the UUID matches the required format, `false` otherwise
 */
export function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}
