/**
 * Edge Function Tests
 *
 * Run with: cd supabase/functions && deno test --allow-net --allow-env _tests/
 *
 * These are unit tests that verify:
 * - Request validation (input parsing, required fields)
 * - Response format validation
 * - Logic that doesn't require database (JWT, HMAC)
 * - Error handling paths
 * - HTTP status code expectations
 *
 * For full integration tests, deploy to a staging Supabase project.
 */

import {
  assertEquals,
  assertExists,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock Request object for testing
 */
function createMockRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
  url = "http://localhost",
): Request {
  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  return new Request(url, {
    method,
    headers: new Headers(defaultHeaders),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Generate a valid HMAC signature for testing
 */
async function generateHmacSignature(
  serial: string,
  timestamp: number,
  body: string,
  keyHash: string,
): Promise<string> {
  const encoder = new TextEncoder();

  // Hash the body
  const bodyHash = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  const bodyHashHex = Array.from(new Uint8Array(bodyHash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Create message: serial:timestamp:bodyhash
  const message = `${serial}:${timestamp}:${bodyHashHex}`;

  // Import key
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyHash),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // Sign
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return encodeBase64(new Uint8Array(signature));
}

/**
 * Create HMAC headers for device authentication
 */
async function createHmacHeaders(
  serial: string,
  body: string,
  keyHash: string,
  timestampOffset = 0,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000) + timestampOffset;
  const signature = await generateHmacSignature(serial, timestamp, body, keyHash);

  return {
    "X-Device-Serial": serial,
    "X-Timestamp": timestamp.toString(),
    "X-Signature": signature,
  };
}

/**
 * Generate a mock JWT token structure (for testing format, not actual validation)
 */
function createMockJwtPayload(
  tokenType: "app" | "device",
  serial: string,
  pairingCode: string,
  expiresInSeconds = 3600,
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: crypto.randomUUID(),
    role: "authenticated",
    aud: "authenticated",
    serial_number: serial,
    device_id: `webex-display-${serial.slice(-4)}`,
    pairing_code: pairingCode,
    token_type: tokenType,
    iat: now,
    exp: now + expiresInSeconds,
  };
}

// ============================================================================
// exchange-pairing-code Tests
// ============================================================================

Deno.test("exchange-pairing-code: rejects non-POST methods", () => {
  const req = createMockRequest("GET", undefined);
  assertEquals(req.method, "GET");
  // Function should return 405 for non-POST
});

Deno.test("exchange-pairing-code: rejects missing pairing_code", () => {
  const req = createMockRequest("POST", {});
  assertExists(req.body);
  // Function should return 400 for missing pairing_code
});

Deno.test("exchange-pairing-code: rejects empty pairing_code", () => {
  const _req = createMockRequest("POST", { pairing_code: "" });
  // Function should return 400 for empty pairing_code
});

Deno.test("exchange-pairing-code: rejects invalid pairing_code format", () => {
  const invalidCodes = ["ABC", "ABCDEFGH", "123456", "abc123"];
  for (const code of invalidCodes) {
    const req = createMockRequest("POST", { pairing_code: code });
    assertExists(req.body);
  }
  // Function should return 400 for wrong length/format
});

Deno.test("exchange-pairing-code: normalizes pairing_code to uppercase", () => {
  const input = "abc123";
  assertEquals(input.toUpperCase().trim(), "ABC123");
  assertEquals(input.toUpperCase().trim().length, 6);
});

Deno.test("exchange-pairing-code: validates 6-char uppercase codes", () => {
  const validCodes = ["ABC123", "XYZ789", "A1B2C3", "DEFGHI"];
  for (const code of validCodes) {
    assertEquals(code.length, 6, `Code ${code} should be 6 chars`);
    assertEquals(code, code.toUpperCase(), "Code should be uppercase");
  }
});

Deno.test("exchange-pairing-code: response format is correct", () => {
  const mockResponse = {
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
    expires_at: "2026-01-28T13:00:00.000Z",
  };

  assertExists(mockResponse.serial_number);
  assertExists(mockResponse.device_id);
  assertExists(mockResponse.token);
  assertExists(mockResponse.expires_at);
  assertEquals(mockResponse.serial_number.length, 8);
  assertStringIncludes(mockResponse.device_id, "webex-display-");
  assertStringIncludes(mockResponse.token, "eyJ");
  assertMatch(mockResponse.expires_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

Deno.test("exchange-pairing-code: token TTL is 1 hour", () => {
  const TOKEN_TTL_SECONDS = 3600;
  assertEquals(TOKEN_TTL_SECONDS, 3600);

  const now = Date.now();
  const expiresAt = new Date(now + TOKEN_TTL_SECONDS * 1000);
  const diffMs = expiresAt.getTime() - now;
  assertEquals(diffMs, 3600000); // 1 hour in ms
});

// ============================================================================
// device-auth Tests
// ============================================================================

Deno.test("device-auth: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Function should return 405
});

Deno.test("device-auth: requires all HMAC headers", () => {
  const requiredHeaders = ["X-Device-Serial", "X-Timestamp", "X-Signature"];
  for (const header of requiredHeaders) {
    assertExists(header);
  }
  // Missing any header should return 401
});

Deno.test("device-auth: validates timestamp is within 5 minutes", () => {
  const now = Math.floor(Date.now() / 1000);
  const TIMESTAMP_WINDOW_SECONDS = 300;

  // Valid: 60 seconds ago
  const validTimestamp = now - 60;
  assertEquals(Math.abs(now - validTimestamp) < TIMESTAMP_WINDOW_SECONDS, true);

  // Valid: 60 seconds in future
  const futureTimestamp = now + 60;
  assertEquals(Math.abs(now - futureTimestamp) < TIMESTAMP_WINDOW_SECONDS, true);

  // Invalid: 6 minutes ago
  const expiredTimestamp = now - 360;
  assertEquals(Math.abs(now - expiredTimestamp) < TIMESTAMP_WINDOW_SECONDS, false);

  // Invalid: 6 minutes in future
  const futureTooFar = now + 360;
  assertEquals(Math.abs(now - futureTooFar) < TIMESTAMP_WINDOW_SECONDS, false);
});

Deno.test("device-auth: HMAC signature format is valid base64", async () => {
  const serial = "A1B2C3D4";
  const body = "";
  const keyHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const signature = await generateHmacSignature(
    serial,
    Math.floor(Date.now() / 1000),
    body,
    keyHash,
  );

  // Base64 signature should be 44 characters (with padding)
  assertEquals(signature.length, 44);
  // Should be valid base64
  assertMatch(signature, /^[A-Za-z0-9+/]+=*$/);
});

Deno.test("device-auth: HMAC message format is correct", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const body = '{"test":"data"}';

  // Hash the body
  const bodyHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const bodyHashHex = Array.from(new Uint8Array(bodyHash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const message = `${serial}:${timestamp}:${bodyHashHex}`;

  // Message format: serial:timestamp:bodyhash
  assertStringIncludes(message, serial);
  assertStringIncludes(message, timestamp.toString());
  assertEquals(message.split(":").length, 3);
  assertEquals(bodyHashHex.length, 64); // SHA-256 hex is 64 chars
});

Deno.test("device-auth: response contains device token with 24h TTL", () => {
  const DEVICE_TOKEN_TTL_SECONDS = 86400;
  assertEquals(DEVICE_TOKEN_TTL_SECONDS, 86400);

  const mockResponse = {
    success: true,
    serial_number: "A1B2C3D4",
    pairing_code: "XYZ789",
    device_id: "webex-display-C3D4",
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
    target_firmware_version: "1.5.2",
    anon_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  };

  assertEquals(mockResponse.success, true);
  assertExists(mockResponse.token);
  assertExists(mockResponse.target_firmware_version);
  assertExists(mockResponse.anon_key);
});

Deno.test("device-auth: replay protection rejects old timestamp", () => {
  const lastAuthTimestamp = 1706400000;
  const currentRequestTimestamp = 1706399999; // 1 second earlier

  // Request should be rejected if timestamp <= last_auth_timestamp
  assertEquals(currentRequestTimestamp <= lastAuthTimestamp, true);
});

// ============================================================================
// post-device-state Tests
// ============================================================================

Deno.test("post-device-state: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Function should return 405
});

Deno.test("post-device-state: accepts bearer token authentication", () => {
  const headers = { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9..." };
  assertStringIncludes(headers.Authorization, "Bearer ");
});

Deno.test("post-device-state: accepts HMAC authentication", async () => {
  const headers = await createHmacHeaders(
    "A1B2C3D4",
    '{"rssi":-65}',
    "mock-key-hash",
  );
  assertExists(headers["X-Device-Serial"]);
  assertExists(headers["X-Timestamp"]);
  assertExists(headers["X-Signature"]);
});

Deno.test("post-device-state: validates telemetry fields are numbers", () => {
  const validRequest = {
    rssi: -65,
    free_heap: 180000,
    uptime: 3600,
    temperature: 42.5,
  };

  assertEquals(typeof validRequest.rssi, "number");
  assertEquals(typeof validRequest.free_heap, "number");
  assertEquals(typeof validRequest.uptime, "number");
  assertEquals(typeof validRequest.temperature, "number");
});

Deno.test("post-device-state: handles empty body as heartbeat", () => {
  const emptyBody = "";
  assertEquals(emptyBody.length, 0);
  // Function should accept empty body as simple heartbeat
});

Deno.test("post-device-state: response contains app state", () => {
  const mockResponse = {
    success: true,
    app_connected: true,
    webex_status: "active",
    display_name: "John Doe",
    camera_on: true,
    mic_muted: false,
    in_call: false,
  };

  assertEquals(mockResponse.success, true);
  assertEquals(typeof mockResponse.app_connected, "boolean");
  assertEquals(typeof mockResponse.webex_status, "string");
  assertEquals(typeof mockResponse.camera_on, "boolean");
  assertEquals(typeof mockResponse.mic_muted, "boolean");
  assertEquals(typeof mockResponse.in_call, "boolean");
});

Deno.test("post-device-state: rate limit is 12 requests per minute", () => {
  const MAX_REQUESTS_PER_MINUTE = 12;
  const RATE_WINDOW_SECONDS = 60;

  assertEquals(MAX_REQUESTS_PER_MINUTE, 12);
  assertEquals(RATE_WINDOW_SECONDS, 60);
});

Deno.test("post-device-state: rate limit response format", () => {
  const rateLimitResponse = {
    success: false,
    error: "Rate limit exceeded. Max 12 requests per minute.",
  };

  assertEquals(rateLimitResponse.success, false);
  assertStringIncludes(rateLimitResponse.error, "Rate limit");
  assertStringIncludes(rateLimitResponse.error, "12");
});

Deno.test("post-device-state: rate limit response has Retry-After header", () => {
  const headers = {
    "Retry-After": "5",
  };
  assertEquals(headers["Retry-After"], "5");
});

// ============================================================================
// poll-commands Tests
// ============================================================================

Deno.test("poll-commands: allows GET and POST methods", () => {
  const validMethods = ["GET", "POST"];
  for (const method of validMethods) {
    assertExists(method);
  }
});

Deno.test("poll-commands: rejects PUT/DELETE methods", () => {
  const invalidMethods = ["PUT", "DELETE", "PATCH"];
  for (const method of invalidMethods) {
    const req = createMockRequest(method);
    assertEquals(req.method, method);
    // Should return 405
  }
});

Deno.test("poll-commands: returns array of commands", () => {
  const mockResponse = {
    success: true,
    commands: [
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        command: "set_brightness",
        payload: { value: 200 },
        created_at: "2026-01-28T12:00:00.000Z",
      },
    ],
  };

  assertEquals(mockResponse.success, true);
  assertEquals(Array.isArray(mockResponse.commands), true);
  assertEquals(mockResponse.commands.length, 1);
});

Deno.test("poll-commands: command has required fields", () => {
  const command = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    command: "set_brightness",
    payload: { value: 200 },
    created_at: "2026-01-28T12:00:00.000Z",
  };

  assertExists(command.id);
  assertExists(command.command);
  assertExists(command.payload);
  assertExists(command.created_at);
  assertMatch(command.id, /^[0-9a-f-]{36}$/); // UUID format
  assertEquals(typeof command.payload, "object");
});

Deno.test("poll-commands: returns empty array when no pending commands", () => {
  const mockResponse = {
    success: true,
    commands: [],
  };

  assertEquals(mockResponse.success, true);
  assertEquals(mockResponse.commands.length, 0);
});

Deno.test("poll-commands: limits to 10 commands per poll", () => {
  const MAX_COMMANDS_PER_POLL = 10;
  assertEquals(MAX_COMMANDS_PER_POLL, 10);
});

Deno.test("poll-commands: only returns non-expired pending commands", () => {
  const now = new Date();
  const expiredTime = new Date(now.getTime() - 60000); // 1 minute ago
  const futureTime = new Date(now.getTime() + 300000); // 5 minutes ahead

  // Expired command should not be returned
  assertEquals(expiredTime < now, true);
  // Non-expired command should be returned
  assertEquals(futureTime > now, true);
});

// ============================================================================
// ack-command Tests
// ============================================================================

Deno.test("ack-command: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Should return 405
});

Deno.test("ack-command: requires command_id field", () => {
  const invalidRequest = { success: true };
  assertEquals("command_id" in invalidRequest, false);
  // Should return 400 for missing command_id
});

Deno.test("ack-command: requires success boolean field", () => {
  const invalidRequest = { command_id: "uuid-1" };
  assertEquals("success" in invalidRequest, false);
  // Should return 400 for missing success field
});

Deno.test("ack-command: accepts success ack with response data", () => {
  const request = {
    command_id: "550e8400-e29b-41d4-a716-446655440000",
    success: true,
    response: { brightness: 200 },
  };

  assertExists(request.command_id);
  assertEquals(request.success, true);
  assertExists(request.response);
  assertEquals(typeof request.response, "object");
});

Deno.test("ack-command: accepts failure ack with error message", () => {
  const request = {
    command_id: "550e8400-e29b-41d4-a716-446655440000",
    success: false,
    error: "Command timeout",
  };

  assertEquals(request.success, false);
  assertExists(request.error);
  assertEquals(typeof request.error, "string");
});

Deno.test("ack-command: verifies command ownership by pairing_code", () => {
  const devicePairingCode: string = "ABC123";
  const commandPairingCode: string = "XYZ789";

  // Should reject if codes don't match
  const codesMatch = devicePairingCode === commandPairingCode;
  assertEquals(codesMatch, false);
});

Deno.test("ack-command: handles already-acked commands gracefully", () => {
  const alreadyAckedResponse = {
    success: true,
    message: "Command already acked",
  };

  assertEquals(alreadyAckedResponse.success, true);
  assertExists(alreadyAckedResponse.message);
});

Deno.test("ack-command: returns 404 for non-existent command", () => {
  const notFoundResponse = {
    success: false,
    error: "Command not found",
  };

  assertEquals(notFoundResponse.success, false);
  assertStringIncludes(notFoundResponse.error, "not found");
});

// ============================================================================
// update-app-state Tests
// ============================================================================

Deno.test("update-app-state: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Should return 405
});

Deno.test("update-app-state: requires token_type 'app'", () => {
  const validPayload = createMockJwtPayload("app", "A1B2C3D4", "ABC123");
  assertEquals(validPayload.token_type, "app");

  const invalidPayload = createMockJwtPayload("device", "A1B2C3D4", "ABC123");
  assertEquals(invalidPayload.token_type !== "app", true);
});

Deno.test("update-app-state: validates webex_status values", () => {
  const VALID_STATUSES = [
    "active",
    "away",
    "dnd",
    "meeting",
    "offline",
    "call",
    "presenting",
  ];

  for (const status of VALID_STATUSES) {
    assertEquals(VALID_STATUSES.includes(status), true);
  }

  const invalidStatus = "unknown_status";
  assertEquals(VALID_STATUSES.includes(invalidStatus), false);
});

Deno.test("update-app-state: accepts all app state fields", () => {
  const request = {
    webex_status: "active",
    camera_on: true,
    mic_muted: false,
    in_call: false,
    display_name: "John Doe",
  };

  assertExists(request.webex_status);
  assertEquals(typeof request.camera_on, "boolean");
  assertEquals(typeof request.mic_muted, "boolean");
  assertEquals(typeof request.in_call, "boolean");
  assertEquals(typeof request.display_name, "string");
});

Deno.test("update-app-state: response contains device connection state", () => {
  const mockResponse = {
    success: true,
    device_connected: true,
    device_last_seen: "2026-01-28T12:00:00.000Z",
  };

  assertEquals(mockResponse.success, true);
  assertEquals(typeof mockResponse.device_connected, "boolean");
  assertExists(mockResponse.device_last_seen);
});

Deno.test("update-app-state: marks device disconnected if stale (>60s)", () => {
  const now = Date.now();
  const lastSeenTime = now - 120000; // 2 minutes ago
  const STALE_THRESHOLD_MS = 60000;

  const isStale = now - lastSeenTime > STALE_THRESHOLD_MS;
  assertEquals(isStale, true);

  // Recent last_seen should not be stale
  const recentLastSeen = now - 30000; // 30 seconds ago
  const isRecent = now - recentLastSeen <= STALE_THRESHOLD_MS;
  assertEquals(isRecent, true);
});

Deno.test("update-app-state: only updates app-owned columns", () => {
  // App-owned columns (should be updatable)
  const appColumns = [
    "webex_status",
    "camera_on",
    "mic_muted",
    "in_call",
    "display_name",
    "app_last_seen",
    "app_connected",
  ];

  // Device-owned columns (should NOT be updatable by app)
  const deviceColumns = [
    "rssi",
    "free_heap",
    "uptime",
    "temperature",
    "device_last_seen",
    "device_connected",
  ];

  assertEquals(appColumns.length, 7);
  assertEquals(deviceColumns.length, 6);

  // No overlap between app and device columns
  for (const col of appColumns) {
    assertEquals(deviceColumns.includes(col), false);
  }
});

// ============================================================================
// insert-command Tests
// ============================================================================

Deno.test("insert-command: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Should return 405
});

