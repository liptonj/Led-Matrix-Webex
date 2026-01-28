/**
 * HMAC Validation Helper for Device Authentication
 *
 * Devices sign requests using HMAC-SHA256 with their device secret.
 * The server validates using the stored key_hash.
 */

import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

const TIMESTAMP_WINDOW_SECONDS = 300; // 5 minutes

export interface ValidationResult {
  valid: boolean;
  error?: string;
  device?: {
    serial_number: string;
    device_id: string;
    pairing_code: string;
    debug_enabled: boolean;
    target_firmware_version: string | null;
  };
}

/**
 * Validate HMAC-signed request from a device
 *
 * Expected headers:
 *   X-Device-Serial: 8-char CRC32 serial
 *   X-Timestamp: Unix timestamp (seconds)
 *   X-Signature: Base64-encoded HMAC-SHA256 signature
 *
 * Signature is computed as:
 *   message = serial + ":" + timestamp + ":" + sha256(body)
 *   signature = HMAC-SHA256(message, key_hash)
 */
interface DeviceRecord {
  serial_number: string;
  device_id: string;
  pairing_code: string;
  key_hash: string;
  debug_enabled: boolean;
  target_firmware_version: string | null;
  last_auth_timestamp: number | null;
}

// Use unknown to avoid type conflicts with actual Supabase client
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function validateHmacRequest(
  req: Request,
  supabase: SupabaseClient,
  body: string = "",
): Promise<ValidationResult> {
  const serialNumber = req.headers.get("X-Device-Serial");
  const timestamp = req.headers.get("X-Timestamp");
  const signature = req.headers.get("X-Signature");

  if (!serialNumber || !timestamp || !signature) {
    return { valid: false, error: "Missing authentication headers" };
  }

  // Validate timestamp is within window
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - requestTime) > TIMESTAMP_WINDOW_SECONDS) {
    return { valid: false, error: "Request timestamp expired" };
  }

  // Look up device
  const { data: device, error } = await supabase
    .schema("display")
    .from("devices")
    .select(
      "serial_number, device_id, pairing_code, key_hash, debug_enabled, target_firmware_version, last_auth_timestamp",
    )
    .eq("serial_number", serialNumber)
    .single();

  if (error || !device) {
    return { valid: false, error: "Device not found" };
  }

  // Optional: Check for replay (timestamp must be newer than last used)
  if (device.last_auth_timestamp && requestTime <= device.last_auth_timestamp) {
    return { valid: false, error: "Replay detected" };
  }

  // Compute expected signature
  const bodyHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const bodyHashHex = Array.from(new Uint8Array(bodyHash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const message = `${serialNumber}:${timestamp}:${bodyHashHex}`;

  // Use key_hash as the HMAC key (device uses same hash of its secret)
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(device.key_hash),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  const expectedSignature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );

  const expectedBase64 = encodeBase64(new Uint8Array(expectedSignature));

  if (signature !== expectedBase64) {
    return { valid: false, error: "Invalid signature" };
  }

  // Update last_auth_timestamp
  await supabase
    .schema("display")
    .from("devices")
    .update({
      last_auth_timestamp: requestTime,
      last_seen: new Date().toISOString(),
    })
    .eq("serial_number", serialNumber);

  return {
    valid: true,
    device: {
      serial_number: device.serial_number,
      device_id: device.device_id,
      pairing_code: device.pairing_code,
      debug_enabled: device.debug_enabled,
      target_firmware_version: device.target_firmware_version,
    },
  };
}
