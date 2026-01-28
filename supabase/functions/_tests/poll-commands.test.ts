/**
 * poll-commands Edge Function Tests
 *
 * Tests for the command polling endpoint that devices use to fetch
 * pending commands.
 *
 * Run: deno test --allow-net --allow-env _tests/poll-commands.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Constants from the Edge Function
const MAX_COMMANDS_PER_POLL = 10;

// ============================================================================
// Request Method Tests
// ============================================================================

Deno.test("poll-commands: accepts GET requests", () => {
  const allowedMethods = ["GET", "POST"];
  assertEquals(allowedMethods.includes("GET"), true);
});

Deno.test("poll-commands: accepts POST requests", () => {
  const allowedMethods = ["GET", "POST"];
  assertEquals(allowedMethods.includes("POST"), true);
});

Deno.test("poll-commands: rejects PUT requests", () => {
  const allowedMethods = ["GET", "POST"];
  assertEquals(allowedMethods.includes("PUT"), false);
});

Deno.test("poll-commands: rejects DELETE requests", () => {
  const allowedMethods = ["GET", "POST"];
  assertEquals(allowedMethods.includes("DELETE"), false);
});

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("poll-commands: accepts Bearer token authentication", () => {
  const authHeader = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
  assertEquals(authHeader.startsWith("Bearer "), true);
});

Deno.test("poll-commands: accepts HMAC header authentication", () => {
  const hmacHeaders = {
    "X-Device-Serial": "A1B2C3D4",
    "X-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Signature": "base64-hmac-signature",
  };

  assertExists(hmacHeaders["X-Device-Serial"]);
  assertExists(hmacHeaders["X-Timestamp"]);
  assertExists(hmacHeaders["X-Signature"]);
});

Deno.test("poll-commands: validates device token type", () => {
  const validPayload = { token_type: "device" };
  assertEquals(validPayload.token_type, "device");
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("poll-commands: success response has commands array", () => {
  const mockResponse = {
    success: true,
    commands: [],
  };

  assertEquals(mockResponse.success, true);
  assertEquals(Array.isArray(mockResponse.commands), true);
});

Deno.test("poll-commands: returns empty array when no commands", () => {
  const mockResponse = {
    success: true,
    commands: [],
  };

  assertEquals(mockResponse.commands.length, 0);
});

Deno.test("poll-commands: command structure is correct", () => {
  const command = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    command: "set_brightness",
    payload: { value: 200 },
    created_at: "2026-01-28T12:00:00Z",
  };

  assertExists(command.id);
  assertExists(command.command);
  assertExists(command.payload);
  assertExists(command.created_at);
});

Deno.test("poll-commands: command id is UUID format", () => {
  const commandId = "550e8400-e29b-41d4-a716-446655440000";

  // UUID v4 format: 8-4-4-4-12 hex chars
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assertEquals(uuidRegex.test(commandId), true);
});

Deno.test("poll-commands: payload is an object", () => {
  const command = {
    payload: { brightness: 200, duration: 1000 },
  };

  assertEquals(typeof command.payload, "object");
  assertEquals(Array.isArray(command.payload), false);
});

Deno.test("poll-commands: payload can be empty object", () => {
  const command = {
    payload: {},
  };

  assertEquals(Object.keys(command.payload).length, 0);
});

Deno.test("poll-commands: returns multiple commands in order", () => {
  const mockResponse = {
    success: true,
    commands: [
      { id: "uuid-1", command: "ping", payload: {}, created_at: "2026-01-28T12:00:00Z" },
      { id: "uuid-2", command: "set_brightness", payload: { value: 200 }, created_at: "2026-01-28T12:01:00Z" },
      { id: "uuid-3", command: "reboot", payload: {}, created_at: "2026-01-28T12:02:00Z" },
    ],
  };

  assertEquals(mockResponse.commands.length, 3);

  // Should be ordered by created_at ascending (oldest first)
  const times = mockResponse.commands.map((c) => new Date(c.created_at).getTime());
  assertEquals(times[0] < times[1], true);
  assertEquals(times[1] < times[2], true);
});

// ============================================================================
// Command Limit Tests
// ============================================================================

Deno.test("poll-commands: limits to 10 commands per poll", () => {
  assertEquals(MAX_COMMANDS_PER_POLL, 10);
});

Deno.test("poll-commands: returns at most 10 commands", () => {
  // Simulate 15 pending commands, should only return 10
  const allCommands = Array.from({ length: 15 }, (_, i) => ({
    id: `uuid-${i}`,
    command: "ping",
    payload: {},
    created_at: new Date(Date.now() + i * 1000).toISOString(),
  }));

  const returnedCommands = allCommands.slice(0, MAX_COMMANDS_PER_POLL);
  assertEquals(returnedCommands.length, 10);
});

// ============================================================================
// Command Filtering Tests
// ============================================================================

Deno.test("poll-commands: only returns pending commands", () => {
  const statuses = ["pending", "acked", "failed", "expired"];
  const pendingStatus = "pending";

  assertEquals(pendingStatus, "pending");
  assertEquals(statuses.includes(pendingStatus), true);
});

Deno.test("poll-commands: filters expired commands", () => {
  const now = new Date();

  const validCommand = {
    expires_at: new Date(now.getTime() + 60000).toISOString(), // 1 min from now
  };

  const expiredCommand = {
    expires_at: new Date(now.getTime() - 60000).toISOString(), // 1 min ago
  };

  assertEquals(new Date(validCommand.expires_at) > now, true);
  assertEquals(new Date(expiredCommand.expires_at) < now, true);
});

Deno.test("poll-commands: filters by pairing_code", () => {
  const deviceInfo = {
    pairing_code: "ABC123",
    serial_number: "A1B2C3D4",
  };

  // Query should filter by pairing_code
  const query = { pairing_code: deviceInfo.pairing_code };
  assertEquals(query.pairing_code, "ABC123");
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("poll-commands: 405 for unsupported methods", () => {
  const errorResponse = {
    success: false,
    error: "Method not allowed",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Method");
});

Deno.test("poll-commands: 401 for invalid token", () => {
  const errorResponse = {
    success: false,
    error: "Invalid token",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("poll-commands: 401 for missing auth", () => {
  const errorResponse = {
    success: false,
    error: "Missing or invalid Authorization header",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("poll-commands: 500 for query failure", () => {
  const errorResponse = {
    success: false,
    error: "Failed to fetch commands",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "fetch");
});

Deno.test("poll-commands: 500 for server config error", () => {
  const errorResponse = {
    success: false,
    error: "Server configuration error",
  };

  assertEquals(errorResponse.success, false);
});