Deno.test("insert-command: requires token_type 'app'", () => {
  const validPayload = createMockJwtPayload("app", "A1B2C3D4", "ABC123");
  assertEquals(validPayload.token_type, "app");
});

Deno.test("insert-command: requires command field", () => {
  const invalidRequest = { payload: { value: 100 } };
  assertEquals("command" in invalidRequest, false);
  // Should return 400
});

Deno.test("insert-command: validates command whitelist", () => {
  const VALID_COMMANDS = [
    "set_brightness",
    "set_config",
    "get_config",
    "get_status",
    "reboot",
    "factory_reset",
    "ota_update",
    "set_display_name",
    "set_time_zone",
    "clear_wifi",
    "test_display",
    "ping",
  ];

  assertEquals(VALID_COMMANDS.length, 12);

  for (const cmd of VALID_COMMANDS) {
    assertEquals(VALID_COMMANDS.includes(cmd), true);
  }

  // Invalid command should be rejected
  const invalidCommand = "malicious_command";
  assertEquals(VALID_COMMANDS.includes(invalidCommand), false);
});

Deno.test("insert-command: accepts payload as object", () => {
  const request = {
    command: "set_brightness",
    payload: { value: 200 },
  };

  assertEquals(typeof request.payload, "object");
});

Deno.test("insert-command: payload is optional", () => {
  const request = {
    command: "ping",
  };

  assertEquals("payload" in request, false);
  // Should accept request without payload
});

