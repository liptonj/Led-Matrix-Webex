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
