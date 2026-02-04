/**
 * Pairing Code Validation Helper
 * Validates pairing codes and checks expiration for Netflix-style provisioning timeout.
 */

export interface PairingCodeValidation {
  valid: boolean;
  code?: string;
  error?: string;
}

const VALID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Excludes I, O, 0, 1
const CODE_LENGTH = 6;
const EXPIRATION_MS = 240000; // 4 minutes

/** Validates pairing code: checks exists, normalizes to uppercase, validates 6 chars from charset A-HJ-NP-Z2-9 */
export function validatePairingCode(code: string | undefined): PairingCodeValidation {
  if (!code) return { valid: false, error: "Pairing code is required" };
  const normalized = code.toUpperCase();
  if (normalized.length !== CODE_LENGTH) {
    return { valid: false, code: normalized, error: `Pairing code must be exactly ${CODE_LENGTH} characters` };
  }
  for (const char of normalized) {
    if (!VALID_CHARS.includes(char)) {
      return { valid: false, code: normalized, error: `Invalid character '${char}'` };
    }
  }
  return { valid: true, code: normalized };
}

/** Checks if pairing code expired: returns true if more than 4 minutes have passed (Netflix-style timeout) */
export function isCodeExpired(createdAt: string | Date): boolean {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return Date.now() - created.getTime() > EXPIRATION_MS;
}
