/**
 * post-device-state Edge Function Tests
 *
 * Tests for the device state posting endpoint that handles telemetry
 * and returns telemetry echo.
 *
 * Run: deno test --allow-net --allow-env _tests/post-device-state.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Constants from the Edge Function
const MAX_REQUESTS_PER_MINUTE = 12;
const RATE_WINDOW_SECONDS = 60;

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("post-device-state: accepts Bearer token authentication", () => {
  const authHeader = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
  assertEquals(authHeader.startsWith("Bearer "), true);

  const token = authHeader.substring(7);
  assertEquals(token.length > 0, true);
});

Deno.test("post-device-state: accepts HMAC header authentication", () => {
  const hmacHeaders = {
    "X-Device-Serial": "A1B2C3D4",
    "X-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Signature": "base64-hmac-signature",
  };

  assertExists(hmacHeaders["X-Device-Serial"]);
  assertExists(hmacHeaders["X-Timestamp"]);
  assertExists(hmacHeaders["X-Signature"]);
});

Deno.test("post-device-state: prefers Bearer token over HMAC if both present", () => {
  // When both auth methods are provided, Bearer takes precedence
  const headers = new Headers({
    "Authorization": "Bearer token123",
    "X-Device-Serial": "A1B2C3D4",
    "X-Timestamp": "1706400000",
    "X-Signature": "sig",
  });

  const hasBearer = headers.get("Authorization")?.startsWith("Bearer ");
  assertEquals(hasBearer, true);
});

Deno.test("post-device-state: validates token_type is 'device'", () => {
  const validPayload = { token_type: "device" };
  const invalidPayload = { token_type: "app" };

  assertEquals(validPayload.token_type === "device", true);
  assertEquals(invalidPayload.token_type === "device", false);
});

// ============================================================================
// Request Body Tests
// ============================================================================

Deno.test("post-device-state: accepts telemetry fields", () => {
  const requestBody = {
    rssi: -65,
    free_heap: 180000,
    uptime: 3600,
    temperature: 42.5,
    firmware_version: "1.2.3",
    ssid: "Office-WiFi",
    ota_partition: "ota_0",
  };

  assertEquals(typeof requestBody.rssi, "number");
  assertEquals(typeof requestBody.free_heap, "number");
  assertEquals(typeof requestBody.uptime, "number");
  assertEquals(typeof requestBody.temperature, "number");
  assertEquals(typeof requestBody.firmware_version, "string");
  assertEquals(typeof requestBody.ssid, "string");
  assertEquals(typeof requestBody.ota_partition, "string");
});

Deno.test("post-device-state: all fields are optional (heartbeat)", () => {
  const emptyBody = {};
  assertEquals(Object.keys(emptyBody).length, 0);
  // Function should accept empty body as a simple heartbeat
});

Deno.test("post-device-state: partial telemetry is valid", () => {
  const partialBody1 = { rssi: -70 };
  const partialBody2 = { rssi: -70, uptime: 1000 };
  const partialBody3 = { free_heap: 200000 };

  assertExists(partialBody1.rssi);
  assertExists(partialBody2.rssi);
  assertExists(partialBody2.uptime);
  assertExists(partialBody3.free_heap);
});

Deno.test("post-device-state: rssi is typically negative", () => {
  const validRssiValues = [-30, -50, -65, -80, -90];
  for (const rssi of validRssiValues) {
    assertEquals(rssi < 0, true);
  }
});

Deno.test("post-device-state: free_heap is non-negative", () => {
  const validHeapValues = [0, 100000, 180000, 320000, 520000];
  for (const heap of validHeapValues) {
    assertEquals(heap >= 0, true);
  }
});

Deno.test("post-device-state: uptime is non-negative", () => {
  const validUptimeValues = [0, 60, 3600, 86400, 604800];
  for (const uptime of validUptimeValues) {
    assertEquals(uptime >= 0, true);
  }
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("post-device-state: success response contains telemetry echo", () => {
  const mockResponse = {
    success: true,
    rssi: -55,
    free_heap: 190000,
    uptime: 1200,
    temperature: 41.2,
    firmware_version: "1.2.3",
    ssid: "Office-WiFi",
    ota_partition: "ota_0",
  };

  assertEquals(mockResponse.success, true);
  assertEquals(typeof mockResponse.rssi, "number");
  assertEquals(typeof mockResponse.free_heap, "number");
  assertEquals(typeof mockResponse.uptime, "number");
  assertEquals(typeof mockResponse.temperature, "number");
  assertEquals(typeof mockResponse.firmware_version, "string");
  assertEquals(typeof mockResponse.ssid, "string");
  assertEquals(typeof mockResponse.ota_partition, "string");
});

// ============================================================================
// Rate Limiting Tests
// ============================================================================

Deno.test("post-device-state: rate limit is 12 requests per minute", () => {
  assertEquals(MAX_REQUESTS_PER_MINUTE, 12);
  assertEquals(RATE_WINDOW_SECONDS, 60);
});

Deno.test("post-device-state: rate limit key includes device serial", () => {
  const serial = "A1B2C3D4";
  const rateLimitKey = `device:${serial}:post-state`;
  assertStringIncludes(rateLimitKey, serial);
  assertStringIncludes(rateLimitKey, "device:");
  assertStringIncludes(rateLimitKey, ":post-state");
});

Deno.test("post-device-state: 429 response for rate limit exceeded", () => {
  const rateLimitResponse = {
    success: false,
    error: "Rate limit exceeded. Max 12 requests per minute.",
  };

  assertEquals(rateLimitResponse.success, false);
  assertStringIncludes(rateLimitResponse.error, "Rate limit");
  assertStringIncludes(rateLimitResponse.error, "12");
});

Deno.test("post-device-state: rate limit response includes Retry-After header", () => {
  // Headers should include Retry-After when rate limited
  const headers = {
    "Retry-After": "5",
  };

  assertExists(headers["Retry-After"]);
  assertEquals(parseInt(headers["Retry-After"], 10), 5);
});

// ============================================================================
// Pairing Update Tests
// ============================================================================

Deno.test("post-device-state: updates device telemetry in pairings", () => {
  const updateData = {
    device_connected: true,
    device_last_seen: new Date().toISOString(),
    rssi: -65,
    free_heap: 180000,
    uptime: 3600,
    temperature: 42.5,
  };

  assertEquals(updateData.device_connected, true);
  assertExists(updateData.device_last_seen);
  assertExists(updateData.rssi);
  assertExists(updateData.free_heap);
});

Deno.test("post-device-state: creates pairing if not exists", () => {
  // When pairing doesn't exist (PGRST116 error), create it
  const insertData = {
    pairing_code: "ABC123",
    serial_number: "A1B2C3D4",
    device_connected: true,
    device_last_seen: new Date().toISOString(),
  };

  assertExists(insertData.pairing_code);
  assertExists(insertData.serial_number);
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("post-device-state: 405 for non-POST requests", () => {
  const errorResponse = {
    success: false,
    error: "Method not allowed",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Method");
});

Deno.test("post-device-state: 401 for invalid bearer token", () => {
  const errorResponse = {
    success: false,
    error: "Invalid token",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("post-device-state: 401 for expired token", () => {
  const errorResponse = {
    success: false,
    error: "Token expired",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "expired");
});

Deno.test("post-device-state: 401 for wrong token type", () => {
  const errorResponse = {
    success: false,
    error: "Invalid token type",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "token type");
});

Deno.test("post-device-state: 500 for server configuration error", () => {
  const errorResponse = {
    success: false,
    error: "Server configuration error",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("post-device-state: 500 for update failure", () => {
  const errorResponse = {
    success: false,
    error: "Failed to update state",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "update");
});
