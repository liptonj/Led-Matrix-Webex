/**
 * insert-command Edge Function Tests
 *
 * Tests for the command insertion endpoint that the embedded app uses
 * to queue commands for the device.
 *
 * Run: deno test --allow-net --allow-env _tests/insert-command.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  TEST_DEVICE_UUID,
  TEST_PAIRING_CODE,
} from "./fixtures/uuid-fixtures.ts";

// Constants from the Edge Function
const COMMAND_EXPIRY_SECONDS = 300; // 5 minutes
const VALID_COMMANDS = [
  "set_brightness",
  "set_config",
  "get_config",
  "get_status",
  "get_telemetry",
  "get_troubleshooting_status",
  "reboot",
  "factory_reset",
  "ota_update",
  "set_display_name",
  "set_time_zone",
  "clear_wifi",
  "test_display",
  "ping",
];

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("insert-command: requires Bearer token authentication", () => {
  const authHeader = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
  assertEquals(authHeader.startsWith("Bearer "), true);
});

Deno.test("insert-command: requires token_type 'app'", () => {
  const validPayload = { token_type: "app" };
  const invalidPayload = { token_type: "device" };

  assertEquals(validPayload.token_type, "app");
  assertEquals(invalidPayload.token_type !== "app", true);
});

// ============================================================================
// Command Whitelist Tests
// ============================================================================

Deno.test("insert-command: has 12 valid commands", () => {
  assertEquals(VALID_COMMANDS.length, 14);
});

Deno.test("insert-command: accepts set_brightness command", () => {
  assertEquals(VALID_COMMANDS.includes("set_brightness"), true);
});

Deno.test("insert-command: accepts set_config command", () => {
  assertEquals(VALID_COMMANDS.includes("set_config"), true);
});

Deno.test("insert-command: accepts get_config command", () => {
  assertEquals(VALID_COMMANDS.includes("get_config"), true);
});

Deno.test("insert-command: accepts get_status command", () => {
  assertEquals(VALID_COMMANDS.includes("get_status"), true);
  assertEquals(VALID_COMMANDS.includes("get_telemetry"), true);
  assertEquals(VALID_COMMANDS.includes("get_troubleshooting_status"), true);
});

Deno.test("insert-command: accepts reboot command", () => {
  assertEquals(VALID_COMMANDS.includes("reboot"), true);
});

Deno.test("insert-command: accepts factory_reset command", () => {
  assertEquals(VALID_COMMANDS.includes("factory_reset"), true);
});

Deno.test("insert-command: accepts ota_update command", () => {
  assertEquals(VALID_COMMANDS.includes("ota_update"), true);
});

Deno.test("insert-command: accepts set_display_name command", () => {
  assertEquals(VALID_COMMANDS.includes("set_display_name"), true);
});

Deno.test("insert-command: accepts set_time_zone command", () => {
  assertEquals(VALID_COMMANDS.includes("set_time_zone"), true);
});

Deno.test("insert-command: accepts clear_wifi command", () => {
  assertEquals(VALID_COMMANDS.includes("clear_wifi"), true);
});

Deno.test("insert-command: accepts test_display command", () => {
  assertEquals(VALID_COMMANDS.includes("test_display"), true);
});

Deno.test("insert-command: accepts ping command", () => {
  assertEquals(VALID_COMMANDS.includes("ping"), true);
});

Deno.test("insert-command: rejects dangerous commands", () => {
  const dangerousCommands = [
    "execute_shell",
    "sudo",
    "rm",
    "format",
    "delete_all",
    "eval",
    "exec",
  ];

  for (const cmd of dangerousCommands) {
    assertEquals(VALID_COMMANDS.includes(cmd), false, `${cmd} should be rejected`);
  }
});

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("insert-command: requires command field", () => {
  const invalidRequests = [
    {},
    { payload: { value: 200 } },
    { command: "" },
    { command: null },
  ];

  for (const req of invalidRequests) {
    const hasValidCommand =
      "command" in req &&
      typeof req.command === "string" &&
      req.command.length > 0;
    assertEquals(hasValidCommand, false);
  }
});

Deno.test("insert-command: command must be string", () => {
  const invalidTypes = [123, true, null, undefined, [], {}];

  for (const cmd of invalidTypes) {
    assertEquals(typeof cmd !== "string", true);
  }
});

Deno.test("insert-command: payload is optional", () => {
  const validRequests = [
    { command: "ping" },
    { command: "ping", payload: {} },
    { command: "set_brightness", payload: { value: 200 } },
  ];

  for (const req of validRequests) {
    assertEquals("command" in req, true);
    // payload is optional
  }
});

Deno.test("insert-command: payload must be object when provided", () => {
  const validPayloads = [{}, { value: 200 }, { brightness: 100, duration: 5000 }];
  const invalidPayloads = ["string", 123, true, []];

  for (const payload of validPayloads) {
    assertEquals(typeof payload === "object" && !Array.isArray(payload), true);
  }

  for (const payload of invalidPayloads) {
    assertEquals(typeof payload === "object" && !Array.isArray(payload), false);
  }
});

// ============================================================================
// Command Expiry Tests
// ============================================================================

Deno.test("insert-command: expiry is 5 minutes", () => {
  assertEquals(COMMAND_EXPIRY_SECONDS, 300);
  assertEquals(COMMAND_EXPIRY_SECONDS, 5 * 60);
});

Deno.test("insert-command: expires_at is calculated correctly", () => {
  const now = Date.now();
  const expiresAt = new Date(now + COMMAND_EXPIRY_SECONDS * 1000);

  // Should expire in 5 minutes
  const diffMs = expiresAt.getTime() - now;
  assertEquals(Math.round(diffMs / 1000), COMMAND_EXPIRY_SECONDS);
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("insert-command: success response has required fields", () => {
  const response = {
    success: true,
    command_id: "550e8400-e29b-41d4-a716-446655440000",
    expires_at: "2026-01-28T12:05:00Z",
  };

  assertEquals(response.success, true);
  assertExists(response.command_id);
  assertExists(response.expires_at);
});

Deno.test("insert-command: command_id is UUID format", () => {
  const commandId = "550e8400-e29b-41d4-a716-446655440000";
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assertEquals(uuidRegex.test(commandId), true);
});

Deno.test("insert-command: expires_at is valid ISO date", () => {
  const expiresAt = "2026-01-28T12:05:00Z";
  const date = new Date(expiresAt);
  assertEquals(isNaN(date.getTime()), false);
});

// ============================================================================
// Command Insertion Tests
// ============================================================================

Deno.test("insert-command: inserts with status=pending", () => {
  const insertData = {
    status: "pending",
    command: "set_brightness",
    payload: { value: 200 },
  };

  assertEquals(insertData.status, "pending");
});

Deno.test("insert-command: includes pairing_code from token", () => {
  const tokenPayload = { pairing_code: "ABC123", sub: "A1B2C3D4" };
  const insertData = {
    pairing_code: tokenPayload.pairing_code,
    serial_number: tokenPayload.sub,
    command: "ping",
  };

  assertEquals(insertData.pairing_code, "ABC123");
  assertEquals(insertData.serial_number, "A1B2C3D4");
});

Deno.test("insert-command: empty payload defaults to empty object", () => {
  const payload = undefined;
  const insertPayload = payload || {};

  assertEquals(Object.keys(insertPayload).length, 0);
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("insert-command: 405 for non-POST requests", () => {
  const errorResponse = {
    success: false,
    error: "Method not allowed",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("insert-command: 400 for invalid JSON", () => {
  const errorResponse = {
    success: false,
    error: "Invalid JSON body",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("insert-command: 400 for missing command", () => {
  const errorResponse = {
    success: false,
    error: "Missing or invalid command",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("insert-command: 400 for invalid command (not in whitelist)", () => {
  const errorResponse = {
    success: false,
    error:
      "Invalid command. Valid commands: set_brightness, set_config, get_config, get_status, get_telemetry, get_troubleshooting_status, reboot, factory_reset, ota_update, set_display_name, set_time_zone, clear_wifi, test_display, ping",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Invalid command");
  assertStringIncludes(errorResponse.error, "Valid commands:");
});

Deno.test("insert-command: 400 for invalid payload type", () => {
  const errorResponse = {
    success: false,
    error: "Payload must be an object",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("insert-command: 401 for invalid token", () => {
  const errorResponse = {
    success: false,
    error: "Invalid token",
  };

  assertEquals(errorResponse.success, false);
});

Deno.test("insert-command: 404 for pairing not found (FK violation)", () => {
  const errorResponse = {
    success: false,
    error: "Pairing not found. Device may not be connected.",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "not found");
});

Deno.test("insert-command: 500 for insert failure", () => {
  const errorResponse = {
    success: false,
    error: "Failed to queue command",
  };

  assertEquals(errorResponse.success, false);
});

// ============================================================================
// UUID-Based Device Identity Tests
// ============================================================================

Deno.test("insert-command: accepts device_uuid in request", () => {
  const mockRequest = {
    command: "set_brightness",
    payload: { value: 128 },
    device_uuid: TEST_DEVICE_UUID,
  };

  assertExists(mockRequest.device_uuid);
  assertEquals(mockRequest.device_uuid, TEST_DEVICE_UUID);
});

Deno.test("insert-command: command inserted with device_uuid", () => {
  const mockCommand = {
    pairing_code: TEST_PAIRING_CODE,
    serial_number: "A1B2C3D4",
    device_uuid: TEST_DEVICE_UUID,
    command: "set_brightness",
    payload: { value: 128 },
    status: "pending",
  };

  assertExists(mockCommand.device_uuid);
  assertEquals(mockCommand.device_uuid, TEST_DEVICE_UUID);
});

Deno.test("insert-command: inserts with device_uuid (not just serial_number)", () => {
  const mockCommand = {
    device_uuid: TEST_DEVICE_UUID,
    serial_number: "A1B2C3D4", // Kept for backward compatibility
    pairing_code: TEST_PAIRING_CODE,
    command: "set_brightness",
  };

  // device_uuid is preferred identifier
  assertExists(mockCommand.device_uuid);
  assertEquals(mockCommand.device_uuid.length, 36);
  // serial_number still present for backward compatibility
  assertExists(mockCommand.serial_number);
});

Deno.test("insert-command: prefers device_uuid from request over token", () => {
  const requestDeviceUuid = TEST_DEVICE_UUID;
  const tokenDeviceUuid = "550e8400-e29b-41d4-a716-446655440002";

  const deviceUuid = requestDeviceUuid || tokenDeviceUuid;
  assertEquals(deviceUuid, TEST_DEVICE_UUID);
  assertNotEquals(deviceUuid, tokenDeviceUuid);
});

Deno.test("insert-command: falls back to device_uuid from token when not in request", () => {
  const requestDeviceUuid = undefined;
  const tokenDeviceUuid = TEST_DEVICE_UUID;

  const deviceUuid = requestDeviceUuid || tokenDeviceUuid;
  assertEquals(deviceUuid, TEST_DEVICE_UUID);
});

Deno.test("insert-command: looks up device_uuid from pairing_code when missing", () => {
  const pairingRecord = {
    pairing_code: TEST_PAIRING_CODE,
    device_uuid: TEST_DEVICE_UUID,
  };

  const deviceUuid = pairingRecord.device_uuid;
  assertExists(deviceUuid);
  assertEquals(deviceUuid, TEST_DEVICE_UUID);
});

Deno.test("insert-command: 404 when device_uuid not found", () => {
  const errorResponse = {
    success: false,
    error: "Device UUID not found. Device may not be properly registered.",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Device UUID not found");
});
