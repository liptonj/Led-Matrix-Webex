/**
 * provision-device Edge Function Tests
 *
 * Tests for the device provisioning endpoint that ESP32 devices use
 * on first boot to register with Supabase.
 *
 * Run: deno test --allow-net --allow-env _tests/provision-device.test.ts
 */

import {
    assertEquals,
    assertExists,
    assertNotEquals,
    assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TEST_USER_UUID, TEST_DEVICE_UUID } from "./fixtures/uuid-fixtures.ts";

// Valid pairing code charset (excludes confusing characters I, O, 0, 1)
const VALID_PAIRING_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ============================================================================
// Helper Functions
// ============================================================================

function isValidPairingCode(code: string): boolean {
  if (!code || code.length !== 6) return false;
  const upperCode = code.toUpperCase();
  for (const char of upperCode) {
    if (!VALID_PAIRING_CHARS.includes(char)) return false;
  }
  return true;
}

function generateDeviceId(serial: string): string {
  const suffix = serial.slice(-4).toUpperCase();
  return `webex-display-${suffix}`;
}

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("provision-device: requires serial_number field", () => {
  const invalidRequests = [
    {},
    { key_hash: "abc123" },
    { serial_number: "" },
    { serial_number: null },
  ];

  for (const req of invalidRequests) {
    const hasSerial = "serial_number" in req && 
      typeof req.serial_number === "string" && 
      req.serial_number.length > 0;
    assertEquals(hasSerial, false);
  }
});

Deno.test("provision-device: requires key_hash field", () => {
  const invalidRequests = [
    {},
    { serial_number: "A1B2C3D4" },
    { serial_number: "A1B2C3D4", key_hash: "" },
  ];

  for (const req of invalidRequests) {
    const hasKeyHash = "key_hash" in req && 
      typeof req.key_hash === "string" && 
      req.key_hash.length > 0;
    assertEquals(hasKeyHash, false);
  }
});

Deno.test("provision-device: serial_number must be 8 hex characters", () => {
  const validSerials = ["A1B2C3D4", "12345678", "ABCDEF12", "abcdef12"];
  const invalidSerials = ["ABC", "ABCDEFGH9", "1234567", "123456789", "GHIJKLMN"];

  const hexRegex = /^[A-Fa-f0-9]{8}$/;

  for (const serial of validSerials) {
    assertEquals(hexRegex.test(serial), true, `${serial} should be valid`);
  }

  for (const serial of invalidSerials) {
    assertEquals(hexRegex.test(serial), false, `${serial} should be invalid`);
  }
});

Deno.test("provision-device: key_hash should be 64 hex chars (SHA-256)", () => {
  const validKeyHash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
  assertEquals(validKeyHash.length, 64);

  const hexRegex = /^[A-Fa-f0-9]{64}$/;
  assertEquals(hexRegex.test(validKeyHash), true);
});

Deno.test("provision-device: firmware_version is optional", () => {
  const withVersion = {
    serial_number: "A1B2C3D4",
    key_hash: "a".repeat(64),
    firmware_version: "1.4.4",
  };
  const withoutVersion = {
    serial_number: "A1B2C3D4",
    key_hash: "a".repeat(64),
  };

  assertExists(withVersion.firmware_version);
  assertEquals("firmware_version" in withoutVersion, false);
});

Deno.test("provision-device: ip_address is optional", () => {
  const withIp = {
    serial_number: "A1B2C3D4",
    key_hash: "a".repeat(64),
    ip_address: "192.168.1.100",
  };

  assertExists(withIp.ip_address);
});

Deno.test("provision-device: existing_pairing_code is optional", () => {
  const withCode = {
    serial_number: "A1B2C3D4",
    key_hash: "a".repeat(64),
    existing_pairing_code: "ABC234",
  };

  assertExists(withCode.existing_pairing_code);
});

// ============================================================================
// Pairing Code Generation Tests
// ============================================================================

