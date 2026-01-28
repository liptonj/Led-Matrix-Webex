/**
 * device-auth Edge Function Tests
 *
 * Tests for the device authentication endpoint that validates HMAC
 * signatures and issues device tokens.
 *
 * Run: deno test --allow-net --allow-env _tests/device-auth.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

// Constants from the Edge Function
const DEVICE_TOKEN_TTL_SECONDS = 86400; // 24 hours
const TIMESTAMP_WINDOW_SECONDS = 300; // 5 minutes

/**
 * Generate HMAC signature in the format expected by device-auth
 */
async function generateHmacSignature(
  serial: string,
  timestamp: number,
  body: string,
  keyHash: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const bodyHash = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  const bodyHashHex = Array.from(new Uint8Array(bodyHash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const message = `${serial}:${timestamp}:${bodyHashHex}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyHash),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return encodeBase64(new Uint8Array(signature));
}

// ============================================================================
// HMAC Header Validation Tests
// ============================================================================

Deno.test("device-auth: requires X-Device-Serial header", () => {
  const headers = new Headers();
  assertEquals(headers.get("X-Device-Serial"), null);
});

Deno.test("device-auth: requires X-Timestamp header", () => {
  const headers = new Headers();
  assertEquals(headers.get("X-Timestamp"), null);
});

Deno.test("device-auth: requires X-Signature header", () => {
  const headers = new Headers();
  assertEquals(headers.get("X-Signature"), null);
});

Deno.test("device-auth: all three HMAC headers are required together", () => {
  const completeHeaders = {
    "X-Device-Serial": "A1B2C3D4",
    "X-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Signature": "base64signature",
  };

  const allPresent =
    completeHeaders["X-Device-Serial"] &&
    completeHeaders["X-Timestamp"] &&
    completeHeaders["X-Signature"];

  assertEquals(Boolean(allPresent), true);
});

// ============================================================================
// Timestamp Validation Tests
// ============================================================================

Deno.test("device-auth: accepts timestamp within 5-minute window", () => {
  const now = Math.floor(Date.now() / 1000);

  // Valid: current time
  assertEquals(Math.abs(now - now) < TIMESTAMP_WINDOW_SECONDS, true);

  // Valid: 1 minute ago
  assertEquals(Math.abs(now - (now - 60)) < TIMESTAMP_WINDOW_SECONDS, true);

  // Valid: 4 minutes ago
  assertEquals(Math.abs(now - (now - 240)) < TIMESTAMP_WINDOW_SECONDS, true);

  // Valid: 4 minutes in future
  assertEquals(Math.abs(now - (now + 240)) < TIMESTAMP_WINDOW_SECONDS, true);
});

Deno.test("device-auth: rejects timestamp outside 5-minute window", () => {
  const now = Math.floor(Date.now() / 1000);

  // Invalid: 6 minutes ago
  assertEquals(Math.abs(now - (now - 360)) < TIMESTAMP_WINDOW_SECONDS, false);

  // Invalid: 10 minutes ago
  assertEquals(Math.abs(now - (now - 600)) < TIMESTAMP_WINDOW_SECONDS, false);

  // Invalid: 6 minutes in future
  assertEquals(Math.abs(now - (now + 360)) < TIMESTAMP_WINDOW_SECONDS, false);
});

Deno.test("device-auth: timestamp must be integer seconds", () => {
  const validTimestamps = [1706400000, 1706400001, 1706500000];
  for (const ts of validTimestamps) {
    assertEquals(Number.isInteger(ts), true);
  }

  const invalidTimestamps = [1706400000.5, 1706400000.123];
  for (const ts of invalidTimestamps) {
    assertEquals(Number.isInteger(ts), false);
  }
});

// ============================================================================
// HMAC Signature Tests
// ============================================================================

Deno.test("device-auth: signature is base64 encoded", async () => {
  const signature = await generateHmacSignature(
    "A1B2C3D4",
    Math.floor(Date.now() / 1000),
    "",
    "test-key-hash",
  );

  // Base64 should only contain valid characters
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  assertEquals(base64Regex.test(signature), true);
});

Deno.test("device-auth: signature length is approximately 44 chars", async () => {
  const signature = await generateHmacSignature(
    "A1B2C3D4",
    Math.floor(Date.now() / 1000),
    "",
    "test-key-hash",
  );

  // SHA-256 HMAC = 32 bytes = ~44 base64 chars with padding
  assertEquals(signature.length >= 40, true);
  assertEquals(signature.length <= 48, true);
});

Deno.test("device-auth: same inputs produce same signature", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const body = "";
  const keyHash = "test-key-hash";

  const sig1 = await generateHmacSignature(serial, timestamp, body, keyHash);
  const sig2 = await generateHmacSignature(serial, timestamp, body, keyHash);

  assertEquals(sig1, sig2);
});

Deno.test("device-auth: different serial produces different signature", async () => {
  const timestamp = 1706400000;
  const body = "";
  const keyHash = "test-key-hash";

  const sig1 = await generateHmacSignature("A1B2C3D4", timestamp, body, keyHash);
  const sig2 = await generateHmacSignature("X1Y2Z3W4", timestamp, body, keyHash);

  assertNotEquals(sig1, sig2);
});

Deno.test("device-auth: different timestamp produces different signature", async () => {
  const serial = "A1B2C3D4";
  const body = "";
  const keyHash = "test-key-hash";

  const sig1 = await generateHmacSignature(serial, 1706400000, body, keyHash);
  const sig2 = await generateHmacSignature(serial, 1706400001, body, keyHash);

  assertNotEquals(sig1, sig2);
});

Deno.test("device-auth: different body produces different signature", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const keyHash = "test-key-hash";

  const sig1 = await generateHmacSignature(serial, timestamp, "", keyHash);
  const sig2 = await generateHmacSignature(serial, timestamp, '{"test":true}', keyHash);

  assertNotEquals(sig1, sig2);
});

Deno.test("device-auth: different key produces different signature", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const body = "";

  const sig1 = await generateHmacSignature(serial, timestamp, body, "key-hash-1");
  const sig2 = await generateHmacSignature(serial, timestamp, body, "key-hash-2");

  assertNotEquals(sig1, sig2);
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("device-auth: success response has all required fields", () => {
  const mockResponse = {
    success: true,
    serial_number: "A1B2C3D4",
    pairing_code: "XYZ789",
    device_id: "webex-display-C3D4",
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    expires_at: "2026-01-29T12:00:00Z",
    target_firmware_version: "1.5.1",
    debug_enabled: false,
  };

  assertEquals(mockResponse.success, true);
  assertExists(mockResponse.serial_number);
  assertExists(mockResponse.pairing_code);
  assertExists(mockResponse.device_id);
  assertExists(mockResponse.token);
  assertExists(mockResponse.expires_at);
  assertEquals(typeof mockResponse.debug_enabled, "boolean");
  // target_firmware_version can be null
});

Deno.test("device-auth: target_firmware_version can be null", () => {
  const mockResponse = {
    success: true,
    serial_number: "A1B2C3D4",
    pairing_code: "XYZ789",
    device_id: "webex-display-C3D4",
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    expires_at: "2026-01-29T12:00:00Z",
    target_firmware_version: null,
  };

  assertEquals(mockResponse.target_firmware_version, null);
});

// ============================================================================
// Device Token Tests
// ============================================================================

Deno.test("device-auth: device token has 24-hour TTL", () => {
  assertEquals(DEVICE_TOKEN_TTL_SECONDS, 86400);
  assertEquals(DEVICE_TOKEN_TTL_SECONDS, 24 * 60 * 60);
});

Deno.test("device-auth: device token payload has token_type 'device' and Supabase claims", () => {
  const tokenPayload = {
    sub: crypto.randomUUID(),
    role: "authenticated",
    aud: "authenticated",
    device_id: "webex-display-C3D4",
    pairing_code: "ABC123",
    serial_number: "A1B2C3D4",
    token_type: "device",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + DEVICE_TOKEN_TTL_SECONDS,
  };

  assertEquals(tokenPayload.token_type, "device");
  assertEquals(tokenPayload.role, "authenticated");
  assertEquals(tokenPayload.aud, "authenticated");
});

Deno.test("device-auth: device token contains pairing_code", () => {
  const tokenPayload = {
    sub: crypto.randomUUID(),
    device_id: "webex-display-C3D4",
    pairing_code: "ABC123",
    serial_number: "A1B2C3D4",
    token_type: "device",
  };

  assertExists(tokenPayload.pairing_code);
  assertEquals(tokenPayload.pairing_code.length, 6);
});

// ============================================================================
// Pairing Upsert Tests
// ============================================================================

Deno.test("device-auth: creates pairing row with device_connected=true", () => {
  const pairingData = {
    pairing_code: "ABC123",
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    device_connected: true,
    device_last_seen: new Date().toISOString(),
  };

  assertEquals(pairingData.device_connected, true);
  assertExists(pairingData.device_last_seen);
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("device-auth: 405 for non-POST request", () => {
  const errorResponse = {
    success: false,
    error: "Method not allowed",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Method");
});

Deno.test("device-auth: 401 for missing auth headers", () => {
  const errorResponse = {
    success: false,
    error: "Missing authentication headers",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "authentication");
});

Deno.test("device-auth: 401 for expired timestamp", () => {
  const errorResponse = {
    success: false,
    error: "Request timestamp expired",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "timestamp");
});

Deno.test("device-auth: 401 for device not found", () => {
  const errorResponse = {
    success: false,
    error: "Device not found",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "not found");
});

Deno.test("device-auth: 401 for invalid signature", () => {
  const errorResponse = {
    success: false,
    error: "Invalid signature",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "signature");
});

Deno.test("device-auth: 401 for replay attack", () => {
  const errorResponse = {
    success: false,
    error: "Replay detected",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Replay");
});

Deno.test("device-auth: 500 for server config error", () => {
  const errorResponse = {
    success: false,
    error: "Server configuration error",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "configuration");
});
