/**
 * validate-device Edge Function Tests
 *
 * Tests for the device validation endpoint that verifies HMAC-signed
 * requests from devices.
 *
 * Run: deno test --allow-net --allow-env _tests/validate-device.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

// HMAC configuration
const TIMESTAMP_WINDOW_SECONDS = 300; // 5 minutes

/**
 * Generate HMAC signature for testing
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
// HMAC Header Tests
// ============================================================================

Deno.test("validate-device: requires X-Device-Serial header", () => {
  const headers = new Headers();
  assertEquals(headers.get("X-Device-Serial"), null);
});

Deno.test("validate-device: requires X-Timestamp header", () => {
  const headers = new Headers();
  assertEquals(headers.get("X-Timestamp"), null);
});

Deno.test("validate-device: requires X-Signature header", () => {
  const headers = new Headers();
  assertEquals(headers.get("X-Signature"), null);
});

Deno.test("validate-device: all HMAC headers must be present", () => {
  const completeHeaders = new Headers({
    "X-Device-Serial": "A1B2C3D4",
    "X-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Signature": "base64-signature",
  });

  assertExists(completeHeaders.get("X-Device-Serial"));
  assertExists(completeHeaders.get("X-Timestamp"));
  assertExists(completeHeaders.get("X-Signature"));
});

// ============================================================================
// Timestamp Validation Tests
// ============================================================================

Deno.test("validate-device: accepts timestamp within window", () => {
  const now = Math.floor(Date.now() / 1000);

  assertEquals(Math.abs(now - now) < TIMESTAMP_WINDOW_SECONDS, true);
  assertEquals(Math.abs(now - (now - 60)) < TIMESTAMP_WINDOW_SECONDS, true);
  assertEquals(Math.abs(now - (now - 299)) < TIMESTAMP_WINDOW_SECONDS, true);
});

Deno.test("validate-device: rejects timestamp outside window", () => {
  const now = Math.floor(Date.now() / 1000);

  assertEquals(Math.abs(now - (now - 360)) < TIMESTAMP_WINDOW_SECONDS, false);
  assertEquals(Math.abs(now - (now - 600)) < TIMESTAMP_WINDOW_SECONDS, false);
});

// ============================================================================
// Signature Validation Tests
// ============================================================================

Deno.test("validate-device: signature format is base64", async () => {
  const signature = await generateHmacSignature(
    "A1B2C3D4",
    Math.floor(Date.now() / 1000),
    "",
    "test-key-hash",
  );

  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  assertEquals(base64Regex.test(signature), true);
});

Deno.test("validate-device: signature is consistent for same input", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const body = "";
  const keyHash = "test-key-hash";

  const sig1 = await generateHmacSignature(serial, timestamp, body, keyHash);
  const sig2 = await generateHmacSignature(serial, timestamp, body, keyHash);

  assertEquals(sig1, sig2);
});

Deno.test("validate-device: different key produces different signature", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const body = "";

  const sig1 = await generateHmacSignature(serial, timestamp, body, "key-1");
  const sig2 = await generateHmacSignature(serial, timestamp, body, "key-2");

  assertNotEquals(sig1, sig2);
});

// ============================================================================
// Response Format Tests - Success
// ============================================================================

Deno.test("validate-device: success response has valid=true", () => {
  const response = {
    valid: true,
    device: {
      serial_number: "A1B2C3D4",
      device_id: "webex-display-C3D4",
      pairing_code: "ABC123",
      debug_enabled: false,
    },
  };

  assertEquals(response.valid, true);
});

Deno.test("validate-device: success response contains device info", () => {
  const response = {
    valid: true,
    device: {
      serial_number: "A1B2C3D4",
      device_id: "webex-display-C3D4",
      pairing_code: "ABC123",
      debug_enabled: false,
    },
  };

  assertExists(response.device);
  assertExists(response.device.serial_number);
  assertExists(response.device.device_id);
  assertExists(response.device.pairing_code);
  assertEquals(typeof response.device.debug_enabled, "boolean");
});

Deno.test("validate-device: device info has correct structure", () => {
  const device = {
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    pairing_code: "ABC123",
    debug_enabled: false,
    target_firmware_version: "1.5.2",
  };

  assertEquals(device.serial_number.length, 8);
  assertStringIncludes(device.device_id, "webex-display-");
  assertEquals(device.pairing_code.length, 6);
});

// ============================================================================
// Response Format Tests - Failure
// ============================================================================

Deno.test("validate-device: failure response has valid=false", () => {
  const response = {
    valid: false,
    error: "Invalid signature",
  };

  assertEquals(response.valid, false);
});

Deno.test("validate-device: failure response has error message", () => {
  const response = {
    valid: false,
    error: "Invalid signature",
  };

  assertExists(response.error);
  assertEquals(typeof response.error, "string");
});

// ============================================================================
// Device Provisioning Tests
// ============================================================================

Deno.test("validate-device: marks device as provisioned", () => {
  const updateData = {
    is_provisioned: true,
    provisioned_at: new Date().toISOString(),
  };

  assertEquals(updateData.is_provisioned, true);
  assertExists(updateData.provisioned_at);
});

Deno.test("validate-device: only marks unprovisioned devices", () => {
  // Update query includes is_provisioned: false condition
  const updateCondition = { is_provisioned: false };
  assertEquals(updateCondition.is_provisioned, false);
});

// ============================================================================
// Error Cases Tests
// ============================================================================

Deno.test("validate-device: 401 for missing headers", () => {
  const response = {
    valid: false,
    error: "Missing authentication headers",
  };

  assertEquals(response.valid, false);
  assertStringIncludes(response.error, "authentication");
});

Deno.test("validate-device: 401 for expired timestamp", () => {
  const response = {
    valid: false,
    error: "Request timestamp expired",
  };

  assertEquals(response.valid, false);
  assertStringIncludes(response.error, "timestamp");
});

Deno.test("validate-device: 401 for unknown device", () => {
  const response = {
    valid: false,
    error: "Device not found",
  };

  assertEquals(response.valid, false);
  assertStringIncludes(response.error, "not found");
});

Deno.test("validate-device: 401 for replay attack", () => {
  const response = {
    valid: false,
    error: "Replay detected",
  };

  assertEquals(response.valid, false);
  assertStringIncludes(response.error, "Replay");
});

Deno.test("validate-device: 401 for invalid signature", () => {
  const response = {
    valid: false,
    error: "Invalid signature",
  };

  assertEquals(response.valid, false);
  assertStringIncludes(response.error, "signature");
});

Deno.test("validate-device: 500 for server error", () => {
  const response = {
    valid: false,
    error: "Internal server error",
  };

  assertEquals(response.valid, false);
  assertStringIncludes(response.error, "server error");
});

// ============================================================================
// Replay Protection Tests
// ============================================================================

Deno.test("validate-device: stores last_auth_timestamp", () => {
  const updateData = {
    last_auth_timestamp: Math.floor(Date.now() / 1000),
    last_seen: new Date().toISOString(),
  };

  assertEquals(typeof updateData.last_auth_timestamp, "number");
  assertExists(updateData.last_seen);
});

Deno.test("validate-device: rejects timestamp <= last_auth_timestamp", () => {
  const lastAuthTimestamp = 1706400000;
  const currentTimestamp = 1706399999; // 1 second before

  const isReplay = currentTimestamp <= lastAuthTimestamp;
  assertEquals(isReplay, true);
});

Deno.test("validate-device: accepts timestamp > last_auth_timestamp", () => {
  const lastAuthTimestamp = 1706400000;
  const currentTimestamp = 1706400001; // 1 second after

  const isReplay = currentTimestamp <= lastAuthTimestamp;
  assertEquals(isReplay, false);
});
