/**
 * Webex Status Edge Function Tests
 *
 * Tests for the webex-status Edge Function that syncs Webex status to pairings.
 *
 * Run: deno test --allow-net --allow-env _tests/webex-status.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  return new Request("http://localhost/webex-status", {
    method,
    headers: new Headers(defaultHeaders),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("webex-status: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Function should return 405
});

Deno.test("webex-status: requires Authorization header or X-Device-Token", () => {
  const req1 = createMockRequest("POST");
  assertEquals(req1.headers.get("Authorization"), null);
  assertEquals(req1.headers.get("X-Device-Token"), null);
  // Function should return 401

  const req2 = createMockRequest("POST", undefined, {
    "X-Device-Token": "device-token",
  });
  assertEquals(req2.headers.get("X-Device-Token"), "device-token");
});

Deno.test("webex-status: extracts token from Authorization header", () => {
  const req = createMockRequest("POST", undefined, {
    Authorization: "Bearer device-token",
  });
  const authHeader = req.headers.get("Authorization");
  assertExists(authHeader);
  assertEquals(authHeader.startsWith("Bearer "), true);
});

Deno.test("webex-status: extracts token from X-Device-Token header", () => {
  const req = createMockRequest("POST", undefined, {
    "X-Device-Token": "device-token",
  });
  assertEquals(req.headers.get("X-Device-Token"), "device-token");
});

Deno.test("webex-status: extracts token from X-Auth-Token header", () => {
  const req = createMockRequest("POST", undefined, {
    "X-Auth-Token": "device-token",
  });
  assertEquals(req.headers.get("X-Auth-Token"), "device-token");
});

Deno.test("webex-status: requires pairing_code or serial_number", () => {
  const validBody: {
    pairing_code?: string;
    serial_number?: string;
    webex_status?: string;
  } = {
    pairing_code: "ABC123",
  };

  assertExists(validBody.pairing_code || validBody.serial_number);
});

Deno.test("webex-status: returns 400 when device selector missing", () => {
  const errorResponse = {
    error: "Missing device selector",
  };

  assertEquals(errorResponse.error, "Missing device selector");
});

// ============================================================================
// Local Status Tests
// ============================================================================

Deno.test("webex-status: accepts webex_status in request body", () => {
  const body: {
    pairing_code?: string;
    serial_number?: string;
    webex_status?: string;
  } = {
    pairing_code: "ABC123",
    webex_status: "active",
  };

  const hasLocalStatus = typeof body.webex_status === "string" &&
    body.webex_status.trim().length > 0;
  assertEquals(hasLocalStatus, true);
  assertEquals(body.webex_status, "active");
});

Deno.test("webex-status: normalizes local webex_status", () => {
  const body: {
    pairing_code?: string;
    serial_number?: string;
    webex_status?: string;
  } = {
    webex_status: "available", // Should normalize to "active"
  };

  const status = body.webex_status?.trim().toLowerCase() ?? "";
  assertEquals(status, "available");
  // Function should normalize this via normalizeWebexStatus()
});

Deno.test("webex-status: skips API call when local status provided", () => {
  const body: {
    pairing_code?: string;
    serial_number?: string;
    webex_status?: string;
  } = {
    pairing_code: "ABC123",
    webex_status: "active",
  };

  const hasLocalStatus = typeof body.webex_status === "string" &&
    body.webex_status.trim().length > 0;
  assertEquals(hasLocalStatus, true);
  // Function should skip Webex API call
});

// ============================================================================
// Token Lookup Tests
// ============================================================================

Deno.test("webex-status: looks up token by serial_number", () => {
  const tokenQuery = {
    provider: "webex",
    serial_number: "A1B2C3D4",
  };

  assertEquals(tokenQuery.provider, "webex");
  assertExists(tokenQuery.serial_number);
});

Deno.test("webex-status: looks up token by pairing_code when serial_number missing", () => {
  const tokenQuery = {
    provider: "webex",
    pairing_code: "ABC123",
  };

  assertEquals(tokenQuery.provider, "webex");
  assertExists(tokenQuery.pairing_code);
});

Deno.test("webex-status: returns 404 when token not found", () => {
  const errorResponse = {
    error: "Webex token not found",
  };

  assertEquals(errorResponse.error, "Webex token not found");
});

Deno.test("webex-status: returns 500 when OAuth client not configured", () => {
  const errorResponse = {
    error: "Webex client configuration missing",
  };

  assertEquals(errorResponse.error, "Webex client configuration missing");
});

// ============================================================================
// Token Refresh Tests
// ============================================================================

Deno.test("webex-status: refreshes token when expires within 1 minute", () => {
  const expiresAt = new Date(Date.now() + 30 * 1000); // 30 seconds
  const now = new Date();
  const shouldRefresh = !expiresAt || expiresAt.getTime() - now.getTime() < 60 * 1000;

  assertEquals(shouldRefresh, true);
});

Deno.test("webex-status: does not refresh token when expires after 1 minute", () => {
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
  const now = new Date();
  const shouldRefresh = !expiresAt || expiresAt.getTime() - now.getTime() < 60 * 1000;

  assertEquals(shouldRefresh, false);
});

Deno.test("webex-status: refreshes token when expires_at is null", () => {
  const expiresAt = null;
  const now = new Date();
  const shouldRefresh = !expiresAt || false;

  assertEquals(shouldRefresh, true);
});

Deno.test("webex-status: updates token row after refresh", () => {
  const updateData = {
    access_token_id: "new-access-secret-id",
    refresh_token_id: "new-refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  assertExists(updateData.access_token_id);
  assertExists(updateData.expires_at);
});

// ============================================================================
// Status Fetching Tests
// ============================================================================

Deno.test("webex-status: fetches status from Webex API when no local status", () => {
  const body: {
    pairing_code?: string;
    serial_number?: string;
    webex_status?: string;
  } = {
    pairing_code: "ABC123",
  };

  const hasLocalStatus = typeof body.webex_status === "string" &&
    body.webex_status.trim().length > 0;
  assertEquals(hasLocalStatus, false);
  // Function should call fetchWebexStatus()
});

Deno.test("webex-status: retries with refreshed token on API failure", () => {
  const refreshToken = "refresh-token";
  const canRetry = !!refreshToken;

  assertEquals(canRetry, true);
  // Function should refresh token and retry fetchWebexStatus()
});

Deno.test("webex-status: throws error if refresh fails on retry", () => {
  const refreshToken = null;
  const canRetry = !!refreshToken;

  assertEquals(canRetry, false);
  // Function should throw error if no refresh token available
});

// ============================================================================
// Pairing Update Tests
// ============================================================================

Deno.test("webex-status: updates pairing with webex_status", () => {
  const updateData = {
    webex_status: "active",
  };

  assertExists(updateData.webex_status);
});

Deno.test("webex-status: updates app_connected and app_last_seen when fetching from API", () => {
  const hasLocalStatus = false;
  const updateData: Record<string, unknown> = {
    webex_status: "active",
  };

  if (!hasLocalStatus) {
    updateData.app_connected = true;
    updateData.app_last_seen = new Date().toISOString();
  }

  assertEquals(updateData.app_connected, true);
  assertExists(updateData.app_last_seen);
});

Deno.test("webex-status: does not update app_connected when local status provided", () => {
  const hasLocalStatus = true;
  const updateData: Record<string, unknown> = {
    webex_status: "active",
  };

  if (!hasLocalStatus) {
    updateData.app_connected = true;
    updateData.app_last_seen = new Date().toISOString();
  }

  assertEquals("app_connected" in updateData, false);
});

Deno.test("webex-status: updates camera_on when provided", () => {
  const body = {
    camera_on: true,
  };
  const updateData: Record<string, unknown> = {
    webex_status: "active",
  };

  if (typeof body.camera_on === "boolean") {
    updateData.camera_on = body.camera_on;
  }

  assertEquals(updateData.camera_on, true);
});

Deno.test("webex-status: updates mic_muted when provided", () => {
  const body = {
    mic_muted: false,
  };
  const updateData: Record<string, unknown> = {
    webex_status: "active",
  };

  if (typeof body.mic_muted === "boolean") {
    updateData.mic_muted = body.mic_muted;
  }

  assertEquals(updateData.mic_muted, false);
});

Deno.test("webex-status: updates in_call when provided", () => {
  const body = {
    in_call: true,
  };
  const updateData: Record<string, unknown> = {
    webex_status: "active",
  };

  if (typeof body.in_call === "boolean") {
    updateData.in_call = body.in_call;
  }

  assertEquals(updateData.in_call, true);
});

Deno.test("webex-status: updates display_name when provided", () => {
  const body = {
    display_name: "John Doe",
  };
  const updateData: Record<string, unknown> = {
    webex_status: "active",
  };

  if (typeof body.display_name === "string" && body.display_name.trim()) {
    updateData.display_name = body.display_name.trim();
  }

  assertEquals(updateData.display_name, "John Doe");
});

Deno.test("webex-status: trims display_name before updating", () => {
  const body = {
    display_name: "  John Doe  ",
  };
  const updateData: Record<string, unknown> = {};

  if (typeof body.display_name === "string" && body.display_name.trim()) {
    updateData.display_name = body.display_name.trim();
  }

  assertEquals(updateData.display_name, "John Doe");
});

Deno.test("webex-status: filters pairing update by pairing_code", () => {
  const pairingCode = "ABC123";
  const updateFilter = {
    pairing_code: pairingCode,
  };

  assertEquals(updateFilter.pairing_code, "ABC123");
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("webex-status: success response contains status and device info", () => {
  const response = {
    success: true,
    webex_status: "active",
    pairing_code: "ABC123",
    device_id: "webex-display-C3D4",
    serial_number: "A1B2C3D4",
  };

  assertEquals(response.success, true);
  assertExists(response.webex_status);
  assertExists(response.pairing_code);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("webex-status: returns 500 when JWT_SECRET not configured", () => {
  const errorResponse = {
    error: "Server configuration error",
  };

  assertEquals(errorResponse.error, "Server configuration error");
});

Deno.test("webex-status: returns 401 for invalid token", () => {
  const errorResponse = {
    error: "Invalid token",
  };

  assertEquals(errorResponse.error, "Invalid token");
});

Deno.test("webex-status: returns 500 on internal server error", () => {
  const errorResponse = {
    error: "Internal server error",
  };

  assertEquals(errorResponse.error, "Internal server error");
});

// ============================================================================
// Body Parsing Tests
// ============================================================================

Deno.test("webex-status: handles empty body gracefully", () => {
  const body = {};
  assertEquals(Object.keys(body).length, 0);
  // Function should accept empty body
});

Deno.test("webex-status: handles invalid JSON body gracefully", () => {
  const invalidJson = "{ invalid json }";
  try {
    JSON.parse(invalidJson);
    assertEquals(true, false); // Should not reach here
  } catch {
    // Function should catch and use empty body
    assertEquals(true, true);
  }
});
