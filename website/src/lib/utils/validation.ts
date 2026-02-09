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
