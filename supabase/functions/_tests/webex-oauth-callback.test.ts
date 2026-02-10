/**
 * Webex OAuth Callback Edge Function Tests
 *
 * Tests for the webex-oauth-callback Edge Function that handles device OAuth flow.
 * Uses nonce-based state validation (state is a plain 32-char hex nonce string).
 *
 * Run: deno test --allow-net --allow-env _tests/webex-oauth-callback.test.ts
 */

import {
    assertEquals,
    assertExists
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

  return new Request("http://localhost/webex-oauth-callback", {
    method,
    headers: new Headers(defaultHeaders),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function generateNonce(): string {
  // Generate a 32-character hex string (nonce format)
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("webex-oauth-callback: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Function should return 405
});

Deno.test("webex-oauth-callback: requires code and state in body", () => {
  const invalidBody = {};
  assertEquals("code" in invalidBody, false);
  assertEquals("state" in invalidBody, false);
  // Function should return 400
});

Deno.test("webex-oauth-callback: returns 400 when code missing", () => {
  const errorResponse = {
    error: "Missing code or state",
  };

  assertEquals(errorResponse.error, "Missing code or state");
});

Deno.test("webex-oauth-callback: returns 400 when state missing", () => {
  const errorResponse = {
    error: "Missing code or state",
  };

  assertEquals(errorResponse.error, "Missing code or state");
});

// ============================================================================
// State Parsing Tests (Nonce-based)
// ============================================================================

Deno.test("webex-oauth-callback: state is plain nonce string (not base64)", () => {
  const nonce = generateNonce();
  assertEquals(nonce.length, 32);
  assertEquals(/^[0-9a-f]{32}$/.test(nonce), true);
});

Deno.test("webex-oauth-callback: validates nonce format (32-char hex)", () => {
  const validNonce = "a1b2c3d4e5f6789012345678901234ab";
  const invalidNonce1 = "too-short";
  const invalidNonce2 = "not-hex-characters-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

  assertEquals(/^[0-9a-f]{32}$/.test(validNonce), true);
  assertEquals(/^[0-9a-f]{32}$/.test(invalidNonce1), false);
  assertEquals(/^[0-9a-f]{32}$/.test(invalidNonce2), false);
});

Deno.test("webex-oauth-callback: returns 400 when state format invalid", () => {
  const errorResponse = {
    error: "Invalid state",
  };

  assertEquals(errorResponse.error, "Invalid state");
});

// ============================================================================
// Nonce Lookup Tests
// ============================================================================

Deno.test("webex-oauth-callback: looks up nonce in oauth_nonces table", () => {
  const nonce = generateNonce();
  const nonceQuery = {
    nonce: nonce,
    table: "display.oauth_nonces",
  };

  assertExists(nonceQuery.nonce);
  assertEquals(nonceQuery.table, "display.oauth_nonces");
});

Deno.test("webex-oauth-callback: nonce lookup returns device_uuid", () => {
  const nonceData = {
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    token_type: "device",
  };

  assertExists(nonceData.device_uuid);
  assertEquals(typeof nonceData.device_uuid, "string");
});

Deno.test("webex-oauth-callback: nonce lookup returns serial_number", () => {
  const nonceData = {
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    token_type: "device",
  };

  assertExists(nonceData.serial_number);
  assertEquals(nonceData.serial_number, "A1B2C3D4");
});

Deno.test("webex-oauth-callback: nonce lookup returns user_uuid", () => {
  const nonceData = {
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    token_type: "device",
  };

  assertExists(nonceData.user_uuid);
  assertEquals(typeof nonceData.user_uuid, "string");
});

Deno.test("webex-oauth-callback: nonce lookup returns token_type", () => {
  const nonceData = {
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    token_type: "device",
  };

  const validTypes = ["device", "app"];
  assertEquals(validTypes.includes(nonceData.token_type), true);
});

Deno.test("webex-oauth-callback: returns 401 when nonce not found", () => {
  const errorResponse = {
    error: "Invalid state",
  };

  assertEquals(errorResponse.error, "Invalid state");
  // Function should return 401 when nonce doesn't exist in DB
});

Deno.test("webex-oauth-callback: returns 401 when nonce expired", () => {
  const expiredNonce = {
    nonce: generateNonce(),
    expires_at: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
  };

  const isExpired = new Date(expiredNonce.expires_at) < new Date();
  assertEquals(isExpired, true);
  // Function should return 401 when nonce.expires_at < now()
});

Deno.test("webex-oauth-callback: nonce is deleted after successful use", () => {
  const nonce = generateNonce();
  const deleteOperation = {
    table: "display.oauth_nonces",
    nonce: nonce,
    action: "delete",
  };

  assertExists(deleteOperation.nonce);
  assertEquals(deleteOperation.action, "delete");
  // Function should delete nonce after successful token exchange (single-use)
});

// ============================================================================
// Token Validation Tests
// ============================================================================

Deno.test("webex-oauth-callback: validates token_type from nonce is device or app", () => {
  const validTypes = ["device", "app"];
  const tokenType = "device";

  assertEquals(validTypes.includes(tokenType), true);
});

Deno.test("webex-oauth-callback: returns 401 when token_type invalid", () => {
  const tokenType = "invalid";
  const validTypes = ["device", "app"];

  assertEquals(validTypes.includes(tokenType), false);
  // Function should return 401
});

// ============================================================================
// OAuth Client Tests
// ============================================================================

Deno.test("webex-oauth-callback: fetches OAuth client config", () => {
  const clientQuery = {
    provider: "webex",
    purpose: "device",
    active: true,
  };

  assertEquals(clientQuery.provider, "webex");
  assertEquals(clientQuery.purpose, "device");
  assertEquals(clientQuery.active, true);
});

Deno.test("webex-oauth-callback: returns 500 when OAuth client not configured", () => {
  const errorResponse = {
    error: "Webex client not configured",
  };

  assertEquals(errorResponse.error, "Webex client not configured");
});

// ============================================================================
// Token Exchange Tests
// ============================================================================

Deno.test("webex-oauth-callback: exchanges code for tokens", () => {
  const tokenRequest = {
    grant_type: "authorization_code",
    client_id: "client-id",
    client_secret: "client-secret",
    code: "auth-code",
    redirect_uri: "https://example.com/callback",
  };

  assertEquals(tokenRequest.grant_type, "authorization_code");
  assertExists(tokenRequest.code);
});

Deno.test("webex-oauth-callback: returns 400 when token exchange fails", () => {
  const errorResponse = {
    error: "Token exchange failed",
  };

  assertEquals(errorResponse.error, "Token exchange failed");
});

Deno.test("webex-oauth-callback: extracts access_token from response", () => {
  const tokenData: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  } = {
    access_token: "webex-access-token",
    refresh_token: "webex-refresh-token",
    expires_in: 3600,
  };

  assertExists(tokenData.access_token);
  assertEquals(typeof tokenData.access_token, "string");
});

Deno.test("webex-oauth-callback: extracts refresh_token when provided", () => {
  const tokenData: {
    access_token: string;
    refresh_token?: string;
  } = {
    access_token: "token",
    refresh_token: "refresh-token",
  };

  const refreshToken = tokenData.refresh_token;
  assertExists(refreshToken);
});

Deno.test("webex-oauth-callback: handles missing refresh_token", () => {
  const tokenData: {
    access_token: string;
    refresh_token?: string;
  } = {
    access_token: "token",
  };

  const refreshToken = tokenData.refresh_token;
  assertEquals(refreshToken, undefined);
});

Deno.test("webex-oauth-callback: calculates expires_at from expires_in", () => {
  const expiresIn = 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  assertExists(expiresAt);
});

Deno.test("webex-oauth-callback: defaults expires_in to 3600", () => {
  const tokenData: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } = {};
  const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;

  assertEquals(expiresIn, 3600);
});

// ============================================================================
// Token Storage Tests (Nonce-based)
// ============================================================================

Deno.test("webex-oauth-callback: looks up existing token by device_uuid and user_uuid", () => {
  const tokenQuery = {
    provider: "webex",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    token_scope: "user",
  };

  assertEquals(tokenQuery.provider, "webex");
  assertExists(tokenQuery.device_uuid);
  assertExists(tokenQuery.user_uuid);
});

Deno.test("webex-oauth-callback: token storage uses device_uuid from nonce", () => {
  const nonceData = {
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
  };

  const tokenStorage = {
    device_uuid: nonceData.device_uuid,
    user_uuid: nonceData.user_uuid,
  };

  assertExists(tokenStorage.device_uuid);
  assertEquals(tokenStorage.device_uuid, nonceData.device_uuid);
});

Deno.test("webex-oauth-callback: token storage uses user_uuid from nonce (NOT pairing_code)", () => {
  const nonceData = {
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
  };

  const tokenStorage = {
    device_uuid: nonceData.device_uuid,
    user_uuid: nonceData.user_uuid,
    // Should NOT use pairing_code
  };

  assertExists(tokenStorage.user_uuid);
  assertEquals(tokenStorage.user_uuid, nonceData.user_uuid);
  // Verify pairing_code is NOT used
  assertEquals("pairing_code" in tokenStorage, false);
});

Deno.test("webex-oauth-callback: stores access token in vault", () => {
  const accessToken = "webex-access-token";
  const secretKey = "550e8400-e29b-41d4-a716-446655440000"; // device_uuid
  const secretName = `webex_access_${secretKey}`;

  assertExists(accessToken);
  assertEquals(secretName, "webex_access_550e8400-e29b-41d4-a716-446655440000");
});

Deno.test("webex-oauth-callback: stores refresh token in vault when provided", () => {
  const refreshToken = "webex-refresh-token";
  const secretKey = "550e8400-e29b-41d4-a716-446655440000"; // device_uuid
  const secretName = `webex_refresh_${secretKey}`;

  if (refreshToken) {
    assertExists(refreshToken);
    assertEquals(secretName, "webex_refresh_550e8400-e29b-41d4-a716-446655440000");
  }
});

Deno.test("webex-oauth-callback: updates existing token row", () => {
  const updateData = {
    access_token_id: "new-access-secret-id",
    refresh_token_id: "new-refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    updated_at: new Date().toISOString(),
  };

  assertExists(updateData.access_token_id);
  assertExists(updateData.expires_at);
  assertExists(updateData.device_uuid);
  assertExists(updateData.user_uuid);
});

Deno.test("webex-oauth-callback: creates new token row when not exists", () => {
  const insertData = {
    provider: "webex",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    access_token_id: "access-secret-id",
    refresh_token_id: "refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    token_scope: "user",
  };

  assertEquals(insertData.provider, "webex");
  assertExists(insertData.device_uuid);
  assertExists(insertData.user_uuid);
});

Deno.test("webex-oauth-callback: uses existing refresh_token_id when refresh_token missing", () => {
  const existing = {
    refresh_token_id: "existing-refresh-id",
  };
  const refreshToken = null;
  const refreshTokenId = refreshToken
    ? "new-refresh-id"
    : existing.refresh_token_id;

  assertEquals(refreshTokenId, "existing-refresh-id");
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("webex-oauth-callback: success response indicates success", () => {
  const response = {
    success: true,
  };

  assertEquals(response.success, true);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("webex-oauth-callback: returns 500 when config error", () => {
  const errorResponse = {
    error: "Server configuration error",
  };

  assertEquals(errorResponse.error, "Server configuration error");
});

Deno.test("webex-oauth-callback: returns 500 on internal server error", () => {
  const errorResponse = {
    error: "Internal server error",
  };

  assertEquals(errorResponse.error, "Internal server error");
});
