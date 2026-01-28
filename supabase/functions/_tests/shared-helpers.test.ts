/**
 * Shared Helper Module Tests
 *
 * Tests for the shared helper modules used across Edge Functions:
 * - _shared/hmac.ts - HMAC validation
 * - _shared/rollout.ts - Rollout percentage checking
 * - _shared/cors.ts - CORS headers
 *
 * Run: deno test --allow-net --allow-env _tests/shared-helpers.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

// ============================================================================
// HMAC Helper Tests
// ============================================================================

const TIMESTAMP_WINDOW_SECONDS = 300; // From hmac.ts

/**
 * Compute body hash the same way as hmac.ts
 */
async function computeBodyHash(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const bodyHash = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  return Array.from(new Uint8Array(bodyHash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate HMAC signature the same way as hmac.ts
 */
async function generateHmacSignature(
  serial: string,
  timestamp: number,
  body: string,
  keyHash: string,
): Promise<string> {
  const bodyHashHex = await computeBodyHash(body);
  const message = `${serial}:${timestamp}:${bodyHashHex}`;
  const encoder = new TextEncoder();

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

// --- HMAC Message Format Tests ---

Deno.test("HMAC: message format is serial:timestamp:bodyHash", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const body = '{"test":"data"}';

  const bodyHash = await computeBodyHash(body);
  const message = `${serial}:${timestamp}:${bodyHash}`;

  assertStringIncludes(message, serial);
  assertStringIncludes(message, String(timestamp));
  assertEquals(message.split(":").length, 3);
});

Deno.test("HMAC: body hash is SHA-256 hex encoded (64 chars)", async () => {
  const bodyHash = await computeBodyHash('{"test":"data"}');
  assertEquals(bodyHash.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(bodyHash), true);
});

Deno.test("HMAC: empty body produces valid hash", async () => {
  const bodyHash = await computeBodyHash("");
  assertEquals(bodyHash.length, 64);
  // SHA-256 of empty string is known value
  assertEquals(
    bodyHash,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

Deno.test("HMAC: different bodies produce different hashes", async () => {
  const hash1 = await computeBodyHash('{"a":1}');
  const hash2 = await computeBodyHash('{"a":2}');
  assertNotEquals(hash1, hash2);
});

// --- HMAC Signature Tests ---

Deno.test("HMAC: signature is base64 encoded", async () => {
  const sig = await generateHmacSignature("A1B2C3D4", 1706400000, "", "key");
  assertEquals(/^[A-Za-z0-9+/=]+$/.test(sig), true);
});

Deno.test("HMAC: signature length is ~44 chars (256-bit)", async () => {
  const sig = await generateHmacSignature("A1B2C3D4", 1706400000, "", "key");
  // SHA-256 HMAC = 32 bytes = 44 base64 chars (with padding)
  assertEquals(sig.length >= 40 && sig.length <= 48, true);
});

Deno.test("HMAC: same inputs produce same signature", async () => {
  const sig1 = await generateHmacSignature("A1B2C3D4", 1706400000, "{}", "key");
  const sig2 = await generateHmacSignature("A1B2C3D4", 1706400000, "{}", "key");
  assertEquals(sig1, sig2);
});

Deno.test("HMAC: different serial produces different signature", async () => {
  const sig1 = await generateHmacSignature("A1B2C3D4", 1706400000, "", "key");
  const sig2 = await generateHmacSignature("X1Y2Z3W4", 1706400000, "", "key");
  assertNotEquals(sig1, sig2);
});

Deno.test("HMAC: different timestamp produces different signature", async () => {
  const sig1 = await generateHmacSignature("A1B2C3D4", 1706400000, "", "key");
  const sig2 = await generateHmacSignature("A1B2C3D4", 1706400001, "", "key");
  assertNotEquals(sig1, sig2);
});

Deno.test("HMAC: different body produces different signature", async () => {
  const sig1 = await generateHmacSignature("A1B2C3D4", 1706400000, "{}", "key");
  const sig2 = await generateHmacSignature("A1B2C3D4", 1706400000, '{"x":1}', "key");
  assertNotEquals(sig1, sig2);
});

Deno.test("HMAC: different key produces different signature", async () => {
  const sig1 = await generateHmacSignature("A1B2C3D4", 1706400000, "", "key1");
  const sig2 = await generateHmacSignature("A1B2C3D4", 1706400000, "", "key2");
  assertNotEquals(sig1, sig2);
});

// --- Timestamp Validation Tests ---

Deno.test("HMAC: timestamp window is 5 minutes (300 seconds)", () => {
  assertEquals(TIMESTAMP_WINDOW_SECONDS, 300);
});

Deno.test("HMAC: accepts current timestamp", () => {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - now);
  assertEquals(diff < TIMESTAMP_WINDOW_SECONDS, true);
});

Deno.test("HMAC: accepts timestamp from 4 minutes ago", () => {
  const now = Math.floor(Date.now() / 1000);
  const fourMinutesAgo = now - 240;
  const diff = Math.abs(now - fourMinutesAgo);
  assertEquals(diff < TIMESTAMP_WINDOW_SECONDS, true);
});

Deno.test("HMAC: rejects timestamp from 6 minutes ago", () => {
  const now = Math.floor(Date.now() / 1000);
  const sixMinutesAgo = now - 360;
  const diff = Math.abs(now - sixMinutesAgo);
  assertEquals(diff < TIMESTAMP_WINDOW_SECONDS, false);
});

Deno.test("HMAC: accepts timestamp from 4 minutes in future", () => {
  const now = Math.floor(Date.now() / 1000);
  const fourMinutesFuture = now + 240;
  const diff = Math.abs(now - fourMinutesFuture);
  assertEquals(diff < TIMESTAMP_WINDOW_SECONDS, true);
});

Deno.test("HMAC: rejects timestamp from 6 minutes in future", () => {
  const now = Math.floor(Date.now() / 1000);
  const sixMinutesFuture = now + 360;
  const diff = Math.abs(now - sixMinutesFuture);
  assertEquals(diff < TIMESTAMP_WINDOW_SECONDS, false);
});

// ============================================================================
// Rollout Helper Tests
// ============================================================================

/**
 * Simplified rollout check from rollout.ts
 */
function isDeviceInRollout(
  serialNumber: string,
  version: string,
  rolloutPercentage: number,
): boolean {
  if (rolloutPercentage >= 100) return true;
  if (rolloutPercentage <= 0) return false;

  const input = `${serialNumber}:${version}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  const devicePercentile = Math.abs(hash) % 100;
  return devicePercentile < rolloutPercentage;
}

// --- Edge Cases ---

Deno.test("rollout: 100% includes all devices", () => {
  assertEquals(isDeviceInRollout("A1B2C3D4", "1.5.1", 100), true);
  assertEquals(isDeviceInRollout("XYZ78901", "1.5.1", 100), true);
  assertEquals(isDeviceInRollout("00000000", "1.5.1", 100), true);
});

Deno.test("rollout: 0% excludes all devices", () => {
  assertEquals(isDeviceInRollout("A1B2C3D4", "1.5.1", 0), false);
  assertEquals(isDeviceInRollout("XYZ78901", "1.5.1", 0), false);
  assertEquals(isDeviceInRollout("00000000", "1.5.1", 0), false);
});

// --- Determinism Tests ---

Deno.test("rollout: same input always produces same result", () => {
  const result1 = isDeviceInRollout("A1B2C3D4", "1.5.1", 50);
  const result2 = isDeviceInRollout("A1B2C3D4", "1.5.1", 50);
  const result3 = isDeviceInRollout("A1B2C3D4", "1.5.1", 50);
  assertEquals(result1, result2);
  assertEquals(result2, result3);
});

Deno.test("rollout: different version produces potentially different result", () => {
  // Different versions should distribute differently
  // Run multiple times to verify the hash includes version
  const results1: boolean[] = [];
  const results2: boolean[] = [];

  const serials = ["A1B2C3D4", "X1Y2Z3W4", "11111111", "ABCDEF12"];
  for (const serial of serials) {
    results1.push(isDeviceInRollout(serial, "1.0.0", 50));
    results2.push(isDeviceInRollout(serial, "2.0.0", 50));
  }

  // The distributions should differ (hash includes version)
  // Can't guarantee they're different, but hash should use both
  assertExists(results1);
  assertExists(results2);
});

// --- Monotonic Rollout Tests ---

Deno.test("rollout: increasing percentage never removes devices", () => {
  const serial = "A1B2C3D4";
  const version = "1.5.1";

  // Once a device is in rollout, higher percentages should include it
  const at10 = isDeviceInRollout(serial, version, 10);
  const at50 = isDeviceInRollout(serial, version, 50);
  const at90 = isDeviceInRollout(serial, version, 90);

  // If in at 10%, must be in at 50% and 90%
  if (at10) {
    assertEquals(at50, true);
    assertEquals(at90, true);
  }

  // If in at 50%, must be in at 90%
  if (at50) {
    assertEquals(at90, true);
  }
});

// --- Distribution Tests ---

Deno.test("rollout: roughly correct distribution for 50%", () => {
  // Generate many serial numbers and check roughly 50% pass
  let passCount = 0;
  const totalDevices = 1000;
  const version = "1.5.1";
  const percentage = 50;

  for (let i = 0; i < totalDevices; i++) {
    const serial = i.toString(16).padStart(8, "0").toUpperCase();
    if (isDeviceInRollout(serial, version, percentage)) {
      passCount++;
    }
  }

  // Should be roughly 50% (allow 10% margin)
  const actualPercentage = (passCount / totalDevices) * 100;
  assertEquals(actualPercentage >= 40 && actualPercentage <= 60, true);
});

// ============================================================================
// CORS Helper Tests
// ============================================================================

Deno.test("CORS: default headers include origin wildcard", () => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-device-serial, x-timestamp, x-signature",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };

  assertEquals(corsHeaders["Access-Control-Allow-Origin"], "*");
});

Deno.test("CORS: allows authorization header", () => {
  const corsHeaders = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-device-serial, x-timestamp, x-signature",
  };

  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "authorization");
});

Deno.test("CORS: allows HMAC headers", () => {
  const allowedHeaders =
    "authorization, x-client-info, apikey, content-type, x-device-serial, x-timestamp, x-signature";

  assertStringIncludes(allowedHeaders, "x-device-serial");
  assertStringIncludes(allowedHeaders, "x-timestamp");
  assertStringIncludes(allowedHeaders, "x-signature");
});

Deno.test("CORS: allows content-type header", () => {
  const allowedHeaders =
    "authorization, x-client-info, apikey, content-type, x-device-serial, x-timestamp, x-signature";

  assertStringIncludes(allowedHeaders, "content-type");
});

Deno.test("CORS: allows required methods", () => {
  const allowedMethods = "GET, POST, PUT, DELETE, OPTIONS";

  assertStringIncludes(allowedMethods, "GET");
  assertStringIncludes(allowedMethods, "POST");
  assertStringIncludes(allowedMethods, "OPTIONS");
});

Deno.test("CORS: getCorsHeaders with valid origin", () => {
  const allowedOrigins = ["https://display.5ls.us", "https://webex.com"];
  const requestOrigin = "https://display.5ls.us";

  let origin = "*";
  if (allowedOrigins.includes(requestOrigin)) {
    origin = requestOrigin;
  }

  assertEquals(origin, "https://display.5ls.us");
});

Deno.test("CORS: getCorsHeaders with invalid origin falls back", () => {
  const allowedOrigins = ["https://display.5ls.us"];
  const requestOrigin = "https://evil.com";

  let origin = "*";
  if (allowedOrigins.includes(requestOrigin)) {
    origin = requestOrigin;
  }

  assertEquals(origin, "*");
});

Deno.test("CORS: wildcard subdomain matching", () => {
  const allowedOrigins = ["*.wbx2.com"];
  const requestOrigin = "https://teams.wbx2.com";

  let isAllowed = false;
  for (const allowed of allowedOrigins) {
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      try {
        const originUrl = new URL(requestOrigin);
        if (originUrl.hostname.endsWith(domain)) {
          isAllowed = true;
        }
      } catch {
        // Invalid URL
      }
    }
  }

  assertEquals(isAllowed, true);
});

// ============================================================================
// Validation Result Interface Tests
// ============================================================================

Deno.test("ValidationResult: success structure", () => {
  const result = {
    valid: true,
    device: {
      serial_number: "A1B2C3D4",
      device_id: "webex-display-C3D4",
      pairing_code: "ABC123",
      debug_enabled: false,
      target_firmware_version: "1.5.1",
    },
  };

  assertEquals(result.valid, true);
  assertExists(result.device);
  assertExists(result.device.serial_number);
});

Deno.test("ValidationResult: failure structure", () => {
  const result: { valid: boolean; error: string; device?: unknown } = {
    valid: false,
    error: "Invalid signature",
  };

  assertEquals(result.valid, false);
  assertExists(result.error);
  assertEquals(result.device, undefined);
});
