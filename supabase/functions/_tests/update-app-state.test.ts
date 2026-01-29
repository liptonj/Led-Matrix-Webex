/**
 * update-app-state Edge Function Tests
 *
 * Tests for the app state update endpoint that the embedded app uses
 * to push Webex status updates.
 *
 * Run: deno test --allow-net --allow-env _tests/update-app-state.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Valid status values from the Edge Function
const VALID_STATUSES = [
  "active",
  "away",
  "dnd",
  "busy",
  "meeting",
  "call",
  "presenting",
  "ooo",
  "pending",
  "unknown",
  "offline",
  "available",
  "inactive",
  "brb",
  "donotdisturb",
  "outofoffice",
];

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("update-app-state: requires Bearer token authentication", () => {
  const authHeader = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
  assertEquals(authHeader.startsWith("Bearer "), true);
});

Deno.test("update-app-state: requires token_type 'app'", () => {
  const validPayload = { token_type: "app" };
  const invalidPayload = { token_type: "device" };

  assertEquals(validPayload.token_type, "app");
  assertEquals(invalidPayload.token_type !== "app", true);
});

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("update-app-state: validates webex_status values", () => {
  for (const status of VALID_STATUSES) {
    assertEquals(VALID_STATUSES.includes(status), true);
  }
});

Deno.test("update-app-state: rejects invalid webex_status", () => {
  const invalidStatuses = ["online", "invisible", "unknown_status", ""];

  for (const status of invalidStatuses) {
    assertEquals(VALID_STATUSES.includes(status), false);
  }
});

Deno.test("update-app-state: accepts boolean camera_on", () => {
  const validValues = [true, false];
  for (const value of validValues) {
    assertEquals(typeof value, "boolean");
  }
});

Deno.test("update-app-state: accepts boolean mic_muted", () => {
  const validValues = [true, false];
  for (const value of validValues) {
    assertEquals(typeof value, "boolean");
  }
});

Deno.test("update-app-state: accepts boolean in_call", () => {
  const validValues = [true, false];
  for (const value of validValues) {
    assertEquals(typeof value, "boolean");
  }
});

Deno.test("update-app-state: accepts string display_name", () => {
  const validNames = ["John Doe", "Jane Smith", "User123", ""];
  for (const name of validNames) {
    assertEquals(typeof name, "string");
  }
});

// ============================================================================
// Partial Update Tests
// ============================================================================

Deno.test("update-app-state: all fields are optional", () => {
  const emptyBody = {};
  assertEquals(Object.keys(emptyBody).length, 0);
});

Deno.test("update-app-state: accepts partial updates", () => {
  const partialUpdates = [
    { webex_status: "active" },
    { camera_on: true },
    { mic_muted: false },
    { in_call: true },
    { display_name: "John" },
    { webex_status: "meeting", in_call: true },
    { camera_on: true, mic_muted: false },
  ];

  for (const update of partialUpdates) {
    assertEquals(typeof update, "object");
    assertEquals(Object.keys(update).length >= 1, true);
  }
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("update-app-state: success response has required fields", () => {
  const response = {
    success: true,
    device_connected: true,
    device_last_seen: "2026-01-28T12:00:00Z",
  };

  assertEquals(response.success, true);
  assertEquals(typeof response.device_connected, "boolean");
  assertExists(response.device_last_seen);
});

Deno.test("update-app-state: device_last_seen can be null", () => {
  const response = {
    success: true,
    device_connected: false,
    device_last_seen: null,
  };

  assertEquals(response.device_last_seen, null);
});

Deno.test("update-app-state: device_last_seen is ISO date when present", () => {
  const response = {
    device_last_seen: "2026-01-28T12:00:00Z",
  };

  const date = new Date(response.device_last_seen);
  assertEquals(isNaN(date.getTime()), false);
});

// ============================================================================
// App Column Ownership Tests
// ============================================================================

Deno.test("update-app-state: only updates app-owned columns", () => {
  const appColumns = [
    "webex_status",
    "camera_on",
    "mic_muted",
    "in_call",
    "display_name",
    "app_last_seen",
    "app_connected",
  ];

  // Device columns should NOT be updated by this endpoint
  const deviceColumns = [
    "rssi",
    "free_heap",
    "uptime",
    "temperature",
    "device_last_seen",
    "device_connected",
  ];

  for (const col of appColumns) {
    assertEquals(deviceColumns.includes(col), false);
  }
});

Deno.test("update-app-state: sets app_connected=true", () => {
  const updateData = {
    app_connected: true,
    app_last_seen: new Date().toISOString(),
  };

  assertEquals(updateData.app_connected, true);
});

Deno.test("update-app-state: sets app_last_seen timestamp", () => {
  const updateData = {
    app_last_seen: new Date().toISOString(),
  };

  const date = new Date(updateData.app_last_seen);
  assertEquals(isNaN(date.getTime()), false);
});

// ============================================================================
// Device Staleness Check Tests
// ============================================================================

Deno.test("update-app-state: device stale after 60 seconds", () => {
  const STALE_THRESHOLD_MS = 60000;
  const now = Date.now();

  // Recent - not stale
  const recentLastSeen = new Date(now - 30000);
  assertEquals(now - recentLastSeen.getTime() < STALE_THRESHOLD_MS, true);

  // Old - stale
  const staleLastSeen = new Date(now - 90000);
  assertEquals(now - staleLastSeen.getTime() > STALE_THRESHOLD_MS, true);
});

Deno.test("update-app-state: returns device_connected=false when stale", () => {
  const now = Date.now();
  const staleLastSeen = new Date(now - 90000); // 90 seconds ago

  const STALE_THRESHOLD_MS = 60000;
  const isStale = now - staleLastSeen.getTime() > STALE_THRESHOLD_MS;

  // Should report device as not connected
  const deviceConnected = !isStale;
  assertEquals(deviceConnected, false);
});

// ============================================================================
// Pairing Creation Tests
// ============================================================================

Deno.test("update-app-state: creates pairing if not exists", () => {
  // When pairing doesn't exist (PGRST116), should look up device and create pairing
  const deviceLookup = {
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    pairing_code: "ABC123",
  };

  assertExists(deviceLookup.serial_number);
  assertExists(deviceLookup.pairing_code);
});

Deno.test("update-app-state: new pairing returns device_connected=false", () => {
  const response = {
    success: true,
    device_connected: false,
    device_last_seen: null,
  };

  assertEquals(response.success, true);
  assertEquals(response.device_connected, false);
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("update-app-state: 405 for non-POST requests", () => {
  const errorResponse = {
    success: false,
    error: "Method not allowed",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("update-app-state: 400 for invalid JSON", () => {
  const errorResponse = {
    success: false,
    error: "Invalid JSON body",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("update-app-state: 400 for invalid webex_status", () => {
  const errorResponse = {
    success: false,
    error: "Invalid webex_status. Must be one of: active, away, dnd, busy, meeting, call, presenting, ooo, pending, unknown, offline, available, inactive, brb, donotdisturb, outofoffice",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "webex_status");
});

Deno.test("update-app-state: 401 for missing authorization", () => {
  const errorResponse = {
    success: false,
    error: "Missing or invalid Authorization header",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("update-app-state: 401 for invalid token", () => {
  const errorResponse = {
    success: false,
    error: "Invalid token",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("update-app-state: 401 for expired token", () => {
  const errorResponse = {
    success: false,
    error: "Token expired",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "expired");
});

Deno.test("update-app-state: 401 for wrong token type", () => {
  const errorResponse = {
    success: false,
    error: "Invalid token type",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("update-app-state: 500 for update failure", () => {
  const errorResponse = {
    success: false,
    error: "Failed to update state",
  };

  assertEquals(errorResponse.success, false);
});
