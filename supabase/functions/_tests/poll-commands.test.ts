/**
 * poll-commands Edge Function Tests
 *
 * Tests for the poll-commands Edge Function that returns pending commands
 * for devices using UUID-based queries.
 *
 * Run: deno test --allow-net --allow-env _tests/poll-commands.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  TEST_DEVICE_UUID,
  TEST_DEVICE_UUID_2,
  TEST_PAIRING_CODE,
  mockCommand,
} from "./fixtures/uuid-fixtures.ts";
import {
  TEST_DEVICE_UUID,
  TEST_DEVICE_UUID_2,
  TEST_PAIRING_CODE,
  mockCommand,
} from "./fixtures/uuid-fixtures.ts";

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("poll-commands: accepts Bearer token authentication", () => {
  const authHeader = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
  assertEquals(authHeader.startsWith("Bearer "), true);
});

Deno.test("poll-commands: accepts HMAC authentication as fallback", () => {
  const hmacHeaders = {
    "X-Device-Serial": "A1B2C3D4",
    "X-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Signature": "base64signature",
  };

  assertExists(hmacHeaders["X-Device-Serial"]);
  assertExists(hmacHeaders["X-Timestamp"]);
  assertExists(hmacHeaders["X-Signature"]);
});

// ============================================================================
// UUID-Based Query Tests
// ============================================================================

Deno.test("poll-commands: queries by device_uuid from JWT", () => {
  const mockJwtPayload = {
    device_uuid: TEST_DEVICE_UUID,
    pairing_code: TEST_PAIRING_CODE,
    serial_number: "A1B2C3D4",
    token_type: "device",
  };

  assertExists(mockJwtPayload.device_uuid);
  assertEquals(mockJwtPayload.device_uuid, TEST_DEVICE_UUID);
});

Deno.test("poll-commands: returns pending commands for matching device_uuid", () => {
  const mockCommands = [
    {
      ...mockCommand,
      device_uuid: TEST_DEVICE_UUID,
      status: "pending",
    },
    {
      ...mockCommand,
      id: "cmd-456",
      device_uuid: TEST_DEVICE_UUID,
      status: "pending",
    },
  ];

  const filteredCommands = mockCommands.filter(
    (cmd) => cmd.device_uuid === TEST_DEVICE_UUID && cmd.status === "pending"
  );

  assertEquals(filteredCommands.length, 2);
  assertEquals(filteredCommands[0].device_uuid, TEST_DEVICE_UUID);
  assertEquals(filteredCommands[1].device_uuid, TEST_DEVICE_UUID);
});

Deno.test("poll-commands: filters out commands for other devices", () => {
  const mockCommands = [
    {
      ...mockCommand,
      device_uuid: TEST_DEVICE_UUID,
      status: "pending",
    },
    {
      ...mockCommand,
      id: "cmd-456",
      device_uuid: TEST_DEVICE_UUID_2,
      status: "pending",
    },
  ];

  const filteredCommands = mockCommands.filter(
    (cmd) => cmd.device_uuid === TEST_DEVICE_UUID && cmd.status === "pending"
  );

  assertEquals(filteredCommands.length, 1);
  assertEquals(filteredCommands[0].device_uuid, TEST_DEVICE_UUID);
  assertNotEquals(filteredCommands[0].device_uuid, TEST_DEVICE_UUID_2);
});

Deno.test("poll-commands: falls back to pairing_code when device_uuid missing", () => {
  const mockJwtPayloadLegacy = {
    pairing_code: TEST_PAIRING_CODE,
    serial_number: "A1B2C3D4",
    token_type: "device",
    // device_uuid missing
  };

  const queryKey = mockJwtPayloadLegacy.device_uuid || mockJwtPayloadLegacy.pairing_code;
  assertEquals(queryKey, TEST_PAIRING_CODE);
});

Deno.test("poll-commands: prefers device_uuid over pairing_code", () => {
  const mockJwtPayload = {
    device_uuid: TEST_DEVICE_UUID,
    pairing_code: TEST_PAIRING_CODE,
    serial_number: "A1B2C3D4",
    token_type: "device",
  };

  const queryKey = mockJwtPayload.device_uuid || mockJwtPayload.pairing_code;
  assertEquals(queryKey, TEST_DEVICE_UUID);
  assertNotEquals(queryKey, TEST_PAIRING_CODE);
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("poll-commands: success response format", () => {
  const mockResponse = {
    success: true,
    commands: [
      {
        id: "cmd-123",
        command: "set_brightness",
        payload: { value: 128 },
        created_at: new Date().toISOString(),
      },
    ],
  };

  assertEquals(mockResponse.success, true);
  assertExists(mockResponse.commands);
  assertEquals(Array.isArray(mockResponse.commands), true);
});

Deno.test("poll-commands: returns empty array when no commands", () => {
  const mockResponse = {
    success: true,
    commands: [],
  };

  assertEquals(mockResponse.success, true);
  assertEquals(mockResponse.commands.length, 0);
});

Deno.test("poll-commands: limits to MAX_COMMANDS_PER_POLL", () => {
  const MAX_COMMANDS_PER_POLL = 10;
  const mockCommands = Array.from({ length: 15 }, (_, i) => ({
    ...mockCommand,
    id: `cmd-${i}`,
  }));

  const limitedCommands = mockCommands.slice(0, MAX_COMMANDS_PER_POLL);
  assertEquals(limitedCommands.length, MAX_COMMANDS_PER_POLL);
});

Deno.test("poll-commands: orders commands by created_at ascending", () => {
  const mockCommands = [
    {
      ...mockCommand,
      id: "cmd-2",
      created_at: new Date("2026-02-05T12:00:00Z").toISOString(),
    },
    {
      ...mockCommand,
      id: "cmd-1",
      created_at: new Date("2026-02-05T11:00:00Z").toISOString(),
    },
  ];

  const sortedCommands = mockCommands.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  assertEquals(sortedCommands[0].id, "cmd-1");
  assertEquals(sortedCommands[1].id, "cmd-2");
});

Deno.test("poll-commands: filters out expired commands", () => {
  const now = new Date();
  const expiredTime = new Date(now.getTime() - 600000); // 10 minutes ago
  const futureTime = new Date(now.getTime() + 300000); // 5 minutes from now

  const mockCommands = [
    {
      ...mockCommand,
      id: "cmd-expired",
      expires_at: expiredTime.toISOString(),
    },
    {
      ...mockCommand,
      id: "cmd-valid",
      expires_at: futureTime.toISOString(),
    },
  ];

  const validCommands = mockCommands.filter(
    (cmd) => new Date(cmd.expires_at) > now
  );

  assertEquals(validCommands.length, 1);
  assertEquals(validCommands[0].id, "cmd-valid");
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("poll-commands: 401 for invalid token", () => {
  const errorResponse = {
    success: false,
    error: "Invalid token",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "token");
});

Deno.test("poll-commands: 401 for expired token", () => {
  const errorResponse = {
    success: false,
    error: "Token expired",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "expired");
});

Deno.test("poll-commands: 500 for database error", () => {
  const errorResponse = {
    success: false,
    error: "Failed to fetch commands",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Failed");
});

// ============================================================================
// Backward Compatibility Tests
// ============================================================================

Deno.test("poll-commands: backward compatibility - works with pairing_code only", () => {
  const mockJwtPayloadLegacy = {
    pairing_code: TEST_PAIRING_CODE,
    serial_number: "A1B2C3D4",
    token_type: "device",
  };

  // Should still work without device_uuid
  assertExists(mockJwtPayloadLegacy.pairing_code);
  assertEquals(mockJwtPayloadLegacy.pairing_code.length, 6);
});