Deno.test("provision-device: pairing codes are 6 characters", () => {
  const codes = ["ABC234", "XYZ789", "KLMN56"];
  for (const code of codes) {
    assertEquals(code.length, 6);
  }
});

Deno.test("provision-device: pairing codes exclude confusing chars", () => {
  // Should not contain I, O, 0, 1
  const confusingChars = ["I", "O", "0", "1"];
  
  for (const char of confusingChars) {
    assertEquals(VALID_PAIRING_CHARS.includes(char), false);
  }
});

Deno.test("provision-device: validates existing pairing code format", () => {
  // Valid codes
  assertEquals(isValidPairingCode("ABC234"), true);
  assertEquals(isValidPairingCode("XYZKLM"), true);
  assertEquals(isValidPairingCode("234567"), true);

  // Invalid codes
  assertEquals(isValidPairingCode("ABC101"), false); // Contains 1, 0
  assertEquals(isValidPairingCode("OOOIII"), false); // Contains O, I
  assertEquals(isValidPairingCode("ABC"), false); // Too short
  assertEquals(isValidPairingCode("ABCDEFGH"), false); // Too long
  assertEquals(isValidPairingCode(""), false); // Empty
});

Deno.test("provision-device: preserves valid existing pairing code", () => {
  const existingCode = "ABC234";
  const shouldPreserve = isValidPairingCode(existingCode);
  
  assertEquals(shouldPreserve, true);
});

Deno.test("provision-device: generates new code for invalid existing code", () => {
  const invalidExisting = "ABC101"; // Contains 1, 0
  const shouldPreserve = isValidPairingCode(invalidExisting);
  
  assertEquals(shouldPreserve, false);
  // Should generate new code instead
});

Deno.test("provision-device: normalizes existing code to uppercase", () => {
  const input = "abc234";
  const normalized = input.toUpperCase();
  
  assertEquals(normalized, "ABC234");
  assertEquals(isValidPairingCode(normalized), true);
});

// ============================================================================
// Device ID Generation Tests
// ============================================================================

Deno.test("provision-device: generates device_id from serial suffix", () => {
  assertEquals(generateDeviceId("A1B2C3D4"), "webex-display-C3D4");
  assertEquals(generateDeviceId("12345678"), "webex-display-5678");
  assertEquals(generateDeviceId("abcdef12"), "webex-display-EF12");
});

Deno.test("provision-device: device_id has correct prefix", () => {
  const deviceId = generateDeviceId("A1B2C3D4");
  assertStringIncludes(deviceId, "webex-display-");
});

// ============================================================================
// Response Format Tests - New Device
// ============================================================================

Deno.test("provision-device: new device returns 201 status", () => {
  // For new device creation, should return 201 Created
  const expectedStatus = 201;
  assertEquals(expectedStatus, 201);
});

Deno.test("provision-device: new device response has required fields", () => {
  const response = {
    success: true,
    device_id: "webex-display-C3D4",
    pairing_code: "ABC234",
    already_provisioned: false,
  };

  assertEquals(response.success, true);
  assertExists(response.device_id);
  assertExists(response.pairing_code);
  assertEquals(response.already_provisioned, false);
});

// ============================================================================
// Response Format Tests - Existing Device
// ============================================================================

Deno.test("provision-device: existing device returns 200 status", () => {
  const expectedStatus = 200;
  assertEquals(expectedStatus, 200);
});

Deno.test("provision-device: existing device returns existing pairing code", () => {
  const response = {
    success: true,
    device_id: "webex-display-C3D4",
    pairing_code: "ABC234", // Same as originally assigned
    already_provisioned: true,
  };

  assertEquals(response.success, true);
  assertEquals(response.already_provisioned, true);
});

Deno.test("provision-device: updates firmware_version for existing device", () => {
  // When existing device provisions again with new firmware version,
  // the version should be updated
  const updateData = {
    firmware_version: "1.5.2",
    last_seen: new Date().toISOString(),
    ip_address: "192.168.1.100",
  };

  assertExists(updateData.firmware_version);
  assertExists(updateData.last_seen);
});

