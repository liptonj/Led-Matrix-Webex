/**
 * device-auth UUID Response Tests
 *
 * Tests for UUID fields in device-auth response and JWT payload.
 *
 * Run: deno test --allow-net --allow-env _tests/device-auth-uuid.test.ts
 */

import {
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import {
  TEST_DEVICE_UUID,
  TEST_USER_UUID,
  mockJwtPayload,
  mockJwtPayloadUnassigned,
} from "./fixtures/uuid-fixtures.ts";

// UUID format: 8-4-4-4-12 = 36 characters
const UUID_LENGTH = 36;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Response UUID Field Tests
// ============================================================================

Deno.test("device-auth: response includes device_uuid", () => {
  const mockResponse = {
    success: true,
    serial_number: "A1B2C3D4",
    pairing_code: "ABC123",
    device_id: "webex-display-C3D4",
    device_uuid: TEST_DEVICE_UUID,
    user_uuid: TEST_USER_UUID,
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    expires_at: "2026-01-29T12:00:00Z",
    target_firmware_version: "1.5.2",
    debug_enabled: false,
    anon_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  };

  assertExists(mockResponse.device_uuid);
  assertEquals(typeof mockResponse.device_uuid, "string");
  assertEquals(mockResponse.device_uuid.length, UUID_LENGTH);
  assertEquals(UUID_REGEX.test(mockResponse.device_uuid), true);
});

Deno.test("device-auth: response includes user_uuid when assigned", () => {
  const mockResponse = {
    success: true,
    serial_number: "A1B2C3D4",
    pairing_code: "ABC123",
    device_id: "webex-display-C3D4",
    device_uuid: TEST_DEVICE_UUID,
    user_uuid: TEST_USER_UUID,
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    expires_at: "2026-01-29T12:00:00Z",
    target_firmware_version: "1.5.2",
    debug_enabled: false,
    anon_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  };

  assertExists(mockResponse.user_uuid);
  assertEquals(mockResponse.user_uuid !== null, true);
  assertEquals(typeof mockResponse.user_uuid, "string");
  assertEquals(mockResponse.user_uuid!.length, UUID_LENGTH);
  assertEquals(UUID_REGEX.test(mockResponse.user_uuid!), true);
});

Deno.test("device-auth: response has user_uuid=null when unassigned", () => {
  const mockResponse = {
    success: true,
    serial_number: "A1B2C3D4",
    pairing_code: "ABC123",
    device_id: "webex-display-C3D4",
    device_uuid: TEST_DEVICE_UUID,
    user_uuid: null,
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    expires_at: "2026-01-29T12:00:00Z",
    target_firmware_version: "1.5.2",
    debug_enabled: false,
    anon_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  };

  assertEquals(mockResponse.user_uuid, null);
});

// ============================================================================
// JWT Payload UUID Claim Tests
// ============================================================================

Deno.test("device-auth: JWT payload contains device_uuid claim", () => {
  assertExists(mockJwtPayload.device_uuid);
  assertEquals(typeof mockJwtPayload.device_uuid, "string");
  assertEquals(mockJwtPayload.device_uuid.length, UUID_LENGTH);
  assertEquals(UUID_REGEX.test(mockJwtPayload.device_uuid), true);
  assertEquals(mockJwtPayload.device_uuid, TEST_DEVICE_UUID);
});

Deno.test("device-auth: JWT payload contains user_uuid claim", () => {
  // Test assigned device (user_uuid present)
  assertExists(mockJwtPayload.user_uuid);
  assertEquals(mockJwtPayload.user_uuid !== null, true);
  assertEquals(typeof mockJwtPayload.user_uuid, "string");
  assertEquals(mockJwtPayload.user_uuid!.length, UUID_LENGTH);
  assertEquals(UUID_REGEX.test(mockJwtPayload.user_uuid!), true);
  assertEquals(mockJwtPayload.user_uuid, TEST_USER_UUID);

  // Test unassigned device (user_uuid is null)
  assertEquals(mockJwtPayloadUnassigned.user_uuid, null);
});