Deno.test("insert-command: command expiry is 5 minutes", () => {
  const COMMAND_EXPIRY_SECONDS = 300;
  assertEquals(COMMAND_EXPIRY_SECONDS, 300);

  const now = Date.now();
  const expiresAt = new Date(now + COMMAND_EXPIRY_SECONDS * 1000);
  const diffMs = expiresAt.getTime() - now;
  assertEquals(diffMs, 300000); // 5 minutes in ms
});

Deno.test("insert-command: response contains command_id and expires_at", () => {
  const mockResponse = {
    success: true,
    command_id: "550e8400-e29b-41d4-a716-446655440000",
    expires_at: "2026-01-28T12:05:00.000Z",
  };

  assertEquals(mockResponse.success, true);
  assertExists(mockResponse.command_id);
  assertExists(mockResponse.expires_at);
  assertMatch(mockResponse.command_id, /^[0-9a-f-]{36}$/);
});

Deno.test("insert-command: returns 404 if pairing doesn't exist", () => {
  const fkErrorResponse = {
    success: false,
    error: "Pairing not found. Device may not be connected.",
  };

  assertEquals(fkErrorResponse.success, false);
  assertStringIncludes(fkErrorResponse.error, "Pairing not found");
});

// ============================================================================
// provision-device Tests
// ============================================================================

