/**
 * Pairing Code Validation Helper
 * Validates pairing codes and checks expiration for initial device pairing.
 * 
 * NOTE: Pairing codes are TEMPORARY identifiers used only during initial setup.
 * After a user pairs with a device, the code is cleared and device_uuid
 * becomes the sole identifier.
 */

export interface PairingCodeValidation {
  valid: boolean;
  code?: string;
  error?: string;
}

const VALID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Excludes I, O, 0, 1
const CODE_LENGTH = 6;
const DEFAULT_EXPIRATION_MINUTES = 10; // 10 minutes default for generated codes

/** Validates pairing code format: checks exists, normalizes to uppercase, validates 6 chars from charset A-HJ-NP-Z2-9 */
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

/** 
 * Checks if pairing code has expired based on the expiration timestamp.
 * @param expiresAt - The expiration timestamp (pairing_code_expires_at column)
 * @returns true if expired or if expiresAt is null
 */
export function isCodeExpired(expiresAt: string | Date | null): boolean {
  if (!expiresAt) return true; // No expiration = expired
  const expires = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return Date.now() > expires.getTime();
}

/**
 * Generates a new pairing code with expiration time.
 * @param expirationMinutes - Minutes until code expires (default 10)
 * @returns Object with code and expiresAt timestamp
 */
export function generatePairingCode(expirationMinutes: number = DEFAULT_EXPIRATION_MINUTES): { 
  code: string; 
  expiresAt: Date;
} {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += VALID_CHARS[Math.floor(Math.random() * VALID_CHARS.length)];
  }
  const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);
  return { code, expiresAt };
}
