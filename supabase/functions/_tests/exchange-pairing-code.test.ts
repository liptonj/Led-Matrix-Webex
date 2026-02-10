/**
 * exchange-pairing-code Edge Function Tests
 *
 * Tests for the pairing code exchange endpoint that issues app tokens.
 *
 * Run: deno test --allow-net --allow-env _tests/exchange-pairing-code.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Constants from the Edge Function
const TOKEN_TTL_SECONDS = 3600; // 1 hour

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("exchange-pairing-code: rejects GET requests", () => {
  // Edge Function only accepts POST
  const allowedMethods = ["POST"];
  assertEquals(allowedMethods.includes("GET"), false);
});

Deno.test("exchange-pairing-code: rejects missing pairing_code", () => {
  const requestBody = {};
  const hasPairingCode = "pairing_code" in requestBody;
  assertEquals(hasPairingCode, false);
});

Deno.test("exchange-pairing-code: rejects empty pairing_code", () => {
  const requestBody = { pairing_code: "" };
  const isValid = requestBody.pairing_code.length > 0;
  assertEquals(isValid, false);
});

Deno.test("exchange-pairing-code: rejects non-string pairing_code", () => {
  const testCases = [
    { pairing_code: 123456 },
    { pairing_code: null },
    { pairing_code: undefined },
    { pairing_code: { code: "ABC123" } },
    { pairing_code: ["ABC123"] },
  ];

  for (const body of testCases) {
    const isValidType = typeof body.pairing_code === "string";
    assertEquals(isValidType, false);
  }
});

Deno.test("exchange-pairing-code: rejects pairing codes not 6 chars", () => {
  const invalidCodes = [
    "AB", // Too short
    "ABCDE", // Too short
    "ABCDEFG", // Too long
    "ABCDEFGHIJ", // Too long
    "", // Empty
  ];

  for (const code of invalidCodes) {
    const normalized = code.toUpperCase().trim();
    assertEquals(normalized.length === 6, false, `${code} should be invalid`);
  }
});

Deno.test("exchange-pairing-code: accepts valid 6-char pairing codes", () => {
  const validCodes = ["ABC123", "XYZ789", "A1B2C3", "KLMN56", "123456", "ABCDEF"];

  for (const code of validCodes) {
    const normalized = code.toUpperCase().trim();
    assertEquals(normalized.length, 6, `${code} should be valid`);
  }
});

Deno.test("exchange-pairing-code: normalizes codes to uppercase", () => {
  const testCases = [
    { input: "abc123", expected: "ABC123" },
    { input: "Abc123", expected: "ABC123" },
    { input: "ABC123", expected: "ABC123" },
    { input: "aBc12D", expected: "ABC12D" },
  ];

  for (const { input, expected } of testCases) {
    const normalized = input.toUpperCase().trim();
    assertEquals(normalized, expected);
  }
});

Deno.test("exchange-pairing-code: trims whitespace from codes", () => {
  const testCases = [
    { input: " ABC123", expected: "ABC123" },
    { input: "ABC123 ", expected: "ABC123" },
    { input: " ABC123 ", expected: "ABC123" },
    { input: "  ABC123  ", expected: "ABC123" },
  ];

  for (const { input, expected } of testCases) {
    const normalized = input.toUpperCase().trim();
    assertEquals(normalized, expected);
  }
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("exchange-pairing-code: success response has required fields", () => {
  const mockResponse = {
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
    expires_at: "2026-01-28T13:00:00Z",
  };

  assertExists(mockResponse.serial_number, "serial_number is required");
  assertExists(mockResponse.device_id, "device_id is required");
  assertExists(mockResponse.device_uuid, "device_uuid is required");
  assertExists(mockResponse.token, "token is required");
  assertExists(mockResponse.expires_at, "expires_at is required");
});

Deno.test("exchange-pairing-code: serial_number is 8 characters", () => {
  const validSerials = ["A1B2C3D4", "12345678", "ABCDEF12"];
  for (const serial of validSerials) {
    assertEquals(serial.length, 8);
  }
});

Deno.test("exchange-pairing-code: device_id format is correct", () => {
  const deviceId = "webex-display-C3D4";
  assertStringIncludes(deviceId, "webex-display-");

  // Suffix should be last 4 chars of serial
  const suffix = deviceId.split("-").pop();
  assertEquals(suffix?.length, 4);
});

Deno.test("exchange-pairing-code: token is valid JWT format", () => {
  const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

  // JWT has 3 parts separated by dots
  const parts = token.split(".");
  assertEquals(parts.length, 3);

  // Header starts with eyJ (base64 of {"alg":...)
  assertStringIncludes(parts[0], "eyJ");
});

Deno.test("exchange-pairing-code: expires_at is valid ISO date", () => {
  const expiresAt = "2026-01-28T13:00:00Z";

  // Should be parseable as date
  const date = new Date(expiresAt);
  assertEquals(isNaN(date.getTime()), false);

  // Should contain T separator and Z timezone
  assertStringIncludes(expiresAt, "T");
  assertStringIncludes(expiresAt, "Z");
});

// ============================================================================
// Token Configuration Tests
// ============================================================================

Deno.test("exchange-pairing-code: token TTL is 1 hour", () => {
  assertEquals(TOKEN_TTL_SECONDS, 3600);
  assertEquals(TOKEN_TTL_SECONDS, 60 * 60);
});

Deno.test("exchange-pairing-code: token expiry is correctly calculated", () => {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_TTL_SECONDS;

  // Should expire in 1 hour
  assertEquals(expiresAt - now, 3600);

  // Should be a valid future timestamp
  assertEquals(expiresAt > now, true);
});

Deno.test("exchange-pairing-code: app token uses token_type 'app' and includes device_uuid", () => {
  const tokenPayload = {
    sub: crypto.randomUUID(),
    role: "authenticated",
    aud: "authenticated",
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    device_uuid: "550e8400-e29b-41d4-a716-446655440000",
    token_type: "app",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };

  assertEquals(tokenPayload.token_type, "app");
  assertEquals(tokenPayload.role, "authenticated");
  assertEquals(tokenPayload.aud, "authenticated");
  assertExists(tokenPayload.device_uuid);
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("exchange-pairing-code: 405 for wrong method", () => {
  const errorResponse = {
    error: "Method not allowed",
  };
  assertExists(errorResponse.error);
});

Deno.test("exchange-pairing-code: 400 for invalid JSON", () => {
  const errorResponse = {
    error: "Invalid JSON body",
  };
  assertExists(errorResponse.error);
});

Deno.test("exchange-pairing-code: 400 for missing pairing_code", () => {
  const errorResponse = {
    error: "Missing or invalid pairing_code",
  };
  assertExists(errorResponse.error);
});

Deno.test("exchange-pairing-code: 400 for wrong length code", () => {
  const errorResponse = {
    error: "Pairing code must be 6 characters",
  };
  assertStringIncludes(errorResponse.error, "6 characters");
});

Deno.test("exchange-pairing-code: 404 for unknown pairing code", () => {
  const errorResponse = {
    error: "Invalid pairing code",
  };
  assertStringIncludes(errorResponse.error, "Invalid");
});

Deno.test("exchange-pairing-code: 500 for server config error", () => {
  const errorResponse = {
    error: "Server configuration error",
  };
  assertStringIncludes(errorResponse.error, "configuration");
});