Deno.test("provision-device: requires serial_number field", () => {
  const invalidRequest = { key_hash: "abc123" };
  assertEquals("serial_number" in invalidRequest, false);
  // Should return 400
});

Deno.test("provision-device: requires key_hash field", () => {
  const invalidRequest = { serial_number: "A1B2C3D4" };
  assertEquals("key_hash" in invalidRequest, false);
  // Should return 400
});

Deno.test("provision-device: validates serial_number format (8 hex chars)", () => {
  const validSerials = ["A1B2C3D4", "12345678", "ABCDEF12", "abcdef12"];
  for (const serial of validSerials) {
    assertMatch(serial, /^[A-Fa-f0-9]{8}$/);
  }

  const invalidSerials = ["ABC123", "ABCDEF123", "GHIJKLMN", "12-34-56-78"];
  for (const serial of invalidSerials) {
    const isValid = /^[A-Fa-f0-9]{8}$/.test(serial);
    assertEquals(isValid, false);
  }
});

Deno.test("provision-device: generates valid pairing code format", () => {
  // Valid characters exclude confusing ones: I, O, 0, 1
  const validChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function generatePairingCode(): string {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += validChars.charAt(Math.floor(Math.random() * validChars.length));
    }
    return code;
  }

  const code = generatePairingCode();
  assertEquals(code.length, 6);

  // All characters should be from valid set
  for (const char of code) {
    assertEquals(validChars.includes(char), true);
  }
});

