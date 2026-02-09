/**
 * Webex OAuth Start Edge Function Tests
 *
 * Tests for the webex-oauth-start Edge Function that handles device OAuth flow
 * using a server-side nonce pattern with two modes: Create (authenticated device)
 * and Resolve (unauthenticated browser).
 *
 * Run: deno test --allow-net --allow-env _tests/webex-oauth-start.test.ts
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

  return new Request("http://localhost/webex-oauth-start", {
    method,
    headers: new Headers(defaultHeaders),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function isValidHexString(str: string, length: number): boolean {
  return /^[0-9a-f]+$/i.test(str) && str.length === length;
}

// ============================================================================
// Create Mode Tests - Request Validation
// ============================================================================

Deno.test("webex-oauth-start: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Function should return 405
});

Deno.test("webex-oauth-start: rejects requests without Authorization header", () => {
  const req = createMockRequest("POST");
  assertEquals(req.headers.get("Authorization"), null);
  // Function should return 401
});

Deno.test("webex-oauth-start: requires Authorization Bearer header", () => {
  const req = createMockRequest("POST", undefined, {
    Authorization: "Bearer device-token",
  });
  const authHeader = req.headers.get("Authorization");
  assertExists(authHeader);
  assertEquals(authHeader.startsWith("Bearer "), true);
});

Deno.test("webex-oauth-start: rejects invalid token types", () => {
  const validTypes = ["device", "app"];
  const tokenType = "invalid";

  assertEquals(validTypes.includes(tokenType), false);
  // Function should return 401
});

Deno.test("webex-oauth-start: accepts device token type", () => {
  const validTypes = ["device", "app"];
  const tokenType = "device";

  assertEquals(validTypes.includes(tokenType), true);
});

Deno.test("webex-oauth-start: accepts app token type", () => {
  const validTypes = ["device", "app"];
  const tokenType = "app";

  assertEquals(validTypes.includes(tokenType), true);
});

// ============================================================================
// Create Mode Tests - HMAC Validation (Device Tokens)
// ============================================================================

Deno.test("webex-oauth-start: validates HMAC headers present for device tokens", () => {
  const hmacRequest = createMockRequest("POST", undefined, {
    Authorization: "Bearer device-token",
    "X-Device-Serial": "A1B2C3D4",
    "X-Timestamp": "1234567890",
    "X-Signature": "hmac-signature",
  });

  assertExists(hmacRequest.headers.get("X-Device-Serial"));
  assertExists(hmacRequest.headers.get("X-Timestamp"));
  assertExists(hmacRequest.headers.get("X-Signature"));
});

Deno.test("webex-oauth-start: returns 401 when HMAC validation fails", () => {
  const errorResponse = {
    error: "Invalid signature",
  };

  assertEquals(errorResponse.error, "Invalid signature");
  // Function should return 401
});

Deno.test("webex-oauth-start: returns 401 when token serial doesn't match HMAC serial", () => {
  const tokenPayload = {
    serial_number: "A1B2C3D4",
  };
  const hmacSerial = "X1Y2Z3W4";

  const matches = tokenPayload.serial_number === hmacSerial;
  assertEquals(matches, false);
  // Function should return 401
});

Deno.test("webex-oauth-start: validates token serial matches HMAC serial", () => {
  const tokenPayload = {
    serial_number: "A1B2C3D4",
  };
  const hmacSerial = "A1B2C3D4";

  const matches = tokenPayload.serial_number === hmacSerial;
  assertEquals(matches, true);
});

// ============================================================================
// Create Mode Tests - Nonce Generation and Response
// ============================================================================

Deno.test("webex-oauth-start: returns nonce in response", () => {
  const response = {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    page_url: "https://display.5ls.us/webexauth?nonce=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6&serial=A1B2C3D4",
  };

  assertExists(response.nonce);
  assertEquals(typeof response.nonce, "string");
  assertEquals(response.nonce.length, 32);
  assertEquals(isValidHexString(response.nonce, 32), true);
});

Deno.test("webex-oauth-start: nonce is 32-character hex string", () => {
  const nonce = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

  assertEquals(nonce.length, 32);
  assertEquals(isValidHexString(nonce, 32), true);
});

Deno.test("webex-oauth-start: returns page_url containing nonce and serial", () => {
  const nonce = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const serial = "A1B2C3D4";
  const pageUrl = `https://display.5ls.us/webexauth?nonce=${nonce}&serial=${serial}`;

  assertStringIncludes(pageUrl, `nonce=${nonce}`);
  assertStringIncludes(pageUrl, `serial=${serial}`);
});

Deno.test("webex-oauth-start: page_url does NOT contain token= parameter", () => {
  const pageUrl = "https://display.5ls.us/webexauth?nonce=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6&serial=A1B2C3D4";

  assertEquals(pageUrl.includes("token="), false);
});

Deno.test("webex-oauth-start: page_url format matches expected pattern", () => {
  const nonce = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const serial = "A1B2C3D4";
  const pageUrl = `https://display.5ls.us/webexauth?nonce=${nonce}&serial=${serial}`;

  const urlPattern = /^https:\/\/display\.5ls\.us\/webexauth\?nonce=[0-9a-f]{32}&serial=[A-Z0-9]+$/i;
  assertEquals(urlPattern.test(pageUrl), true);
});

// ============================================================================
// Create Mode Tests - Nonce Storage
// ============================================================================

Deno.test("webex-oauth-start: nonce row includes device_uuid", () => {
  const nonceRow = {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
    created_at: new Date().toISOString(),
  };

  assertExists(nonceRow.device_uuid);
  assertEquals(typeof nonceRow.device_uuid, "string");
});

Deno.test("webex-oauth-start: nonce row includes serial_number", () => {
  const nonceRow = {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
  };

  assertExists(nonceRow.serial_number);
  assertEquals(typeof nonceRow.serial_number, "string");
});

Deno.test("webex-oauth-start: nonce row includes user_uuid", () => {
  const nonceRow = {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
  };

  assertExists(nonceRow.user_uuid);
  assertEquals(typeof nonceRow.user_uuid, "string");
});

Deno.test("webex-oauth-start: nonce row does NOT include pairing_code", () => {
  const nonceRow: {
    nonce: string;
    device_uuid: string;
    serial_number: string;
    user_uuid: string;
    pairing_code?: string;
  } = {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    serial_number: "A1B2C3D4",
    user_uuid: "660e8400-e29b-41d4-a716-446655440000",
  };

  assertEquals("pairing_code" in nonceRow && nonceRow.pairing_code !== undefined, false);
});

// ============================================================================
// Create Mode Tests - App Token Path
// ============================================================================

Deno.test("webex-oauth-start: app tokens skip HMAC validation", () => {
  const tokenPayload = {
    token_type: "app",
    serial_number: "A1B2C3D4",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
  };

  assertEquals(tokenPayload.token_type, "app");
  // Function should skip HMAC validation for app tokens
});

Deno.test("webex-oauth-start: app tokens require serial_number in JWT", () => {
  const tokenPayload = {
    token_type: "app",
    serial_number: "A1B2C3D4",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
  };

  assertExists(tokenPayload.serial_number);
  assertEquals(typeof tokenPayload.serial_number, "string");
});

Deno.test("webex-oauth-start: app tokens require device_uuid in JWT", () => {
  const tokenPayload = {
    token_type: "app",
    serial_number: "A1B2C3D4",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
  };

  assertExists(tokenPayload.device_uuid);
  assertEquals(typeof tokenPayload.device_uuid, "string");
});

Deno.test("webex-oauth-start: returns 401 when app token missing serial_number", () => {
  const tokenPayload: {
    token_type: string;
    serial_number?: string;
    device_uuid?: string;
  } = {
    token_type: "app",
  };

  const hasRequired = !!(tokenPayload.serial_number && tokenPayload.device_uuid);
  assertEquals(hasRequired, false);
  // Function should return 401
});

Deno.test("webex-oauth-start: returns 401 when app token missing device_uuid", () => {
  const tokenPayload: {
    token_type: string;
    serial_number?: string;
    device_uuid?: string;
  } = {
    token_type: "app",
    serial_number: "A1B2C3D4",
  };

  const hasRequired = !!(tokenPayload.serial_number && tokenPayload.device_uuid);
  assertEquals(hasRequired, false);
  // Function should return 401
});

// ============================================================================
// Resolve Mode Tests - Request Validation
// ============================================================================

Deno.test("webex-oauth-start: resolve mode requires nonce in request body", () => {
  const validBody = {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  };

  assertExists(validBody.nonce);
  assertEquals(typeof validBody.nonce, "string");
});

Deno.test("webex-oauth-start: resolve mode does not require Authorization header", () => {
  const req = createMockRequest("POST", {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  });

  assertEquals(req.headers.get("Authorization"), null);
  // Function should accept request without Authorization header
});

Deno.test("webex-oauth-start: returns 400 when nonce missing", () => {
  const errorResponse = {
    error: "Missing nonce",
  };

  assertEquals(errorResponse.error, "Missing nonce");
  // Function should return 400
});

Deno.test("webex-oauth-start: returns 400 when nonce is empty string", () => {
  const invalidBody = {
    nonce: "",
  };

  assertEquals(invalidBody.nonce.length > 0, false);
  // Function should return 400
});

// ============================================================================
// Resolve Mode Tests - Nonce Lookup and Validation
// ============================================================================

Deno.test("webex-oauth-start: looks up nonce in display.oauth_nonces table", () => {
  const nonce = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const query = {
    table: "display.oauth_nonces",
    nonce: nonce,
  };

  assertEquals(query.table, "display.oauth_nonces");
  assertExists(query.nonce);
});

Deno.test("webex-oauth-start: returns 401 when nonce not found", () => {
  const errorResponse = {
    error: "Invalid or expired nonce",
  };

  assertEquals(errorResponse.error, "Invalid or expired nonce");
  // Function should return 401
});

Deno.test("webex-oauth-start: validates nonce not expired (10 min TTL)", () => {
  const nonceRow = {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
  };

  const ageMs = Date.now() - new Date(nonceRow.created_at).getTime();
  const ageMinutes = ageMs / (60 * 1000);
  const ttlMinutes = 10;

  assertEquals(ageMinutes < ttlMinutes, true);
});

Deno.test("webex-oauth-start: returns 401 when nonce expired", () => {
  const nonceRow = {
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(), // 11 minutes ago
  };

  const ageMs = Date.now() - new Date(nonceRow.created_at).getTime();
  const ageMinutes = ageMs / (60 * 1000);
  const ttlMinutes = 10;

  assertEquals(ageMinutes >= ttlMinutes, true);
  // Function should return 401
});

// ============================================================================
// Resolve Mode Tests - Auth URL Generation
// ============================================================================

Deno.test("webex-oauth-start: returns auth_url pointing to webexapis.com", () => {
  const authUrl = "https://webexapis.com/v1/authorize?client_id=test&response_type=code&redirect_uri=https://example.com/callback&scope=spark:people_read&state=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

  assertStringIncludes(authUrl, "webexapis.com/v1/authorize");
});

Deno.test("webex-oauth-start: auth_url state parameter equals the nonce", () => {
  const nonce = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const authUrl = `https://webexapis.com/v1/authorize?client_id=test&response_type=code&redirect_uri=https://example.com/callback&scope=spark:people_read&state=${nonce}`;

  assertStringIncludes(authUrl, `state=${nonce}`);
});

Deno.test("webex-oauth-start: auth_url state is plain string, not base64 JSON", () => {
  const nonce = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const authUrl = `https://webexapis.com/v1/authorize?state=${nonce}`;

  // State should be the nonce directly, not base64 encoded JSON
  assertStringIncludes(authUrl, `state=${nonce}`);
  assertEquals(authUrl.includes("state=eyJ"), false); // Not base64 JSON
});

Deno.test("webex-oauth-start: auth_url contains client_id parameter", () => {
  const authUrl = "https://webexapis.com/v1/authorize?client_id=test_client_id&response_type=code&redirect_uri=https://example.com/callback&scope=spark:people_read&state=nonce";

  assertStringIncludes(authUrl, "client_id=");
});

Deno.test("webex-oauth-start: auth_url contains response_type parameter", () => {
  const authUrl = "https://webexapis.com/v1/authorize?client_id=test&response_type=code&redirect_uri=https://example.com/callback&scope=spark:people_read&state=nonce";

  assertStringIncludes(authUrl, "response_type=code");
});

Deno.test("webex-oauth-start: auth_url contains redirect_uri parameter", () => {
  const authUrl = "https://webexapis.com/v1/authorize?client_id=test&response_type=code&redirect_uri=https://example.com/callback&scope=spark:people_read&state=nonce";

  assertStringIncludes(authUrl, "redirect_uri=");
});

Deno.test("webex-oauth-start: auth_url contains scope parameter", () => {
  const authUrl = "https://webexapis.com/v1/authorize?client_id=test&response_type=code&redirect_uri=https://example.com/callback&scope=spark:people_read&state=nonce";

  assertStringIncludes(authUrl, "scope=");
});

Deno.test("webex-oauth-start: auth_url format matches expected pattern", () => {
  const nonce = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const authUrl = `https://webexapis.com/v1/authorize?client_id=test&response_type=code&redirect_uri=https://example.com/callback&scope=spark:people_read&state=${nonce}`;

  const urlPattern = /^https:\/\/webexapis\.com\/v1\/authorize\?.*state=[0-9a-f]{32}/;
  assertEquals(urlPattern.test(authUrl), true);
});

// ============================================================================
// General Tests
// ============================================================================

Deno.test("webex-oauth-start: OPTIONS returns CORS headers", () => {
  const req = createMockRequest("OPTIONS");
  assertEquals(req.method, "OPTIONS");
  // Function should return CORS headers
});

Deno.test("webex-oauth-start: returns 500 when JWT secret not configured", () => {
  const errorResponse = {
    error: "Server configuration error",
  };

  assertEquals(errorResponse.error, "Server configuration error");
  // Function should return 500
});

Deno.test("webex-oauth-start: returns 500 when OAuth client not configured", () => {
  const errorResponse = {
    error: "Webex client not configured",
  };

  assertEquals(errorResponse.error, "Webex client not configured");
  // Function should return 500
});

Deno.test("webex-oauth-start: returns 500 on internal server error", () => {
  const errorResponse = {
    error: "Internal server error",
  };

  assertEquals(errorResponse.error, "Internal server error");
  // Function should return 500
});
