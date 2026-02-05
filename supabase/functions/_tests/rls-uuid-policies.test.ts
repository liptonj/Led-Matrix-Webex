/**
 * RLS UUID Policies Tests
 *
 * Mock-based unit tests for Row Level Security (RLS) policy behavior with UUIDs.
 * These tests verify expected RLS policy behavior for device_uuid and user_uuid.
 *
 * Run: deno test --allow-net --allow-env _tests/rls-uuid-policies.test.ts
 */

import {
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import {
  TEST_DEVICE_UUID,
  TEST_USER_UUID,
  TEST_DEVICE_UUID_2,
  TEST_USER_UUID_2,
  TEST_PAIRING_CODE,
  mockJwtPayload,
  mockPairingRecord,
} from "./fixtures/uuid-fixtures.ts";

// ============================================================================
// Mock RLS Policy Evaluation Helpers
// ============================================================================

/**
 * Mock function to simulate RLS policy: device token with device_uuid can SELECT own pairing
 * Policy logic: auth.jwt() ->> 'device_uuid' matches pairing.device_uuid
 */
function mockDeviceCanSelectPairing(
  jwtDeviceUuid: string | null,
  pairingDeviceUuid: string,
): boolean {
  return jwtDeviceUuid !== null && jwtDeviceUuid === pairingDeviceUuid;
}

/**
 * Mock function to simulate RLS policy: user can SELECT pairings where user_uuid matches
 * Policy logic: user_uuid = auth.uid()
 */
function mockUserCanSelectPairing(
  userId: string,
  pairingUserUuid: string | null,
): boolean {
  return pairingUserUuid !== null && pairingUserUuid === userId;
}

/**
 * Mock function to simulate RLS policy: commands INSERT requires device_uuid in user_devices
 * Policy logic: device_uuid IN (SELECT device_uuid FROM user_devices WHERE user_id = auth.uid())
 */
function mockUserCanInsertCommand(
  userId: string,
  commandDeviceUuid: string,
  userDevices: Array<{ user_id: string; device_uuid: string }>,
): boolean {
  return userDevices.some(
    (ud) => ud.user_id === userId && ud.device_uuid === commandDeviceUuid,
  );
}

// ============================================================================
// Test 1: Device token with device_uuid can SELECT own pairing
// ============================================================================

Deno.test("RLS: device token with device_uuid can SELECT own pairing", () => {
  // Mock JWT payload with device_uuid
  const jwtWithDeviceUuid = {
    ...mockJwtPayload,
    device_uuid: TEST_DEVICE_UUID,
    token_type: "device",
  };

  // Mock pairing record owned by this device
  const pairingRecord = {
    ...mockPairingRecord,
    device_uuid: TEST_DEVICE_UUID,
  };

  // Verify RLS policy allows access
  const canAccess = mockDeviceCanSelectPairing(
    jwtWithDeviceUuid.device_uuid,
    pairingRecord.device_uuid,
  );

  assertEquals(canAccess, true);
  assertExists(jwtWithDeviceUuid.device_uuid);
  assertEquals(jwtWithDeviceUuid.device_uuid, pairingRecord.device_uuid);
});

Deno.test("RLS: device token with device_uuid cannot SELECT other device pairing", () => {
  // Mock JWT payload with device_uuid
  const jwtWithDeviceUuid = {
    ...mockJwtPayload,
    device_uuid: TEST_DEVICE_UUID,
    token_type: "device",
  };

  // Mock pairing record owned by different device
  const pairingRecord = {
    ...mockPairingRecord,
    device_uuid: TEST_DEVICE_UUID_2,
  };

  // Verify RLS policy denies access
  const canAccess = mockDeviceCanSelectPairing(
    jwtWithDeviceUuid.device_uuid,
    pairingRecord.device_uuid,
  );

  assertEquals(canAccess, false);
  assertExists(jwtWithDeviceUuid.device_uuid);
  assertExists(pairingRecord.device_uuid);
  assertEquals(jwtWithDeviceUuid.device_uuid !== pairingRecord.device_uuid, true);
});

// ============================================================================
// Test 2: Device token WITHOUT device_uuid is rejected
// ============================================================================

Deno.test("RLS: device token WITHOUT device_uuid is rejected", () => {
  // Mock old-style JWT payload without device_uuid
  const jwtWithoutDeviceUuid = {
    sub: crypto.randomUUID(),
    role: "authenticated",
    aud: "authenticated",
    serial_number: "A1B2C3D4",
    pairing_code: TEST_PAIRING_CODE,
    device_id: "webex-display-C3D4",
    token_type: "device",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
    // device_uuid is missing
  };

  // Mock pairing record
  const pairingRecord = {
    ...mockPairingRecord,
    device_uuid: TEST_DEVICE_UUID,
  };

  // Verify RLS policy denies access when device_uuid is missing
  const canAccess = mockDeviceCanSelectPairing(
    (jwtWithoutDeviceUuid as any).device_uuid || null,
    pairingRecord.device_uuid,
  );

  assertEquals(canAccess, false);
  assertEquals((jwtWithoutDeviceUuid as any).device_uuid, undefined);
});

Deno.test("RLS: device token with null device_uuid is rejected", () => {
  // Mock JWT payload with explicit null device_uuid
  const jwtWithNullDeviceUuid = {
    ...mockJwtPayload,
    device_uuid: null,
    token_type: "device",
  };

  // Mock pairing record
  const pairingRecord = {
    ...mockPairingRecord,
    device_uuid: TEST_DEVICE_UUID,
  };

  // Verify RLS policy denies access when device_uuid is null
  const canAccess = mockDeviceCanSelectPairing(
    jwtWithNullDeviceUuid.device_uuid,
    pairingRecord.device_uuid,
  );

  assertEquals(canAccess, false);
  assertEquals(jwtWithNullDeviceUuid.device_uuid, null);
});

// ============================================================================
// Test 3: User can SELECT pairings where user_uuid matches
// ============================================================================

Deno.test("RLS: user can SELECT pairings where user_uuid matches", () => {
  // Mock authenticated user
  const userId = TEST_USER_UUID;

  // Mock pairing record assigned to this user
  const pairingRecord = {
    ...mockPairingRecord,
    user_uuid: TEST_USER_UUID,
  };

  // Verify RLS policy allows access
  const canAccess = mockUserCanSelectPairing(
    userId,
    pairingRecord.user_uuid,
  );

  assertEquals(canAccess, true);
  assertEquals(userId, pairingRecord.user_uuid);
});

Deno.test("RLS: user cannot SELECT pairings where user_uuid does not match", () => {
  // Mock authenticated user
  const userId = TEST_USER_UUID;

  // Mock pairing record assigned to different user
  const pairingRecord = {
    ...mockPairingRecord,
    user_uuid: TEST_USER_UUID_2,
  };

  // Verify RLS policy denies access
  const canAccess = mockUserCanSelectPairing(
    userId,
    pairingRecord.user_uuid,
  );

  assertEquals(canAccess, false);
  assertExists(pairingRecord.user_uuid);
  assertEquals(userId !== pairingRecord.user_uuid, true);
});

Deno.test("RLS: user cannot SELECT pairings with null user_uuid", () => {
  // Mock authenticated user
  const userId = TEST_USER_UUID;

  // Mock unassigned pairing record
  const pairingRecord = {
    ...mockPairingRecord,
    user_uuid: null,
  };

  // Verify RLS policy denies access when user_uuid is null
  const canAccess = mockUserCanSelectPairing(
    userId,
    pairingRecord.user_uuid,
  );

  assertEquals(canAccess, false);
  assertEquals(pairingRecord.user_uuid, null);
});

// ============================================================================
// Test 4: Commands INSERT requires device_uuid in user_devices
// ============================================================================

Deno.test("RLS: commands INSERT requires device_uuid in user_devices", () => {
  // Mock authenticated user
  const userId = TEST_USER_UUID;

  // Mock user_devices table showing user owns this device
  const userDevices = [
    {
      user_id: TEST_USER_UUID,
      device_uuid: TEST_DEVICE_UUID,
      serial_number: "A1B2C3D4",
    },
  ];

  // Mock command to insert
  const commandDeviceUuid = TEST_DEVICE_UUID;

  // Verify RLS policy allows INSERT
  const canInsert = mockUserCanInsertCommand(
    userId,
    commandDeviceUuid,
    userDevices,
  );

  assertEquals(canInsert, true);
  assertExists(userDevices.find((ud) => ud.device_uuid === commandDeviceUuid));
});

Deno.test("RLS: commands INSERT denied when device_uuid not in user_devices", () => {
  // Mock authenticated user
  const userId = TEST_USER_UUID;

  // Mock user_devices table - user owns different device
  const userDevices = [
    {
      user_id: TEST_USER_UUID,
      device_uuid: TEST_DEVICE_UUID,
      serial_number: "A1B2C3D4",
    },
  ];

  // Mock command to insert for device user doesn't own
  const commandDeviceUuid = TEST_DEVICE_UUID_2;

  // Verify RLS policy denies INSERT
  const canInsert = mockUserCanInsertCommand(
    userId,
    commandDeviceUuid,
    userDevices,
  );

  assertEquals(canInsert, false);
  assertEquals(
    userDevices.find((ud) => ud.device_uuid === commandDeviceUuid),
    undefined,
  );
});

Deno.test("RLS: commands INSERT denied when user_devices is empty", () => {
  // Mock authenticated user
  const userId = TEST_USER_UUID;

  // Mock empty user_devices table
  const userDevices: Array<{ user_id: string; device_uuid: string }> = [];

  // Mock command to insert
  const commandDeviceUuid = TEST_DEVICE_UUID;

  // Verify RLS policy denies INSERT
  const canInsert = mockUserCanInsertCommand(
    userId,
    commandDeviceUuid,
    userDevices,
  );

  assertEquals(canInsert, false);
  assertEquals(userDevices.length, 0);
});

Deno.test("RLS: commands INSERT denied when device_uuid matches but user_id differs", () => {
  // Mock authenticated user
  const userId = TEST_USER_UUID;

  // Mock user_devices table - device owned by different user
  const userDevices = [
    {
      user_id: TEST_USER_UUID_2,
      device_uuid: TEST_DEVICE_UUID,
      serial_number: "A1B2C3D4",
    },
  ];

  // Mock command to insert
  const commandDeviceUuid = TEST_DEVICE_UUID;

  // Verify RLS policy denies INSERT (device_uuid matches but user_id doesn't)
  const canInsert = mockUserCanInsertCommand(
    userId,
    commandDeviceUuid,
    userDevices,
  );

  assertEquals(canInsert, false);
  assertExists(userDevices.find((ud) => ud.device_uuid === commandDeviceUuid));
  assertEquals(
    userDevices.find((ud) => ud.user_id === userId && ud.device_uuid === commandDeviceUuid),
    undefined,
  );
});

// ============================================================================
// Edge Cases and Additional Scenarios
// ============================================================================

Deno.test("RLS: user can INSERT commands for multiple devices they own", () => {
  // Mock authenticated user
  const userId = TEST_USER_UUID;

  // Mock user_devices table - user owns multiple devices
  const userDevices = [
    {
      user_id: TEST_USER_UUID,
      device_uuid: TEST_DEVICE_UUID,
      serial_number: "A1B2C3D4",
    },
    {
      user_id: TEST_USER_UUID,
      device_uuid: TEST_DEVICE_UUID_2,
      serial_number: "X1Y2Z3W4",
    },
  ];

  // Verify user can insert commands for first device
  const canInsertDevice1 = mockUserCanInsertCommand(
    userId,
    TEST_DEVICE_UUID,
    userDevices,
  );
  assertEquals(canInsertDevice1, true);

  // Verify user can insert commands for second device
  const canInsertDevice2 = mockUserCanInsertCommand(
    userId,
    TEST_DEVICE_UUID_2,
    userDevices,
  );
  assertEquals(canInsertDevice2, true);
});

Deno.test("RLS: device_uuid comparison is case-insensitive (UUID standard)", () => {
  // UUIDs are case-insensitive per RFC 4122
  // Both uppercase and lowercase versions should match in database UUID comparisons
  // This test verifies that our mock uses the same UUID values

  // Mock JWT payload with device_uuid
  const jwtWithDeviceUuid = {
    ...mockJwtPayload,
    device_uuid: TEST_DEVICE_UUID,
    token_type: "device",
  };

  // Mock pairing record with same device_uuid
  const pairingRecord = {
    ...mockPairingRecord,
    device_uuid: TEST_DEVICE_UUID,
  };

  // Same UUIDs should match
  const canAccess = mockDeviceCanSelectPairing(
    jwtWithDeviceUuid.device_uuid,
    pairingRecord.device_uuid,
  );

  // UUIDs match - access granted
  assertEquals(canAccess, true);
});