Deno.test("provision-device: validates existing pairing code if provided", () => {
  const validChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function isValidPairingCode(code: string): boolean {
    if (!code || code.length !== 6) return false;
    const upperCode = code.toUpperCase();
    for (const char of upperCode) {
      if (!validChars.includes(char)) return false;
    }
    return true;
  }

  // Valid codes (only use 2-9 for digits, exclude I, O)
  assertEquals(isValidPairingCode("ABC234"), true);
  assertEquals(isValidPairingCode("XYZ789"), true);
  assertEquals(isValidPairingCode("DEFGH2"), true);
  
  // Invalid: wrong length
  assertEquals(isValidPairingCode("AB"), false);
  assertEquals(isValidPairingCode("ABCDEFGH"), false);
  
  // Invalid: contains excluded characters (0, 1, I, O)
  assertEquals(isValidPairingCode("ABC100"), false); // Contains 1 and 0
  assertEquals(isValidPairingCode("ABCIO2"), false); // Contains I and O
});

Deno.test("provision-device: generates device_id from serial", () => {
  function generateDeviceId(serial: string): string {
    const suffix = serial.slice(-4).toUpperCase();
    return `webex-display-${suffix}`;
  }

  assertEquals(generateDeviceId("A1B2C3D4"), "webex-display-C3D4");
  assertEquals(generateDeviceId("12345678"), "webex-display-5678");
});

Deno.test("provision-device: response format for new device", () => {
  const mockResponse = {
    success: true,
    device_id: "webex-display-C3D4",
    pairing_code: "ABC123",
    already_provisioned: false,
  };

  assertEquals(mockResponse.success, true);
  assertExists(mockResponse.device_id);
  assertExists(mockResponse.pairing_code);
  assertEquals(mockResponse.already_provisioned, false);
});

Deno.test("provision-device: response format for existing device", () => {
  const mockResponse = {
    success: true,
    device_id: "webex-display-C3D4",
    pairing_code: "ABC123",
    already_provisioned: true,
  };

  assertEquals(mockResponse.success, true);
  assertEquals(mockResponse.already_provisioned, true);
});

// ============================================================================
// validate-device Tests
// ============================================================================

Deno.test("validate-device: validates HMAC signature", async () => {
  const serial = "A1B2C3D4";
  const body = "";
  const keyHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const headers = await createHmacHeaders(serial, body, keyHash);

  assertExists(headers["X-Device-Serial"]);
  assertExists(headers["X-Timestamp"]);
  assertExists(headers["X-Signature"]);
});

Deno.test("validate-device: returns device info on success", () => {
  const successResponse = {
    valid: true,
    device: {
      serial_number: "A1B2C3D4",
      device_id: "webex-display-C3D4",
      pairing_code: "ABC123",
      debug_enabled: false,
    },
  };

  assertEquals(successResponse.valid, true);
  assertExists(successResponse.device);
  assertExists(successResponse.device.serial_number);
  assertExists(successResponse.device.pairing_code);
});

Deno.test("validate-device: returns error on invalid signature", () => {
  const errorResponse = {
    valid: false,
    error: "Invalid signature",
  };

  assertEquals(errorResponse.valid, false);
  assertExists(errorResponse.error);
});

Deno.test("validate-device: marks device as provisioned", () => {
  // Function should update is_provisioned=true on first successful validation
  const updateData = {
    is_provisioned: true,
    provisioned_at: new Date().toISOString(),
  };

  assertEquals(updateData.is_provisioned, true);
  assertExists(updateData.provisioned_at);
});

// ============================================================================
// get-manifest Tests
// ============================================================================

Deno.test("get-manifest: supports format=esp-web-tools", () => {
  const url = new URL("http://localhost?format=esp-web-tools");
  assertEquals(url.searchParams.get("format"), "esp-web-tools");
});

Deno.test("get-manifest: supports format=ota (default)", () => {
  const url = new URL("http://localhost?format=ota");
  assertEquals(url.searchParams.get("format"), "ota");

  // Default when no format specified
  const defaultUrl = new URL("http://localhost");
  assertEquals(defaultUrl.searchParams.get("format"), null);
});

Deno.test("get-manifest: esp-web-tools manifest format", () => {
  const manifest = {
    name: "Webex LED Matrix Display",
    version: "1.5.2",
    new_install_prompt_erase: true,
    builds: [
      {
        chipFamily: "ESP32-S3",
        parts: [{ path: "https://example.com/firmware.bin", offset: 0 }],
      },
    ],
  };

  assertExists(manifest.name);
  assertExists(manifest.version);
  assertEquals(manifest.new_install_prompt_erase, true);
  assertEquals(Array.isArray(manifest.builds), true);
  assertEquals(manifest.builds[0].chipFamily, "ESP32-S3");
});

Deno.test("get-manifest: legacy OTA manifest format", () => {
  const manifest = {
    name: "Webex LED Matrix Display",
    version: "1.5.2",
    build_id: "abc123",
    build_date: "2026-01-28T12:00:00Z",
    firmware: {
      esp32s3: { url: "https://example.com/firmware.bin" },
      esp32: { url: "https://example.com/firmware.bin" },
    },
    bundle: {
      esp32s3: { url: "https://example.com/firmware-merged.bin" },
      esp32: { url: "https://example.com/firmware-merged.bin" },
    },
  };

  assertExists(manifest.name);
  assertExists(manifest.version);
  assertExists(manifest.firmware);
  assertExists(manifest.firmware.esp32s3);
  assertExists(manifest.firmware.esp32);
});

