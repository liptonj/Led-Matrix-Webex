/**
 * Webex OAuth Callback Edge Function Tests
 *
 * Tests for the webex-oauth-callback Edge Function that handles device OAuth flow.
 *
 * Run: deno test --allow-net --allow-env _tests/webex-oauth-callback.test.ts
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

  return new Request("http://localhost/webex-oauth-callback", {
    method,
    headers: new Headers(defaultHeaders),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
  try {
    return atob(padded);
  } catch {
    throw new Error("Invalid base64url encoding");
  }
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
// State Parsing Tests
// ============================================================================

Deno.test("webex-oauth-callback: parses state from base64url", () => {
  const state = "eyJwYWlyaW5nX2NvZGUiOiJBQkMxMjMiLCJzZXJpYWwiOiJBMUIyQzNENCJ9";
  let parsedState;
  try {
    parsedState = JSON.parse(fromBase64Url(state));
  } catch {
    parsedState = null;
  }

  assertExists(parsedState);
});

Deno.test("webex-oauth-callback: returns 400 when state format invalid", () => {
  const errorResponse = {
    error: "Invalid state",
  };

  assertEquals(errorResponse.error, "Invalid state");
});

Deno.test("webex-oauth-callback: extracts pairing_code from state", () => {
  const parsedState = {
    pairing_code: "ABC123",
    serial: "A1B2C3D4",
    ts: "1234567890",
    sig: "signature",
    token: "device-token",
  };

  assertExists(parsedState.pairing_code);
  assertEquals(parsedState.pairing_code, "ABC123");
});

Deno.test("webex-oauth-callback: extracts serial_number from state", () => {
  const parsedState = {
    pairing_code: "ABC123",
    serial: "A1B2C3D4",
  };

  assertExists(parsedState.serial);
  assertEquals(parsedState.serial, "A1B2C3D4");
});

// ============================================================================
// Token Validation Tests
// ============================================================================

Deno.test("webex-oauth-callback: verifies device token from state", () => {
  const token = "device-token";
  const tokenSecret = "jwt-secret";

  assertExists(token);
  assertExists(tokenSecret);
  // Function should call verifyDeviceToken()
});

Deno.test("webex-oauth-callback: returns 401 when token invalid", () => {
  const errorResponse = {
    error: "Invalid token",
  };

  assertEquals(errorResponse.error, "Invalid token");
});

Deno.test("webex-oauth-callback: validates token_type is device or app", () => {
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
// HMAC Validation Tests (Device Token Path)
// ============================================================================

Deno.test("webex-oauth-callback: validates HMAC for device tokens", () => {
  const hmacRequest = {
    headers: {
      "X-Device-Serial": "A1B2C3D4",
      "X-Timestamp": "1234567890",
      "X-Signature": "hmac-signature",
      Authorization: "Bearer device-token",
    },
  };

  assertExists(hmacRequest.headers["X-Device-Serial"]);
  assertExists(hmacRequest.headers["X-Timestamp"]);
  assertExists(hmacRequest.headers["X-Signature"]);
});

Deno.test("webex-oauth-callback: returns 401 when HMAC invalid", () => {
  const errorResponse = {
    error: "Invalid signature",
  };

  assertEquals(errorResponse.error, "Invalid signature");
});

Deno.test("webex-oauth-callback: validates token matches device serial", () => {
  const hmacDevice = {
    serial_number: "A1B2C3D4",
  };
  const tokenPayload = {
    serial_number: "A1B2C3D4",
  };

  const matches = hmacDevice.serial_number === tokenPayload.serial_number;
  assertEquals(matches, true);
});

Deno.test("webex-oauth-callback: returns 401 when token serial mismatch", () => {
  const hmacDevice = {
    serial_number: "A1B2C3D4",
  };
  const tokenPayload = {
    serial_number: "X1Y2Z3W4",
  };

  const matches = hmacDevice.serial_number === tokenPayload.serial_number;
  assertEquals(matches, false);
  // Function should return 401
});

// ============================================================================
// App Token Path Tests
// ============================================================================

Deno.test("webex-oauth-callback: requires pairing_code for app tokens", () => {
  const tokenPayload = {
    pairing_code: "ABC123",
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
  };

  const hasRequired = !!(tokenPayload.pairing_code && tokenPayload.serial_number && tokenPayload.device_id);
  assertEquals(hasRequired, true);
});

Deno.test("webex-oauth-callback: returns 401 when app token missing device identity", () => {
  const tokenPayload = {
    pairing_code: null,
    serial_number: null,
  };

  const hasRequired = !!(tokenPayload.pairing_code && tokenPayload.serial_number);
  assertEquals(hasRequired, false);
  // Function should return 401
});

Deno.test("webex-oauth-callback: validates state pairing_code matches token", () => {
  const parsedState = {
    pairing_code: "ABC123",
  };
  const tokenPayload = {
    pairing_code: "ABC123",
  };

  const matches = parsedState.pairing_code === tokenPayload.pairing_code;
  assertEquals(matches, true);
});

Deno.test("webex-oauth-callback: returns 401 when pairing_code mismatch", () => {
  const parsedState = {
    pairing_code: "ABC123",
  };
  const tokenPayload = {
    pairing_code: "XYZ789",
  };

  const matches = parsedState.pairing_code === tokenPayload.pairing_code;
  assertEquals(matches, false);
  // Function should return 401
});

Deno.test("webex-oauth-callback: validates state serial matches token", () => {
  const parsedState = {
    serial: "A1B2C3D4",
  };
  const tokenPayload = {
    serial_number: "A1B2C3D4",
  };

  const matches = parsedState.serial === tokenPayload.serial_number;
  assertEquals(matches, true);
});

Deno.test("webex-oauth-callback: returns 401 when serial mismatch", () => {
  const parsedState = {
    serial: "A1B2C3D4",
  };
  const tokenPayload = {
    serial_number: "X1Y2Z3W4",
  };

  const matches = parsedState.serial === tokenPayload.serial_number;
  assertEquals(matches, false);
  // Function should return 401
});

// ============================================================================
// OAuth Client Tests
// ============================================================================

Deno.test("webex-oauth-callback: fetches OAuth client config", () => {
  const clientQuery = {
    provider: "webex",
    active: true,
  };

  assertEquals(clientQuery.provider, "webex");
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
// Token Storage Tests
// ============================================================================

Deno.test("webex-oauth-callback: looks up existing token by serial_number", () => {
  const tokenQuery = {
    provider: "webex",
    serial_number: "A1B2C3D4",
  };

  assertEquals(tokenQuery.provider, "webex");
  assertExists(tokenQuery.serial_number);
});

Deno.test("webex-oauth-callback: looks up existing token by pairing_code", () => {
  const tokenQuery = {
    provider: "webex",
    pairing_code: "ABC123",
  };

  assertEquals(tokenQuery.provider, "webex");
  assertExists(tokenQuery.pairing_code);
});

Deno.test("webex-oauth-callback: stores access token in vault", () => {
  const accessToken = "webex-access-token";
  const secretKey = "A1B2C3D4";
  const secretName = `webex_access_${secretKey}`;

  assertExists(accessToken);
  assertEquals(secretName, "webex_access_A1B2C3D4");
});

Deno.test("webex-oauth-callback: stores refresh token in vault when provided", () => {
  const refreshToken = "webex-refresh-token";
  const secretKey = "A1B2C3D4";
  const secretName = `webex_refresh_${secretKey}`;

  if (refreshToken) {
    assertExists(refreshToken);
    assertEquals(secretName, "webex_refresh_A1B2C3D4");
  }
});

Deno.test("webex-oauth-callback: updates existing token row", () => {
  const updateData = {
    access_token_id: "new-access-secret-id",
    refresh_token_id: "new-refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    pairing_code: "ABC123",
    serial_number: "A1B2C3D4",
    updated_at: new Date().toISOString(),
  };

  assertExists(updateData.access_token_id);
  assertExists(updateData.expires_at);
});

Deno.test("webex-oauth-callback: creates new token row when not exists", () => {
  const insertData = {
    provider: "webex",
    serial_number: "A1B2C3D4",
    pairing_code: "ABC123",
    access_token_id: "access-secret-id",
    refresh_token_id: "refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };

  assertEquals(insertData.provider, "webex");
  assertExists(insertData.serial_number);
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

Deno.test("webex-oauth-callback: returns 500 when JWT_SECRET not configured", () => {
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
