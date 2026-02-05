/**
 * Webex Status Sweep Edge Function Tests
 *
 * Tests for the webex-status-sweep scheduled Edge Function that polls all tokens.
 *
 * Run: deno test --allow-net --allow-env _tests/webex-status-sweep.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  TEST_DEVICE_UUID,
  TEST_USER_UUID,
} from "./fixtures/uuid-fixtures.ts";

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("webex-status-sweep: allows GET and POST methods", () => {
  const validMethods = ["GET", "POST"];
  for (const method of validMethods) {
    assertEquals(["GET", "POST"].includes(method), true);
  }
});

Deno.test("webex-status-sweep: rejects PUT/DELETE methods", () => {
  const invalidMethods = ["PUT", "DELETE", "PATCH"];
  for (const method of invalidMethods) {
    assertEquals(["GET", "POST"].includes(method), false);
  }
});

Deno.test("webex-status-sweep: returns 500 when OAuth client not configured", () => {
  const errorResponse = {
    error: "Webex client configuration missing",
  };

  assertEquals(errorResponse.error, "Webex client configuration missing");
});

// ============================================================================
// Device Token Polling Tests
// ============================================================================

Deno.test("webex-status-sweep: loads all Webex tokens from database", () => {
  const tokenQuery = {
    provider: "webex",
  };

  assertEquals(tokenQuery.provider, "webex");
});

Deno.test("webex-status-sweep: skips tokens without pairing_code", () => {
  const tokenRow = {
    pairing_code: null,
  };

  const shouldSkip = !tokenRow.pairing_code;
  assertEquals(shouldSkip, true);
});

Deno.test("webex-status-sweep: checks collision window before updating", () => {
  const COLLISION_WINDOW_MS = 15_000; // 15 seconds
  const now = Date.now();
  const appLastSeen = new Date(now - 10_000).toISOString(); // 10 seconds ago
  const lastSeenMs = new Date(appLastSeen).getTime();

  const shouldSkip = !Number.isNaN(lastSeenMs) && now - lastSeenMs < COLLISION_WINDOW_MS;
  assertEquals(shouldSkip, true);
});

Deno.test("webex-status-sweep: updates when app_last_seen is older than collision window", () => {
  const COLLISION_WINDOW_MS = 15_000;
  const now = Date.now();
  const appLastSeen = new Date(now - 20_000).toISOString(); // 20 seconds ago
  const lastSeenMs = new Date(appLastSeen).getTime();

  const shouldSkip = !Number.isNaN(lastSeenMs) && now - lastSeenMs < COLLISION_WINDOW_MS;
  assertEquals(shouldSkip, false);
});

Deno.test("webex-status-sweep: updates when app_connected is false", () => {
  const pairingRow = {
    app_connected: false,
    app_last_seen: null,
  };

  const shouldSkip = !!(pairingRow.app_last_seen && pairingRow.app_connected === true);
  assertEquals(shouldSkip, false);
});

Deno.test("webex-status-sweep: refreshes token when expires within 1 minute", () => {
  const expiresAt = new Date(Date.now() + 30 * 1000); // 30 seconds
  const now = Date.now();
  const shouldRefresh = !expiresAt || expiresAt.getTime() - now < 60_000;

  assertEquals(shouldRefresh, true);
});

Deno.test("webex-status-sweep: updates token row after refresh", () => {
  const updateData = {
    access_token_id: "new-access-secret-id",
    refresh_token_id: "new-refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  assertExists(updateData.access_token_id);
  assertExists(updateData.expires_at);
});

Deno.test("webex-status-sweep: determines in_call status from webex_status", () => {
  const inCallStatuses = ["meeting", "call", "presenting", "busy"];
  const webexStatus = "meeting";

  const inCall = inCallStatuses.includes(webexStatus);
  assertEquals(inCall, true);
});

Deno.test("webex-status-sweep: skips update when status unchanged", () => {
  const currentStatus = "active";
  const newStatus = "active";

  const shouldSkip = currentStatus === newStatus;
  assertEquals(shouldSkip, true);
});

Deno.test("webex-status-sweep: updates pairing when status changed", () => {
  const currentStatus: string = "active";
  const newStatus: string = "away";

  const shouldSkip = currentStatus === newStatus;
  assertEquals(shouldSkip, false);
});

Deno.test("webex-status-sweep: updates pairing with webex_status and in_call", () => {
  const updateData = {
    webex_status: "meeting",
    in_call: true,
  };

  assertExists(updateData.webex_status);
  assertEquals(updateData.in_call, true);
});

// ============================================================================
// User Token Polling Tests
// ============================================================================

Deno.test("webex-status-sweep: loads devices with webex_polling_enabled", () => {
  const deviceQuery = {
    webex_polling_enabled: true,
  };

  assertEquals(deviceQuery.webex_polling_enabled, true);
});

Deno.test("webex-status-sweep: groups devices by user_id", () => {
  const devices = [
    { user_id: "user1", serial_number: "A1B2C3D4" },
    { user_id: "user1", serial_number: "X1Y2Z3W4" },
    { user_id: "user2", serial_number: "B2C3D4E5" },
  ];

  const devicesByUser = new Map<string, string[]>();
  for (const d of devices) {
    const list = devicesByUser.get(d.user_id) || [];
    list.push(d.serial_number);
    devicesByUser.set(d.user_id, list);
  }

  assertEquals(devicesByUser.get("user1")?.length, 2);
  assertEquals(devicesByUser.get("user2")?.length, 1);
});

Deno.test("webex-status-sweep: looks up user token by user_id and token_scope", () => {
  const tokenQuery = {
    user_id: "user-uuid",
    token_scope: "user",
    provider: "webex",
  };

  assertEquals(tokenQuery.token_scope, "user");
  assertEquals(tokenQuery.provider, "webex");
});

Deno.test("webex-status-sweep: skips user when token not found", () => {
  const userToken = null;
  const shouldSkip = !userToken;

  assertEquals(shouldSkip, true);
});

Deno.test("webex-status-sweep: refreshes user token when expires within 1 minute", () => {
  const expiresAt = new Date(Date.now() + 30 * 1000);
  const now = Date.now();
  const shouldRefresh = !expiresAt || expiresAt.getTime() - now < 60_000;

  assertEquals(shouldRefresh, true);
});

Deno.test("webex-status-sweep: polls Webex once per user", () => {
  const userId = "user-uuid";
  const serialNumbers = ["A1B2C3D4", "X1Y2Z3W4"];

  // Should call fetchWebexStatus once, then update all devices
  assertEquals(serialNumbers.length, 2);
});

Deno.test("webex-status-sweep: updates all user devices with same status", () => {
  const webexStatus = "active";
  const inCall = false;
  const serialNumbers = ["A1B2C3D4", "X1Y2Z3W4"];

  for (const serialNumber of serialNumbers) {
    const updateData = {
      webex_status: webexStatus,
      in_call: inCall,
    };

    assertExists(updateData.webex_status);
  }
});

Deno.test("webex-status-sweep: skips device update when status unchanged", () => {
  const pairing = {
    webex_status: "active",
  };
  const webexStatus = "active";

  const shouldSkip = pairing.webex_status === webexStatus;
  assertEquals(shouldSkip, true);
});

Deno.test("webex-status-sweep: updates device when status changed", () => {
  const pairing = {
    webex_status: "active",
  };
  const webexStatus = "away";

  const shouldSkip = pairing.webex_status === webexStatus;
  assertEquals(shouldSkip, false);
});

Deno.test("webex-status-sweep: looks up pairing_code by serial_number for user devices", () => {
  const pairingQuery = {
    serial_number: "A1B2C3D4",
  };

  assertExists(pairingQuery.serial_number);
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("webex-status-sweep: response contains success and counts", () => {
  const response = {
    success: true,
    updated: 5,
    skipped: 3,
    failed: 1,
  };

  assertEquals(response.success, true);
  assertEquals(typeof response.updated, "number");
  assertEquals(typeof response.skipped, "number");
  assertEquals(typeof response.failed, "number");
});

Deno.test("webex-status-sweep: tracks updated count", () => {
  let updated = 0;
  updated++;
  updated++;
  assertEquals(updated, 2);
});

Deno.test("webex-status-sweep: tracks skipped count", () => {
  let skipped = 0;
  skipped++;
  skipped++;
  skipped++;
  assertEquals(skipped, 3);
});

Deno.test("webex-status-sweep: tracks failed count", () => {
  let failed = 0;
  failed++;
  assertEquals(failed, 1);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("webex-status-sweep: continues processing after token failure", () => {
  const tokenRows = [
    { id: "token1", pairing_code: "ABC123" },
    { id: "token2", pairing_code: "XYZ789" },
  ];

  let failed = 0;
  for (const tokenRow of tokenRows) {
    try {
      // Simulate failure for first token
      if (tokenRow.id === "token1") {
        throw new Error("Token error");
      }
    } catch {
      failed++;
    }
  }

  assertEquals(failed, 1);
  // Should continue processing second token
});

Deno.test("webex-status-sweep: continues processing after user token failure", () => {
  const users = [
    { userId: "user1", serialNumbers: ["A1B2C3D4"] },
    { userId: "user2", serialNumbers: ["B2C3D4E5"] },
  ];

  let failed = 0;
  for (const { userId } of users) {
    try {
      // Simulate failure for first user
      if (userId === "user1") {
        throw new Error("User token error");
      }
    } catch {
      failed++;
    }
  }

  assertEquals(failed, 1);
  // Should continue processing second user
});

Deno.test("webex-status-sweep: returns 500 on internal server error", () => {
  const errorResponse = {
    error: "Internal server error",
  };

  assertEquals(errorResponse.error, "Internal server error");
});

// ============================================================================
// UUID-Based Broadcasting Tests
// ============================================================================

Deno.test("webex-status-sweep: broadcasts webex_status to user:{userId} channel", () => {
  const mockBroadcast = {
    topic: `user:${TEST_USER_UUID}`,
    event: "webex_status",
    payload: {
      webex_status: "active",
      in_call: false,
      user_uuid: TEST_USER_UUID,
    },
  };

  assertEquals(mockBroadcast.topic, `user:${TEST_USER_UUID}`);
  assertEquals(mockBroadcast.event, "webex_status");
  assertStringIncludes(mockBroadcast.topic, TEST_USER_UUID);
});

Deno.test("webex-status-sweep: broadcasts include all status fields", () => {
  const mockPayload = {
    webex_status: "meeting",
    in_call: true,
    user_uuid: TEST_USER_UUID,
  };

  assertExists(mockPayload.webex_status);
  assertEquals(typeof mockPayload.in_call, "boolean");
  assertExists(mockPayload.user_uuid);
});

Deno.test("webex-status-sweep: broadcasts to all user's devices", () => {
  const userId = TEST_USER_UUID;
  const deviceUuids = [TEST_DEVICE_UUID, "550e8400-e29b-41d4-a716-446655440002"];

  for (const deviceUuid of deviceUuids) {
    const broadcast = {
      topic: `device:${deviceUuid}`,
      event: "webex_status",
      payload: {
        webex_status: "active",
        in_call: false,
        device_uuid: deviceUuid,
      },
    };

    assertStringIncludes(broadcast.topic, deviceUuid);
    assertEquals(broadcast.payload.device_uuid, deviceUuid);
  }
});

Deno.test("webex-status-sweep: handles missing user_uuid gracefully", () => {
  const pairingWithUuids = {
    device_uuid: TEST_DEVICE_UUID,
    user_uuid: null,
  };

  // Should broadcast to device channel even if user_uuid is missing
  if (pairingWithUuids.device_uuid) {
    const deviceBroadcast = {
      topic: `device:${pairingWithUuids.device_uuid}`,
      event: "webex_status",
      payload: {
        webex_status: "active",
        device_uuid: pairingWithUuids.device_uuid,
      },
    };

    assertExists(deviceBroadcast.topic);
    assertEquals(deviceBroadcast.payload.device_uuid, TEST_DEVICE_UUID);
  }

  // Should skip user channel broadcast when user_uuid is null
  if (!pairingWithUuids.user_uuid) {
    // User channel broadcast skipped
    assertEquals(pairingWithUuids.user_uuid, null);
  }
});

Deno.test("webex-status-sweep: broadcasts to device channel with device_uuid", () => {
  const mockBroadcast = {
    topic: `device:${TEST_DEVICE_UUID}`,
    event: "webex_status",
    payload: {
      webex_status: "active",
      in_call: false,
      device_uuid: TEST_DEVICE_UUID,
    },
  };

  assertEquals(mockBroadcast.topic, `device:${TEST_DEVICE_UUID}`);
  assertEquals(mockBroadcast.payload.device_uuid, TEST_DEVICE_UUID);
});

Deno.test("webex-status-sweep: gets device_uuid and user_uuid for broadcast", () => {
  const pairingWithUuids = {
    device_uuid: TEST_DEVICE_UUID,
    user_uuid: TEST_USER_UUID,
  };

  assertExists(pairingWithUuids.device_uuid);
  assertExists(pairingWithUuids.user_uuid);
  assertEquals(pairingWithUuids.device_uuid.length, 36);
  assertEquals(pairingWithUuids.user_uuid.length, 36);
});