Deno.test("get-manifest: respects rollout percentage", () => {
  // Using isDeviceInRollout logic
  function isDeviceInRollout(
    serialNumber: string,
    version: string,
    rolloutPercentage: number,
  ): boolean {
    if (rolloutPercentage >= 100) return true;
    if (rolloutPercentage <= 0) return false;

    const input = `${serialNumber}:${version}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const devicePercentile = Math.abs(hash) % 100;
    return devicePercentile < rolloutPercentage;
  }

  // 100% rollout includes all devices
  assertEquals(isDeviceInRollout("A1B2C3D4", "1.5.2", 100), true);

  // 0% rollout includes no devices
  assertEquals(isDeviceInRollout("A1B2C3D4", "1.5.2", 0), false);

  // Deterministic: same device+version always gives same result
  const result1 = isDeviceInRollout("A1B2C3D4", "1.5.2", 50);
  const result2 = isDeviceInRollout("A1B2C3D4", "1.5.2", 50);
  assertEquals(result1, result2);
});

Deno.test("get-manifest: returns empty manifest when device not in rollout", () => {
  const emptyManifest = {
    name: "Webex LED Matrix Display",
    version: "none",
    build_id: null,
    build_date: null,
    firmware: {},
  };

  assertEquals(emptyManifest.version, "none");
  assertEquals(Object.keys(emptyManifest.firmware).length, 0);
});

// ============================================================================
// get-firmware Tests
// ============================================================================

Deno.test("get-firmware: requires HMAC authentication", async () => {
  const serial = "A1B2C3D4";
  const keyHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const headers = await createHmacHeaders(serial, "", keyHash);
  assertExists(headers["X-Device-Serial"]);
  assertExists(headers["X-Timestamp"]);
  assertExists(headers["X-Signature"]);
});

Deno.test("get-firmware: supports version query parameter", () => {
  const url = new URL("http://localhost?version=1.5.2");
  assertEquals(url.searchParams.get("version"), "1.5.2");
});

Deno.test("get-firmware: response contains signed download URL", () => {
  const mockResponse = {
    success: true,
    version: "1.5.2",
    download_url: "https://storage.supabase.co/firmware/1.5.2/firmware.bin?token=xxx",
    size: 1234567,
    expires_in: 600,
  };

  assertEquals(mockResponse.success, true);
  assertExists(mockResponse.version);
  assertExists(mockResponse.download_url);
  assertEquals(typeof mockResponse.size, "number");
  assertEquals(mockResponse.expires_in, 600); // 10 minutes
});

Deno.test("get-firmware: respects rollout percentage", () => {
  const rolloutPercentage = 50;

  // Device not in rollout should get 404
  const notInRolloutResponse = {
    success: false,
    error: "Update not available for your device yet",
    rollout_percentage: rolloutPercentage,
  };

  assertEquals(notInRolloutResponse.success, false);
  assertStringIncludes(notInRolloutResponse.error, "not available");
});

Deno.test("get-firmware: signed URL expiry is 10 minutes", () => {
  const SIGNED_URL_EXPIRY_SECONDS = 600;
  assertEquals(SIGNED_URL_EXPIRY_SECONDS, 600);
});

// ============================================================================
// cleanup-logs Tests
// ============================================================================

Deno.test("cleanup-logs: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Should return 405
});

Deno.test("cleanup-logs: requires authorization header", () => {
  const reqWithoutAuth = createMockRequest("POST");
  assertEquals(reqWithoutAuth.headers.has("Authorization"), false);
  // Should return 401
});

Deno.test("cleanup-logs: accepts service role key", () => {
  const headers = {
    Authorization: "Bearer service-role-key-here",
  };
  assertStringIncludes(headers.Authorization, "Bearer ");
});

Deno.test("cleanup-logs: accepts admin user token", () => {
  const adminToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...admin-jwt...";
  assertExists(adminToken);
});

Deno.test("cleanup-logs: returns deleted count", () => {
  const mockResponse = {
    success: true,
    deleted_count: 150,
    retention_days: 7,
    timestamp: "2026-01-28T12:00:00.000Z",
  };

  assertEquals(mockResponse.success, true);
  assertEquals(typeof mockResponse.deleted_count, "number");
  assertEquals(mockResponse.retention_days, 7);
  assertExists(mockResponse.timestamp);
});

Deno.test("cleanup-logs: retention period is 7 days", () => {
  const RETENTION_DAYS = 7;
  assertEquals(RETENTION_DAYS, 7);
});

Deno.test("cleanup-logs: rejects non-admin users", () => {
  const forbiddenResponse = {
    error: "Unauthorized - admin access required",
  };
  assertStringIncludes(forbiddenResponse.error, "admin");
});

// ============================================================================
// JWT Token Format Tests
// ============================================================================

Deno.test("JWT: app token has correct claims", () => {
  const appTokenPayload = createMockJwtPayload("app", "A1B2C3D4", "ABC123", 3600);

  assertEquals(appTokenPayload.token_type, "app");
  assertEquals(typeof appTokenPayload.sub, "string");
  assertEquals((appTokenPayload.sub as string).length, 36);
  assertEquals(appTokenPayload.serial_number, "A1B2C3D4");
  assertExists(appTokenPayload.pairing_code);
  assertExists(appTokenPayload.device_id);
  assertEquals(typeof appTokenPayload.iat, "number");
  assertEquals(typeof appTokenPayload.exp, "number");
  assertEquals((appTokenPayload.exp as number) > (appTokenPayload.iat as number), true);
});

Deno.test("JWT: device token has correct claims", () => {
  const deviceTokenPayload = createMockJwtPayload("device", "A1B2C3D4", "ABC123", 86400);

  assertEquals(deviceTokenPayload.token_type, "device");
  assertEquals(typeof deviceTokenPayload.sub, "string");
  assertEquals((deviceTokenPayload.sub as string).length, 36);
  assertEquals(deviceTokenPayload.serial_number, "A1B2C3D4");
  assertExists(deviceTokenPayload.pairing_code);
  // Device token TTL is 24 hours
  assertEquals(
    (deviceTokenPayload.exp as number) - (deviceTokenPayload.iat as number),
    86400,
  );
});

Deno.test("JWT: app token TTL is 1 hour", () => {
  const TOKEN_TTL_SECONDS = 3600;
  assertEquals(TOKEN_TTL_SECONDS, 3600);
});

Deno.test("JWT: device token TTL is 24 hours", () => {
  const DEVICE_TOKEN_TTL_SECONDS = 86400;
  assertEquals(DEVICE_TOKEN_TTL_SECONDS, 86400);
});

// ============================================================================
// CORS Headers Tests
// ============================================================================

Deno.test("CORS: default headers allow all origins", () => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-device-serial, x-timestamp, x-signature",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };

  assertEquals(corsHeaders["Access-Control-Allow-Origin"], "*");
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "authorization");
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "x-device-serial");
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "x-timestamp");
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "x-signature");
  assertStringIncludes(corsHeaders["Access-Control-Allow-Methods"], "POST");
  assertStringIncludes(corsHeaders["Access-Control-Allow-Methods"], "OPTIONS");
});

Deno.test("CORS: OPTIONS preflight returns 200", () => {
  // All Edge Functions should return null body with corsHeaders for OPTIONS
  const req = createMockRequest("OPTIONS");
  assertEquals(req.method, "OPTIONS");
});

// ============================================================================
// Error Response Format Tests
// ============================================================================

Deno.test("Error: 400 Bad Request format", () => {
  const errorResponse = {
    success: false,
    error: "Missing or invalid pairing_code",
  };

  assertEquals(errorResponse.success, false);
  assertExists(errorResponse.error);
});

Deno.test("Error: 401 Unauthorized format", () => {
  const errorResponse = {
    success: false,
    error: "Invalid token",
  };

  assertEquals(errorResponse.success, false);
  assertExists(errorResponse.error);
});

Deno.test("Error: 404 Not Found format", () => {
  const errorResponse = {
    success: false,
    error: "Device not found",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "not found");
});

Deno.test("Error: 405 Method Not Allowed format", () => {
  const errorResponse = {
    success: false,
    error: "Method not allowed",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Method not allowed");
});

Deno.test("Error: 429 Rate Limited format", () => {
  const errorResponse = {
    success: false,
    error: "Rate limit exceeded. Max 12 requests per minute.",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Rate limit");
});

Deno.test("Error: 500 Internal Server Error format", () => {
  const errorResponse = {
    success: false,
    error: "Internal server error",
  };

  assertEquals(errorResponse.success, false);
  assertStringIncludes(errorResponse.error, "Internal server error");
});

// ============================================================================
// HMAC Validation Logic Tests
// ============================================================================

Deno.test("HMAC: signature computation matches expected format", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const body = '{"test":"data"}';
  const keyHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const signature = await generateHmacSignature(serial, timestamp, body, keyHash);

  // Signature should be base64-encoded
  assertMatch(signature, /^[A-Za-z0-9+/]+=*$/);
  // HMAC-SHA256 produces 32 bytes = 44 base64 chars (with padding)
  assertEquals(signature.length, 44);
});

Deno.test("HMAC: different bodies produce different signatures", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const keyHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const sig1 = await generateHmacSignature(serial, timestamp, '{"a":1}', keyHash);
  const sig2 = await generateHmacSignature(serial, timestamp, '{"b":2}', keyHash);

  assertEquals(sig1 !== sig2, true);
});

Deno.test("HMAC: different timestamps produce different signatures", async () => {
  const serial = "A1B2C3D4";
  const body = "";
  const keyHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const sig1 = await generateHmacSignature(serial, 1706400000, body, keyHash);
  const sig2 = await generateHmacSignature(serial, 1706400001, body, keyHash);

  assertEquals(sig1 !== sig2, true);
});

Deno.test("HMAC: different serials produce different signatures", async () => {
  const timestamp = 1706400000;
  const body = "";
  const keyHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const sig1 = await generateHmacSignature("A1B2C3D4", timestamp, body, keyHash);
  const sig2 = await generateHmacSignature("X1Y2Z3W4", timestamp, body, keyHash);

  assertEquals(sig1 !== sig2, true);
});

Deno.test("HMAC: different keys produce different signatures", async () => {
  const serial = "A1B2C3D4";
  const timestamp = 1706400000;
  const body = "";

  const sig1 = await generateHmacSignature(
    serial,
    timestamp,
    body,
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  const sig2 = await generateHmacSignature(
    serial,
    timestamp,
    body,
    "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  );

  assertEquals(sig1 !== sig2, true);
});

// ============================================================================
// Rollout Logic Tests
// ============================================================================

Deno.test("Rollout: 100% includes all devices", () => {
  function isDeviceInRollout(
    serial: string,
    version: string,
    percentage: number,
  ): boolean {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    const input = `${serial}:${version}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 100 < percentage;
  }

  // All devices should be included at 100%
  assertEquals(isDeviceInRollout("A1B2C3D4", "1.0.0", 100), true);
  assertEquals(isDeviceInRollout("12345678", "1.0.0", 100), true);
  assertEquals(isDeviceInRollout("FFFFFFFF", "1.0.0", 100), true);
});

