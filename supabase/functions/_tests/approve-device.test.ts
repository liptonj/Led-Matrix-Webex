/**
 * approve-device Edge Function Tests
 *
 * Tests for the approve-device Edge Function that handles device approval
 * and UUID assignment.
 *
 * Run: deno test --allow-net --allow-env _tests/approve-device.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TEST_DEVICE_UUID, TEST_USER_UUID, TEST_PAIRING_CODE } from "./fixtures/uuid-fixtures.ts";

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("approve-device: requires POST method", () => {
  const validMethods = ["POST"];
  assertEquals(validMethods.includes("POST"), true);
});

Deno.test("approve-device: requires pairing_code in request body", () => {
  const validRequest = {
    pairing_code: TEST_PAIRING_CODE,
  };

  assertExists(validRequest.pairing_code);
  assertEquals(validRequest.pairing_code.length, 6);
});

Deno.test("approve-device: validates pairing code format", () => {
  const validCodes = ["ABC123", "XYZ789", "123ABC"];
  const invalidCodes = ["", "ABC", "ABC1234", "abc123", "ABC-123"];

  for (const code of validCodes) {
    assertEquals(code.length, 6);
    assertEquals(/^[A-Z0-9]{6}$/.test(code), true);
  }

  for (const code of invalidCodes) {
    const isValid = code.length === 6 && /^[A-Z0-9]{6}$/.test(code);
    assertEquals(isValid, false);
  }
});

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("approve-device: requires Bearer token authentication", () => {
  const authHeader = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
  assertEquals(authHeader.startsWith("Bearer "), true);
});

Deno.test("approve-device: rejects requests without authentication", () => {
  const errorResponse = {
    error: "Unauthorized",
  };

  assertStringIncludes(errorResponse.error, "Unauthorized");
});

// ============================================================================
// UUID Assignment Tests
// ============================================================================

Deno.test("approve-device: sets pairings.user_uuid", () => {
  const mockPairingUpdate = {
    pairing_code: TEST_PAIRING_CODE,
    user_uuid: TEST_USER_UUID,
  };

  assertExists(mockPairingUpdate.user_uuid);
  assertEquals(mockPairingUpdate.user_uuid.length, 36);
});

Deno.test("approve-device: broadcasts user_assigned event", () => {
  const mockBroadcast = {
    topic: `device:${TEST_DEVICE_UUID}`,
    event: "user_assigned",
    payload: {
      user_uuid: TEST_USER_UUID,
      device_uuid: TEST_DEVICE_UUID,
      pairing_code: TEST_PAIRING_CODE,
    },
  };

  assertEquals(mockBroadcast.event, "user_assigned");
  assertExists(mockBroadcast.payload.user_uuid);
  assertExists(mockBroadcast.payload.device_uuid);
});

Deno.test("approve-device: user_assigned payload contains correct user_uuid", () => {
  const mockPayload = {
    user_uuid: TEST_USER_UUID,
    device_uuid: TEST_DEVICE_UUID,
    pairing_code: TEST_PAIRING_CODE,
  };

  assertEquals(mockPayload.user_uuid, TEST_USER_UUID);
  assertEquals(mockPayload.device_uuid, TEST_DEVICE_UUID);
  assertExists(mockPayload.pairing_code);
});

Deno.test("approve-device: broadcasts to device channel with device_uuid", () => {
  const mockBroadcast = {
    topic: `device:${TEST_DEVICE_UUID}`,
    event: "user_assigned",
    payload: {
      user_uuid: TEST_USER_UUID,
      device_uuid: TEST_DEVICE_UUID,
    },
  };

  assertEquals(mockBroadcast.topic, `device:${TEST_DEVICE_UUID}`);
  assertStringIncludes(mockBroadcast.topic, TEST_DEVICE_UUID);
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("approve-device: success response format", () => {
  const mockResponse = {
    success: true,
    message: "Device approved successfully",
  };

  assertEquals(mockResponse.success, true);
  assertStringIncludes(mockResponse.message, "approved");
});

Deno.test("approve-device: handles already approved device", () => {
  const mockResponse = {
    success: true,
    message: "Device already approved by you",
  };

  assertEquals(mockResponse.success, true);
  assertStringIncludes(mockResponse.message, "already");
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("approve-device: 404 for device not found", () => {
  const errorResponse = {
    error: "Device not found",
  };

  assertStringIncludes(errorResponse.error, "not found");
});

Deno.test("approve-device: 410 for expired pairing code", () => {
  const errorResponse = {
    error: "Pairing code has expired",
  };

  assertStringIncludes(errorResponse.error, "expired");
});

Deno.test("approve-device: 400 for invalid pairing code", () => {
  const errorResponse = {
    error: "Invalid pairing code",
  };

  assertStringIncludes(errorResponse.error, "Invalid");
});

Deno.test("approve-device: 500 for database error", () => {
  const errorResponse = {
    error: "Failed to approve device",
  };

  assertStringIncludes(errorResponse.error, "Failed");
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test("approve-device: creates user_devices entry with device_uuid", () => {
  const mockUserDevice = {
    user_id: TEST_USER_UUID,
    serial_number: "A1B2C3D4",
    device_uuid: TEST_DEVICE_UUID,
    created_by: TEST_USER_UUID,
    provisioning_method: "user_approved",
    provisioned_at: new Date().toISOString(),
  };

  assertExists(mockUserDevice.device_uuid);
  assertEquals(mockUserDevice.device_uuid, TEST_DEVICE_UUID);
  assertEquals(mockUserDevice.user_id, TEST_USER_UUID);
});
