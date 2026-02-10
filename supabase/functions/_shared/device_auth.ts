/**
 * Unified Device Authentication Helper
 *
 * Provides dual-authentication validation for device-facing edge functions.
 * Requires BOTH JWT Bearer token and HMAC signature verification with
 * serial number cross-validation.
 *
 * Usage:
 *   const authResult = await validateDeviceAuth(req, supabase, bodyText);
 *   if (!authResult.valid) {
 *     return authErrorResponse(authResult);
 *   }
 *   // Use authResult.serialNumber, authResult.deviceId, etc.
 */

import { verifyDeviceToken, type TokenPayload } from "./jwt.ts";
import { validateHmacRequest } from "./hmac.ts";

// Re-export TokenPayload for convenience
export type { TokenPayload };

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface DeviceAuthResult {
  valid: boolean;
  error?: string;
  httpStatus?: number; // suggested HTTP status code for error responses
  serialNumber?: string;
  deviceId?: string;
  deviceUuid?: string; // Primary device identifier (from devices.id)
  debugEnabled?: boolean;
  targetFirmwareVersion?: string | null;
  userUuid?: string | null;
  tokenType?: string;
  tokenPayload?: TokenPayload; // re-export from jwt.ts
}

/**
 * Validate device request with dual authentication (JWT + HMAC)
 *
 * Step 1: Validate JWT Bearer token (required)
 * Step 2: Validate HMAC signature with timestamp (required)
 * Step 3: Cross-validate serial numbers match between JWT and HMAC
 *
 * @param req - The incoming Request object
 * @param supabase - Supabase client (service role)
 * @param bodyText - The raw request body text (needed for HMAC verification)
 * @param options - Optional configuration
 * @returns DeviceAuthResult
 */
export async function validateDeviceAuth(
  req: Request,
  supabase: SupabaseClient,
  bodyText: string,
  options?: {
    requireDeviceTokenType?: boolean; // default true - require token_type === "device"
    allowAppToken?: boolean; // default false - if true, skip HMAC for app tokens
  },
): Promise<DeviceAuthResult> {
  const requireDeviceTokenType = options?.requireDeviceTokenType !== false; // default true
  const allowAppToken = options?.allowAppToken === true; // default false

  // Get token secret from environment
  const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET") ||
    Deno.env.get("DEVICE_JWT_SECRET");
  if (!tokenSecret) {
    return {
      valid: false,
      error: "Server configuration error: JWT secret not configured",
      httpStatus: 500,
    };
  }

  // Step 1: Validate JWT Bearer token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      valid: false,
      error: "Missing or invalid Authorization header",
      httpStatus: 401,
    };
  }

  const token = authHeader.substring(7);
  let tokenPayload: TokenPayload;
  try {
    tokenPayload = await verifyDeviceToken(token, tokenSecret);
  } catch (err) {
    if (err instanceof Error && err.message.includes("expired")) {
      return {
        valid: false,
        error: "Token expired",
        httpStatus: 401,
      };
    }
    return {
      valid: false,
      error: "Invalid token",
      httpStatus: 401,
    };
  }

  // Validate token type if required
  if (requireDeviceTokenType && tokenPayload.token_type !== "device") {
    return {
      valid: false,
      error: "Invalid token type",
      httpStatus: 401,
    };
  }

  // Validate serial number is present in token
  if (!tokenPayload.serial_number) {
    return {
      valid: false,
      error: "Invalid token payload: missing serial_number",
      httpStatus: 401,
    };
  }

  // Step 2: Validate HMAC signature
  // Skip HMAC if app token is allowed and token type is "app"
  if (allowAppToken && tokenPayload.token_type === "app") {
    // Return success with JWT data only (no HMAC validation)
    return {
      valid: true,
      serialNumber: tokenPayload.serial_number,
      deviceUuid: tokenPayload.device_uuid,
      userUuid: tokenPayload.user_uuid ?? null,
      tokenType: tokenPayload.token_type,
      tokenPayload,
    };
  }

  // Validate HMAC for device tokens
  const hmacResult = await validateHmacRequest(req, supabase, bodyText);
  if (!hmacResult.valid) {
    return {
      valid: false,
      error: hmacResult.error || "HMAC verification failed",
      httpStatus: 401,
    };
  }

  if (!hmacResult.device) {
    return {
      valid: false,
      error: "HMAC validation failed: device data missing",
      httpStatus: 401,
    };
  }

  // Step 3: Cross-validate serial numbers
  if (tokenPayload.serial_number !== hmacResult.device.serial_number) {
    return {
      valid: false,
      error: "Serial number mismatch between JWT and HMAC",
      httpStatus: 401,
    };
  }

  // Success: Return combined data from both JWT and HMAC
  // Use device_uuid from HMAC result (freshest from DB) if available, otherwise from JWT
  return {
    valid: true,
    serialNumber: tokenPayload.serial_number,
    deviceId: hmacResult.device.device_id,
    deviceUuid: hmacResult.device.device_uuid || tokenPayload.device_uuid,
    debugEnabled: hmacResult.device.debug_enabled,
    targetFirmwareVersion: hmacResult.device.target_firmware_version,
    userUuid: tokenPayload.user_uuid ?? null,
    tokenType: tokenPayload.token_type,
    tokenPayload,
  };
}

/**
 * Create a JSON error response for auth failures
 */
export function authErrorResponse(result: DeviceAuthResult): Response {
  return new Response(
    JSON.stringify({ success: false, error: result.error || "Authentication failed" }),
    {
      status: result.httpStatus || 401,
      headers: { "Content-Type": "application/json" },
    },
  );
}
