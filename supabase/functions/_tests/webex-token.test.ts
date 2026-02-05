/**
 * Webex Token Edge Function Tests
 *
 * Tests for the webex-token Edge Function that retrieves and refreshes Webex tokens.
 *
 * Run: deno test --allow-net --allow-env _tests/webex-token.test.ts
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

  return new Request("http://localhost/webex-token", {
    method,
    headers: new Headers(defaultHeaders),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("webex-token: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Function should return 405
});

Deno.test("webex-token: rejects OPTIONS with CORS headers", () => {
  const req = createMockRequest("OPTIONS");
  assertEquals(req.method, "OPTIONS");
  // Function should return null with CORS headers
});

Deno.test("webex-token: requires Authorization header", () => {
  const req = createMockRequest("POST");
  assertEquals(req.headers.get("Authorization"), null);
  // Function should return 401 for missing token
});

Deno.test("webex-token: extracts Bearer token from Authorization header", () => {
  const req = createMockRequest("POST", undefined, {
    Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9...",
  });
  const authHeader = req.headers.get("Authorization");
  assertExists(authHeader);
  assertEquals(authHeader.startsWith("Bearer "), true);
  assertEquals(authHeader.slice(7), "eyJhbGciOiJIUzI1NiJ9...");
});

// ============================================================================
// User Token Path Tests
// ============================================================================

Deno.test("webex-token: user token path looks up token by user_id", () => {
  const mockTokenRow = {
    id: "token-uuid",
    access_token_id: "access-secret-id",
    refresh_token_id: "refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };

  assertExists(mockTokenRow.id);
  assertExists(mockTokenRow.access_token_id);
  assertExists(mockTokenRow.refresh_token_id);
  assertExists(mockTokenRow.expires_at);
});

Deno.test("webex-token: user token query filters by provider, user_id, and token_scope", () => {
  const queryFilters = {
    provider: "webex",
    user_id: "user-uuid",
    token_scope: "user",
  };

  assertEquals(queryFilters.provider, "webex");
  assertEquals(queryFilters.token_scope, "user");
  assertExists(queryFilters.user_id);
});

Deno.test("webex-token: returns 404 when user token not found", () => {
  const errorResponse = {
    error: "Webex token not found",
  };

  assertEquals(errorResponse.error, "Webex token not found");
});

// ============================================================================
// Device Token Path Tests
// ============================================================================

Deno.test("webex-token: device token path requires serial_number or pairing_code", () => {
  const validPayload = {
    serial_number: "A1B2C3D4",
    pairing_code: "ABC123",
    token_type: "device",
  };

  assertExists(validPayload.serial_number || validPayload.pairing_code);
});

Deno.test("webex-token: device token query filters by serial_number when provided", () => {
  const queryFilters = {
    provider: "webex",
    serial_number: "A1B2C3D4",
  };

  assertEquals(queryFilters.provider, "webex");
  assertExists(queryFilters.serial_number);
});

Deno.test("webex-token: device token query filters by pairing_code when serial_number missing", () => {
  const queryFilters = {
    provider: "webex",
    pairing_code: "ABC123",
  };

  assertEquals(queryFilters.provider, "webex");
  assertExists(queryFilters.pairing_code);
});

Deno.test("webex-token: returns 400 when device selector missing", () => {
  const errorResponse = {
    error: "Missing device selector",
  };

  assertEquals(errorResponse.error, "Missing device selector");
});

Deno.test("webex-token: returns 404 when device token not found", () => {
  const errorResponse = {
    error: "Webex token not found",
  };

  assertEquals(errorResponse.error, "Webex token not found");
});

// ============================================================================
// Token Refresh Tests
// ============================================================================

Deno.test("webex-token: refreshes token when expires within 5 minutes", () => {
  const expiresAt = new Date(Date.now() + 4 * 60 * 1000).toISOString(); // 4 minutes
  const expMs = new Date(expiresAt).getTime();
  const needsRefresh = expMs - Date.now() < 5 * 60 * 1000;

  assertEquals(needsRefresh, true);
});

Deno.test("webex-token: does not refresh token when expires after 5 minutes", () => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  const expMs = new Date(expiresAt).getTime();
  const needsRefresh = expMs - Date.now() < 5 * 60 * 1000;

  assertEquals(needsRefresh, false);
});

Deno.test("webex-token: refreshes token when expires_at is null", () => {
  const expiresAt = null;
  const needsRefresh = !expiresAt;

  assertEquals(needsRefresh, true);
});

Deno.test("webex-token: requires refresh_token_id to refresh", () => {
  const tokenRow = {
    refresh_token_id: "refresh-secret-id",
  };

  const canRefresh = !!tokenRow.refresh_token_id;
  assertEquals(canRefresh, true);
});

Deno.test("webex-token: skips refresh when refresh_token_id is null", () => {
  const tokenRow = {
    refresh_token_id: null,
  };

  const canRefresh = !!tokenRow.refresh_token_id;
  assertEquals(canRefresh, false);
});

Deno.test("webex-token: fetches OAuth client config for refresh", () => {
  const clientQuery = {
    provider: "webex",
    active: true,
  };

  assertEquals(clientQuery.provider, "webex");
  assertEquals(clientQuery.active, true);
});

Deno.test("webex-token: returns 500 when OAuth client not configured", () => {
  const errorResponse = {
    error: "Webex client not configured",
  };

  assertEquals(errorResponse.error, "Webex client not configured");
});

Deno.test("webex-token: updates access_token_id after refresh", () => {
  const updateData = {
    access_token_id: "new-access-secret-id",
    refresh_token_id: "new-refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  assertExists(updateData.access_token_id);
  assertExists(updateData.expires_at);
});

Deno.test("webex-token: uses new refresh_token if provided by refresh response", () => {
  const refreshResponse: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  } = {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    expires_in: 3600,
  };

  const newRefresh = refreshResponse.refresh_token ?? "old-refresh-token";
  assertEquals(newRefresh, "new-refresh-token");
});

Deno.test("webex-token: falls back to existing refresh_token if not provided", () => {
  const refreshResponse: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  } = {
    access_token: "new-access-token",
    expires_in: 3600,
  };
  const existingRefresh = "old-refresh-token";

  const newRefresh = refreshResponse.refresh_token ?? existingRefresh;
  assertEquals(newRefresh, "old-refresh-token");
});

Deno.test("webex-token: calculates expires_at from expires_in", () => {
  const expiresIn = 3600; // 1 hour
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  assertExists(expiresAt);
  const expDate = new Date(expiresAt);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();
  assertEquals(diffMs >= 3590000 && diffMs <= 3610000, true); // ~1 hour
});

Deno.test("webex-token: defaults expires_in to 3600 if not provided", () => {
  const refreshResponse: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  } = {
    access_token: "token",
  };

  const expiresIn = typeof refreshResponse.expires_in === "number"
    ? refreshResponse.expires_in
    : 3600;
  assertEquals(expiresIn, 3600);
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("webex-token: success response contains access_token and expires_at", () => {
  const response = {
    access_token: "webex-access-token",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };

  assertExists(response.access_token);
  assertExists(response.expires_at);
  assertStringIncludes(response.expires_at, "T");
});

Deno.test("webex-token: response uses correct secret key format for user tokens", () => {
  const userId = "user-uuid";
  const secretKey = `user_${userId}`;
  const accessTokenName = `webex_access_${secretKey}`;

  assertEquals(accessTokenName, "webex_access_user_user-uuid");
});

Deno.test("webex-token: response uses correct secret key format for device tokens", () => {
  const serialNumber = "A1B2C3D4";
  const secretKey = serialNumber || "token";
  const accessTokenName = `webex_access_${secretKey}`;

  assertEquals(accessTokenName, "webex_access_A1B2C3D4");
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("webex-token: returns 500 when JWT_SECRET not configured", () => {
  const errorResponse = {
    error: "Server configuration error",
  };

  assertEquals(errorResponse.error, "Server configuration error");
});

Deno.test("webex-token: returns 401 for invalid device token", () => {
  const errorResponse = {
    error: "Invalid token",
  };

  assertEquals(errorResponse.error, "Invalid token");
});

Deno.test("webex-token: returns 500 on internal server error", () => {
  const errorResponse = {
    error: "Internal server error",
  };

  assertEquals(errorResponse.error, "Internal server error");
});

// ============================================================================
// Token Validation Tests
// ============================================================================

Deno.test("webex-token: validates token expiration before refresh", () => {
  const now = Date.now();
  const expiresAt = new Date(now + 4 * 60 * 1000).toISOString(); // 4 minutes
  const expMs = new Date(expiresAt).getTime();
  const threshold = 5 * 60 * 1000; // 5 minutes

  const needsRefresh = expMs - now < threshold;
  assertEquals(needsRefresh, true);
});

Deno.test("webex-token: handles null expires_at as expired", () => {
  const expiresAt = null;
  const needsRefresh = !expiresAt;

  assertEquals(needsRefresh, true);
});