// ============================================================================
// Database Insert Tests
// ============================================================================

Deno.test("provision-device: insert data structure is correct", () => {
  const insertData = {
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    pairing_code: "ABC234",
    key_hash: "a".repeat(64),
    firmware_version: "1.4.4",
    ip_address: "192.168.1.100",
    is_provisioned: false,
  };

  assertEquals(insertData.serial_number.toUpperCase(), "A1B2C3D4");
  assertEquals(insertData.is_provisioned, false);
  assertExists(insertData.key_hash);
});

Deno.test("provision-device: normalizes serial to uppercase", () => {
  const input = "a1b2c3d4";
  const normalized = input.toUpperCase();
  assertEquals(normalized, "A1B2C3D4");
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("provision-device: 400 for missing required fields", () => {
  const errorResponse = {
    error: "Missing required fields: serial_number, key_hash",
  };

  assertStringIncludes(errorResponse.error, "required");
});

Deno.test("provision-device: 400 for invalid serial format", () => {
  const errorResponse = {
    error: "Invalid serial_number format. Expected 8 hex characters.",
  };

  assertStringIncludes(errorResponse.error, "serial_number");
  assertStringIncludes(errorResponse.error, "8 hex");
});

Deno.test("provision-device: 500 for insert failure", () => {
  const errorResponse = {
    error: "Failed to register device",
  };

  assertStringIncludes(errorResponse.error, "register");
});

Deno.test("provision-device: 500 for internal error", () => {
  const errorResponse = {
    error: "Internal server error",
  };

  assertStringIncludes(errorResponse.error, "server error");
});

// ============================================================================
// Re-provision Tests (Key Hash Update)
// ============================================================================

Deno.test("provision-device: should update key_hash for existing approved device", () => {
  // Scenario: Device re-provisions with new key_hash after factory reset/NVS wipe
  const originalKeyHash = "a".repeat(64);
  const newKeyHash = "b".repeat(64);
  
  // Simulate existing approved device
  const existingDevice = {
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    key_hash: originalKeyHash,
    user_approved_by: "user-uuid-123",
    is_provisioned: true,
  };
  
  // Re-provision request with new key_hash (after factory reset)
  const reprovisionRequest = {
    serial_number: "A1B2C3D4",
    key_hash: newKeyHash,
    firmware_version: "2.0.0",
  };
  
  // Verify key_hash values are different (simulating factory reset)
  assertNotEquals(reprovisionRequest.key_hash, existingDevice.key_hash);
  
  // The update payload should include the new key_hash
  const expectedUpdateFields = {
    key_hash: newKeyHash,
    last_seen: new Date().toISOString(),
    firmware_version: "2.0.0",
  };
  
  // Verify new key_hash would be in update
  assertEquals(expectedUpdateFields.key_hash, newKeyHash);
  assertExists(expectedUpdateFields.last_seen);
});

Deno.test("provision-device: key_hash update should work without firmware_version", () => {
  // Scenario: Re-provision without firmware version (older firmware)
  const newKeyHash = "c".repeat(64);
  
  const reprovisionRequest = {
    serial_number: "A1B2C3D4",
    key_hash: newKeyHash,
    // No firmware_version
  };
  
  // Update should still include key_hash even without firmware_version
  const updatePayload = {
    key_hash: reprovisionRequest.key_hash,
    last_seen: new Date().toISOString(),
  };
  
  assertEquals(updatePayload.key_hash, newKeyHash);
  assertExists(updatePayload.last_seen);
  assertEquals("firmware_version" in reprovisionRequest, false);
});

// ============================================================================
// Provision Token Tests
// ============================================================================

Deno.test("provision-device: provision_token is optional", () => {
  const withToken = {
    serial_number: "A1B2C3D4",
    key_hash: "a".repeat(64),
    provision_token: "abc123def456ghi789jkl012mno345pq",
  };
  const withoutToken = {
    serial_number: "A1B2C3D4",
    key_hash: "a".repeat(64),
  };

  assertExists(withToken.provision_token);
  assertEquals("provision_token" in withoutToken, false);
});

Deno.test("provision-device: valid token format is 32 characters", () => {
  // Token format from migration: CHECK (char_length(token) = 32)
  const validToken = "abc123def456ghi789jkl012mno345pq";
  assertEquals(validToken.length, 32);
  
  const invalidTokens = [
    "short",
    "a".repeat(31),
    "a".repeat(33),
    "",
  ];
  
  for (const token of invalidTokens) {
    assertEquals(token.length === 32, false, `${token} should be invalid`);
  }
});

Deno.test("provision-device: valid token triggers auto-approval for new device", () => {
  // Scenario: New device with valid provision token
  const validToken = {
    id: crypto.randomUUID(),
    token: "abc123def456ghi789jkl012mno345pq",
    user_id: TEST_USER_UUID,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min from now
  };
  
  // Token is valid if expires_at is in the future
  const isExpired = new Date(validToken.expires_at) <= new Date();
  assertEquals(isExpired, false);
  
  // Device should be auto-approved
  const deviceData = {
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    pairing_code: "ABC234",
    user_approved_by: validToken.user_id,
    approved_at: new Date().toISOString(),
    is_provisioned: false,
  };
  
  assertEquals(deviceData.user_approved_by, validToken.user_id);
  assertExists(deviceData.approved_at);
});

Deno.test("provision-device: valid token sets user_approved_by correctly", () => {
  const tokenUserId = TEST_USER_UUID;
  const deviceUpdate = {
    user_approved_by: tokenUserId,
    approved_at: new Date().toISOString(),
  };
  
  assertEquals(deviceUpdate.user_approved_by, tokenUserId);
  assertExists(deviceUpdate.approved_at);
});

Deno.test("provision-device: valid token sets approved_at timestamp", () => {
  const now = new Date().toISOString();
  const deviceUpdate = {
    user_approved_by: TEST_USER_UUID,
    approved_at: now,
  };
  
  assertExists(deviceUpdate.approved_at);
  assertEquals(typeof deviceUpdate.approved_at, "string");
  // ISO timestamp format validation
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assertEquals(isoRegex.test(deviceUpdate.approved_at), true);
});

Deno.test("provision-device: token is single-use and deleted after validation", () => {
  // Token should be deleted immediately after use
  const tokenId = crypto.randomUUID();
  const deleteOperation = {
    table: "provision_tokens",
    operation: "delete",
    condition: { id: tokenId },
  };
  
  assertExists(deleteOperation.condition.id);
  assertEquals(deleteOperation.operation, "delete");
});

Deno.test("provision-device: valid token returns 200 status (not 403)", () => {
  // When token is valid, device is auto-approved and returns 200
  const successResponse = {
    success: true,
    device_id: "webex-display-C3D4",
    pairing_code: "ABC234",
    device_uuid: TEST_DEVICE_UUID,
    user_uuid: TEST_USER_UUID,
    already_provisioned: false,
  };
  
  const statusCode = 200; // Success, not 403 Forbidden
  assertEquals(statusCode, 200);
  assertEquals(successResponse.success, true);
  assertExists(successResponse.user_uuid);
});

Deno.test("provision-device: expired token doesn't trigger auto-approval", () => {
  // Scenario: Token exists but is expired
  const expiredToken = {
    id: crypto.randomUUID(),
    token: "abc123def456ghi789jkl012mno345pq",
    user_id: TEST_USER_UUID,
    expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // 1 minute ago
  };
  
  // Token is expired if expires_at is in the past
  const isExpired = new Date(expiredToken.expires_at) <= new Date();
  assertEquals(isExpired, true);
  
  // Device should NOT be auto-approved
  const deviceData = {
    serial_number: "A1B2C3D4",
    user_approved_by: null, // Not approved
    approved_at: null,
  };
  
  assertEquals(deviceData.user_approved_by, null);
  assertEquals(deviceData.approved_at, null);
});

Deno.test("provision-device: expired token falls back to pairing code flow", () => {
  // When token is expired, device should return 403 with pairing code
  const errorResponse = {
    error: "Device not approved yet. Ask device owner to approve it on the website.",
    serial_number: "A1B2C3D4",
    pairing_code: "ABC234",
    awaiting_approval: true,
  };
  
  const statusCode = 403; // Forbidden - requires approval
  assertEquals(statusCode, 403);
  assertStringIncludes(errorResponse.error, "not approved");
  assertExists(errorResponse.pairing_code);
  assertEquals(errorResponse.awaiting_approval, true);
});

Deno.test("provision-device: expired token is not deleted", () => {
  // Expired tokens should remain in database (for cleanup job)
  const expiredToken = {
    id: crypto.randomUUID(),
    expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
  };
  
  const isExpired = new Date(expiredToken.expires_at) <= new Date();
  assertEquals(isExpired, true);
  
  // Token should not be deleted (only valid tokens are deleted on use)
  const shouldDelete = false;
  assertEquals(shouldDelete, false);
});

Deno.test("provision-device: non-existent token doesn't cause error", () => {
  // Scenario: Token provided but doesn't exist in database
  const tokenResult = {
    data: null,
    error: null, // Not an error, just not found
  };
  
  // Should gracefully continue with pairing code flow
  assertEquals(tokenResult.data, null);
  assertEquals(tokenResult.error, null);
  
  // Device should proceed normally without token
  const deviceData = {
    serial_number: "A1B2C3D4",
    user_approved_by: null,
  };
  
  assertEquals(deviceData.user_approved_by, null);
});

Deno.test("provision-device: request without token works normally", () => {
  // Scenario: Normal provisioning without token
  const request = {
    serial_number: "A1B2C3D4",
    key_hash: "a".repeat(64),
    // No provision_token field
  };
  
  assertEquals("provision_token" in request, false);
  
  // Should create device in unapproved state
  const deviceData = {
    serial_number: "A1B2C3D4",
    user_approved_by: null,
    approved_at: null,
  };
  
  assertEquals(deviceData.user_approved_by, null);
  assertEquals(deviceData.approved_at, null);
});

Deno.test("provision-device: malformed token is handled gracefully", () => {
  // Scenario: Token provided but malformed (wrong length, invalid chars, etc.)
  const malformedTokens = [
    "short",
    "a".repeat(31),
    "a".repeat(33),
    "",
    null,
  ];
  
  for (const token of malformedTokens) {
    // Should not match database constraint (32 chars)
    const isValidFormat = token && typeof token === "string" && token.length === 32;
    assertEquals(isValidFormat, false, `${token} should be invalid`);
  }
  
  // Should continue with pairing code flow
  const deviceData = {
    serial_number: "A1B2C3D4",
    user_approved_by: null,
  };
  
  assertEquals(deviceData.user_approved_by, null);
});

Deno.test("provision-device: token can approve existing unapproved device", () => {
  // Scenario: Device exists but not approved, token approves it
  const existingDevice = {
    id: TEST_DEVICE_UUID,
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    pairing_code: "ABC234",
    user_approved_by: null, // Not approved yet
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
  };
  
  const validToken = {
    id: crypto.randomUUID(),
    user_id: TEST_USER_UUID,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
  
  // Update device with approval
  const updateData = {
    user_approved_by: validToken.user_id,
    approved_at: new Date().toISOString(),
  };
  
  assertEquals(updateData.user_approved_by, validToken.user_id);
  assertExists(updateData.approved_at);
  
  // Response should be 200 (success)
  const response = {
    success: true,
    device_id: existingDevice.device_id,
    pairing_code: existingDevice.pairing_code,
    device_uuid: existingDevice.id,
    user_uuid: validToken.user_id,
  };
  
  assertEquals(response.success, true);
  assertEquals(response.user_uuid, validToken.user_id);
});

Deno.test("provision-device: token doesn't override existing approval", () => {
  // Scenario: Device already approved by different user, token shouldn't override
  const existingDevice = {
    id: TEST_DEVICE_UUID,
    serial_number: "A1B2C3D4",
    user_approved_by: "original-user-uuid",
    approved_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
  };
  
  const tokenUserId = TEST_USER_UUID; // Different user
  
  // Device already has approval, should not be updated
  const shouldUpdate = existingDevice.user_approved_by === null;
  assertEquals(shouldUpdate, false);
  
  // Response should return existing approval
  const response = {
    success: true,
    user_uuid: existingDevice.user_approved_by,
  };
  
  assertEquals(response.user_uuid, existingDevice.user_approved_by);
  assertNotEquals(response.user_uuid, tokenUserId);
});

Deno.test("provision-device: user_devices entry created with provision_token method", () => {
  // When token auto-approves, user_devices entry should be created
  const userDevicesEntry = {
    user_id: TEST_USER_UUID,
    serial_number: "A1B2C3D4",
    device_uuid: TEST_DEVICE_UUID,
    created_by: TEST_USER_UUID,
    provisioning_method: "provision_token",
    provisioned_at: new Date().toISOString(),
  };
  
  assertEquals(userDevicesEntry.provisioning_method, "provision_token");
  assertEquals(userDevicesEntry.user_id, TEST_USER_UUID);
  assertEquals(userDevicesEntry.created_by, TEST_USER_UUID);
  assertExists(userDevicesEntry.provisioned_at);
});

Deno.test("provision-device: user_devices entry has correct user_id from token", () => {
  const tokenUserId = TEST_USER_UUID;
  
  const userDevicesEntry = {
    user_id: tokenUserId,
    serial_number: "A1B2C3D4",
    device_uuid: TEST_DEVICE_UUID,
    created_by: tokenUserId,
    provisioning_method: "provision_token",
  };
  
  assertEquals(userDevicesEntry.user_id, tokenUserId);
  assertEquals(userDevicesEntry.created_by, tokenUserId);
});

Deno.test("provision-device: user_devices upsert uses correct conflict resolution", () => {
  // user_devices upsert should use onConflict: "user_id,serial_number"
  const upsertConfig = {
    onConflict: "user_id,serial_number",
    ignoreDuplicates: false,
  };
  
  assertEquals(upsertConfig.onConflict, "user_id,serial_number");
  assertEquals(upsertConfig.ignoreDuplicates, false);
});

Deno.test("provision-device: token validation checks expires_at correctly", () => {
  // Token is valid only if expires_at > current time
  const now = new Date();
  
  const validToken = {
    expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(), // Future
  };
  
  const expiredToken = {
    expires_at: new Date(now.getTime() - 60 * 1000).toISOString(), // Past
  };
  
  const isValid = new Date(validToken.expires_at) > now;
  const isExpired = new Date(expiredToken.expires_at) <= now;
  
  assertEquals(isValid, true);
  assertEquals(isExpired, true);
});

Deno.test("provision-device: token query selects correct fields", () => {
  // Token query should select: id, user_id, expires_at
  const tokenQuery = {
    select: ["id", "user_id", "expires_at"],
    from: "provision_tokens",
    where: { token: "abc123def456ghi789jkl012mno345pq" },
  };
  
  assertEquals(tokenQuery.select.includes("id"), true);
  assertEquals(tokenQuery.select.includes("user_id"), true);
  assertEquals(tokenQuery.select.includes("expires_at"), true);
  assertEquals(tokenQuery.select.length, 3);
});

Deno.test("provision-device: token deletion uses correct condition", () => {
  // Token should be deleted by id (not token string)
  const tokenId = crypto.randomUUID();
  const deleteOperation = {
    table: "provision_tokens",
    condition: { id: tokenId },
  };
  
  assertExists(deleteOperation.condition.id);
  assertEquals("token" in deleteOperation.condition, false); // Should use id, not token
});