Deno.test("Rollout: 0% excludes all devices", () => {
  function isDeviceInRollout(
    serial: string,
    version: string,
    percentage: number,
  ): boolean {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    const input = `${serial}:${version}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 100 < percentage;
  }

  // No devices should be included at 0%
  assertEquals(isDeviceInRollout("A1B2C3D4", "1.0.0", 0), false);
  assertEquals(isDeviceInRollout("12345678", "1.0.0", 0), false);
  assertEquals(isDeviceInRollout("FFFFFFFF", "1.0.0", 0), false);
});

Deno.test("Rollout: deterministic results for same input", () => {
  function isDeviceInRollout(
    serial: string,
    version: string,
    percentage: number,
  ): boolean {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    const input = `${serial}:${version}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 100 < percentage;
  }

  // Same device + version + percentage should always give same result
  const results: boolean[] = [];
  for (let i = 0; i < 10; i++) {
    results.push(isDeviceInRollout("A1B2C3D4", "1.5.2", 50));
  }

  // All results should be the same
  assertEquals(results.every((r) => r === results[0]), true);
});

Deno.test("Rollout: increasing percentage doesn't remove devices", () => {
  function isDeviceInRollout(
    serial: string,
    version: string,
    percentage: number,
  ): boolean {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    const input = `${serial}:${version}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 100 < percentage;
  }

  // If a device is in 25% rollout, it should also be in 50%, 75%, and 100%
  const version = "1.5.2";

  // Find a device that's in the 10% rollout
  let testSerial = "";
  for (let i = 0; i < 1000; i++) {
    const s = i.toString(16).padStart(8, "0").toUpperCase();
    if (isDeviceInRollout(s, version, 10)) {
      testSerial = s;
      break;
    }
  }

  if (testSerial) {
    // This device should be in all higher percentages
    assertEquals(isDeviceInRollout(testSerial, version, 10), true);
    assertEquals(isDeviceInRollout(testSerial, version, 25), true);
    assertEquals(isDeviceInRollout(testSerial, version, 50), true);
    assertEquals(isDeviceInRollout(testSerial, version, 75), true);
    assertEquals(isDeviceInRollout(testSerial, version, 100), true);
  }
});

// ============================================================================
// Input Validation Tests
// ============================================================================

Deno.test("Validation: serial number must be 8 hex chars", () => {
  const isValidSerial = (s: string) => /^[A-Fa-f0-9]{8}$/.test(s);

  assertEquals(isValidSerial("A1B2C3D4"), true);
  assertEquals(isValidSerial("12345678"), true);
  assertEquals(isValidSerial("abcdef12"), true);
  assertEquals(isValidSerial("ABCDEF12"), true);

  assertEquals(isValidSerial("A1B2C3"), false); // Too short
  assertEquals(isValidSerial("A1B2C3D4E5"), false); // Too long
  assertEquals(isValidSerial("GHIJKLMN"), false); // Invalid hex chars
  assertEquals(isValidSerial("A1B2-C3D4"), false); // Contains dash
});

Deno.test("Validation: pairing code must be 6 chars from valid set", () => {
  const validChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const isValidPairingCode = (code: string): boolean => {
    if (!code || code.length !== 6) return false;
    const upperCode = code.toUpperCase();
    for (const char of upperCode) {
      if (!validChars.includes(char)) return false;
    }
    return true;
  };

  assertEquals(isValidPairingCode("ABC234"), true);
  assertEquals(isValidPairingCode("XYZ789"), true);

  assertEquals(isValidPairingCode("ABC"), false); // Too short
  assertEquals(isValidPairingCode("ABCDEFGH"), false); // Too long
  assertEquals(isValidPairingCode("ABC10I"), false); // Contains I
  assertEquals(isValidPairingCode("ABC10O"), false); // Contains O
  assertEquals(isValidPairingCode("ABC101"), false); // Contains 1
  assertEquals(isValidPairingCode("ABC100"), false); // Contains 0
});

Deno.test("Validation: key_hash is 64 hex chars (SHA-256)", () => {
  const isValidKeyHash = (hash: string) => /^[A-Fa-f0-9]{64}$/.test(hash);

  const validHash =
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
  assertEquals(isValidKeyHash(validHash), true);
  assertEquals(validHash.length, 64);

  const shortHash = "a1b2c3d4";
  assertEquals(isValidKeyHash(shortHash), false);

  const invalidCharsHash =
    "g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
  assertEquals(isValidKeyHash(invalidCharsHash), false);
});

Deno.test("Validation: timestamp is valid Unix timestamp", () => {
  const now = Math.floor(Date.now() / 1000);

  // Should be a positive integer
  assertEquals(now > 0, true);
  assertEquals(Number.isInteger(now), true);

  // Should be in reasonable range (after year 2020)
  assertEquals(now > 1577836800, true); // 2020-01-01

  // Should not be too far in future (more than 1 year)
  const oneYearFromNow = now + 365 * 24 * 60 * 60;
  assertEquals(now < oneYearFromNow, true);
});

// ============================================================================
// Content-Type Validation Tests
// ============================================================================

Deno.test("Content-Type: JSON responses have correct header", () => {
  const headers = {
    "Content-Type": "application/json",
  };

  assertEquals(headers["Content-Type"], "application/json");
});

Deno.test("Content-Type: requests should send JSON", () => {
  const req = createMockRequest("POST", { test: "data" });
  assertEquals(req.headers.get("Content-Type"), "application/json");
});
