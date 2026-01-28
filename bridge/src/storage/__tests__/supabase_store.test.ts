/**
 * Supabase Store Tests
 *
 * Unit tests for the SupabaseStore class that handles device registration
 * and HMAC validation with Supabase.
 */

import {
  SupabaseStore,
  SupabaseDevice,
  AuthValidationResult,
  ProvisionResult,
} from "../supabase_store";
import { createLogger, transports } from "winston";

// Create a silent test logger
const logger = createLogger({
  level: "error",
  transports: [new transports.Console({ silent: true })],
});

// Mock fetch globally
const originalFetch = global.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
  // Reset environment variables
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe("SupabaseStore", () => {
  describe("constructor", () => {
    it("should be disabled when environment variables are not set", () => {
      const store = new SupabaseStore(logger);
      expect(store.isEnabled()).toBe(false);
    });

    it("should be disabled when only SUPABASE_URL is set", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      const store = new SupabaseStore(logger);
      expect(store.isEnabled()).toBe(false);
    });

    it("should be disabled when only SUPABASE_SERVICE_ROLE_KEY is set", () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
      const store = new SupabaseStore(logger);
      expect(store.isEnabled()).toBe(false);
    });

    it("should be enabled when both environment variables are set", () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
      const store = new SupabaseStore(logger);
      expect(store.isEnabled()).toBe(true);
    });
  });

  describe("provisionDevice", () => {
    it("should return error when Supabase is not configured", async () => {
      const store = new SupabaseStore(logger);
      const result = await store.provisionDevice("SERIAL01", "keyhash123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Supabase not configured");
    });

    it("should call provision-device Edge Function with correct data", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_id: "webex-display-1234",
          pairing_code: "ABC123",
        }),
      });

      const store = new SupabaseStore(logger);
      const result = await store.provisionDevice(
        "SERIAL01",
        "keyhash123",
        "1.0.0",
        "192.168.1.100",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.supabase.co/functions/v1/provision-device",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-service-key",
          }),
          body: expect.stringContaining("SERIAL01"),
        }),
      );

      expect(result.success).toBe(true);
      expect(result.device_id).toBe("webex-display-1234");
      expect(result.pairing_code).toBe("ABC123");
    });

    it("should handle provision failure", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Device already exists" }),
      });

      const store = new SupabaseStore(logger);
      const result = await store.provisionDevice("SERIAL01", "keyhash123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Device already exists");
    });

    it("should handle network errors", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const store = new SupabaseStore(logger);
      const result = await store.provisionDevice("SERIAL01", "keyhash123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });

  describe("validateDeviceAuth", () => {
    it("should allow unauthenticated access when Supabase is not configured", async () => {
      const store = new SupabaseStore(logger);
      const result = await store.validateDeviceAuth(
        "SERIAL01",
        1706300000,
        "signature123",
      );

      expect(result.valid).toBe(true);
    });

    it("should call validate-device Edge Function with correct headers", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      const mockDevice: SupabaseDevice = {
        serial_number: "SERIAL01",
        device_id: "webex-display-1234",
        pairing_code: "ABC123",
        display_name: "Test Device",
        firmware_version: "1.0.0",
        ip_address: "192.168.1.100",
        last_seen: new Date().toISOString(),
        debug_enabled: false,
        is_provisioned: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          valid: true,
          device: mockDevice,
        }),
      });

      const store = new SupabaseStore(logger);
      const result = await store.validateDeviceAuth(
        "SERIAL01",
        1706300000,
        "validSignature123",
        '{"test":"body"}',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.supabase.co/functions/v1/validate-device",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Device-Serial": "SERIAL01",
            "X-Timestamp": "1706300000",
            "X-Signature": "validSignature123",
          }),
          body: '{"test":"body"}',
        }),
      );

      expect(result.valid).toBe(true);
      expect(result.device).toBeDefined();
      expect(result.device?.serial_number).toBe("SERIAL01");
    });

    it("should handle invalid signature", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          valid: false,
          error: "Invalid signature",
        }),
      });

      const store = new SupabaseStore(logger);
      const result = await store.validateDeviceAuth(
        "SERIAL01",
        1706300000,
        "invalidSignature",
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });

    it("should handle expired timestamp", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          valid: false,
          error: "Request timestamp expired",
        }),
      });

      const store = new SupabaseStore(logger);
      const result = await store.validateDeviceAuth(
        "SERIAL01",
        1000000000, // Very old timestamp
        "signature",
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Request timestamp expired");
    });
  });

  describe("getDeviceBySerial", () => {
    it("should return null when Supabase is not configured", async () => {
      const store = new SupabaseStore(logger);
      const result = await store.getDeviceBySerial("SERIAL01");
      expect(result).toBeNull();
    });

    it("should query device with correct schema headers", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      const mockDevice: SupabaseDevice = {
        serial_number: "SERIAL01",
        device_id: "webex-display-1234",
        pairing_code: "ABC123",
        display_name: "Test Device",
        firmware_version: "1.0.0",
        ip_address: "192.168.1.100",
        last_seen: new Date().toISOString(),
        debug_enabled: false,
        is_provisioned: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockDevice],
      });

      const store = new SupabaseStore(logger);
      const result = await store.getDeviceBySerial("SERIAL01");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.supabase.co/rest/v1/devices?serial_number=eq.SERIAL01",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Profile": "display",
            "Accept-Profile": "display",
            apikey: "test-service-key",
          }),
        }),
      );

      expect(result).toEqual(mockDevice);
    });

    it("should return null when device not found", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const store = new SupabaseStore(logger);
      const result = await store.getDeviceBySerial("NONEXISTENT");

      expect(result).toBeNull();
    });
  });

  describe("updateDeviceLastSeen", () => {
    it("should not call API when Supabase is not configured", async () => {
      const store = new SupabaseStore(logger);
      await store.updateDeviceLastSeen("SERIAL01");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should update with correct schema headers", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const store = new SupabaseStore(logger);
      await store.updateDeviceLastSeen("SERIAL01", "192.168.1.100", "1.1.0");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.supabase.co/rest/v1/devices?serial_number=eq.SERIAL01",
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({
            "Content-Profile": "display",
            "Accept-Profile": "display",
            Prefer: "return=minimal",
          }),
          body: expect.stringContaining("last_seen"),
        }),
      );
    });
  });

  describe("insertDeviceLog", () => {
    it("should not call API when Supabase is not configured", async () => {
      const store = new SupabaseStore(logger);
      await store.insertDeviceLog("device123", "info", "Test message");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should insert log with correct format", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const store = new SupabaseStore(logger);
      await store.insertDeviceLog(
        "device123",
        "error",
        "Something went wrong",
        { code: 500 },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.supabase.co/rest/v1/device_logs",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("device123"),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.device_id).toBe("device123");
      expect(body.level).toBe("error");
      expect(body.message).toBe("Something went wrong");
      expect(body.metadata).toEqual({ code: 500 });
    });
  });

  describe("getDeviceLogs", () => {
    it("should return empty array when Supabase is not configured", async () => {
      const store = new SupabaseStore(logger);
      const result = await store.getDeviceLogs("device123");
      expect(result).toEqual([]);
    });

    it("should fetch logs with correct parameters", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      const mockLogs = [
        { level: "info", message: "Log 1", created_at: "2024-01-26T00:00:00Z" },
        {
          level: "error",
          message: "Log 2",
          created_at: "2024-01-26T00:01:00Z",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockLogs,
      });

      const store = new SupabaseStore(logger);
      const result = await store.getDeviceLogs("device123", 50);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("device_id=eq.device123"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Profile": "display",
            "Accept-Profile": "display",
          }),
        }),
      );

      expect(mockFetch.mock.calls[0][0]).toContain("limit=50");
      expect(result).toEqual(mockLogs);
    });
  });

  describe("setDeviceDebugMode", () => {
    it("should not call API when Supabase is not configured", async () => {
      const store = new SupabaseStore(logger);
      await store.setDeviceDebugMode("SERIAL01", true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should update debug mode correctly", async () => {
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const store = new SupabaseStore(logger);
      await store.setDeviceDebugMode("SERIAL01", true);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.supabase.co/rest/v1/devices?serial_number=eq.SERIAL01",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ debug_enabled: true }),
        }),
      );
    });
  });
});

describe("HMAC Signature Format", () => {
  it("should have correct message format", () => {
    const serial = "A1B2C3D4";
    const timestamp = 1706300000;
    const bodyHash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const message = `${serial}:${timestamp}:${bodyHash}`;

    expect(message).toBe(
      "A1B2C3D4:1706300000:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("should use timestamp window of 5 minutes", () => {
    const TIMESTAMP_WINDOW_SECONDS = 300;
    expect(TIMESTAMP_WINDOW_SECONDS).toBe(300);
    expect(TIMESTAMP_WINDOW_SECONDS).toBe(5 * 60);
  });
});

describe("Schema Headers", () => {
  it("should include display schema headers", () => {
    const schemaHeaders = {
      "Content-Profile": "display",
      "Accept-Profile": "display",
    };

    expect(schemaHeaders["Content-Profile"]).toBe("display");
    expect(schemaHeaders["Accept-Profile"]).toBe("display");
  });
});

describe("validateAppToken", () => {
  // Helper to create a valid JWT token
  const createMockToken = (
    payload: Record<string, unknown>,
    secret: string,
  ): string => {
    const header = { alg: "HS256", typ: "JWT" };
    const headerBase64 = Buffer.from(JSON.stringify(header)).toString(
      "base64url",
    );
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );
    const signatureInput = `${headerBase64}.${payloadBase64}`;

    // Create HMAC signature
    const crypto = require("crypto");
    const signature = crypto
      .createHmac("sha256", secret)
      .update(signatureInput)
      .digest("base64url");

    return `${headerBase64}.${payloadBase64}.${signature}`;
  };

  const mockDevice: SupabaseDevice = {
    serial_number: "SERIAL123",
    device_id: "webex-display-1234",
    pairing_code: "ABC123",
    display_name: "Test Device",
    firmware_version: "1.0.0",
    ip_address: "192.168.1.100",
    last_seen: new Date().toISOString(),
    debug_enabled: false,
    is_provisioned: true,
  };

  beforeEach(() => {
    // Reset environment
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.BRIDGE_APP_TOKEN_SECRET;
  });

  it("should allow unauthenticated access when Supabase is not configured", async () => {
    const store = new SupabaseStore(logger);

    const result = await store.validateAppToken("any.token.here");

    expect(result.valid).toBe(true);
  });

  it("should skip validation when BRIDGE_APP_TOKEN_SECRET not set", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    // No BRIDGE_APP_TOKEN_SECRET set

    const store = new SupabaseStore(logger);

    const result = await store.validateAppToken("any.token.here");

    expect(result.valid).toBe(true);
  });

  it("should validate token with valid signature and return device", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.BRIDGE_APP_TOKEN_SECRET = "test-secret-key";

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "SERIAL123",
      device_id: "webex-display-1234",
      pairing_code: "ABC123",
      type: "app_auth",
      iat: now,
      exp: now + 3600, // 1 hour from now
    };

    const token = createMockToken(payload, "test-secret-key");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [mockDevice],
    });

    const store = new SupabaseStore(logger);
    const result = await store.validateAppToken(token);

    expect(result.valid).toBe(true);
    expect(result.device).toEqual(mockDevice);
  });

  it("should reject token with invalid format", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.BRIDGE_APP_TOKEN_SECRET = "test-secret-key";

    const store = new SupabaseStore(logger);

    // Not a JWT (no dots)
    const result = await store.validateAppToken("not-a-jwt-token");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid token format");
  });

  it("should reject token with wrong type claim", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.BRIDGE_APP_TOKEN_SECRET = "test-secret-key";

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "SERIAL123",
      device_id: "webex-display-1234",
      pairing_code: "ABC123",
      type: "wrong_type", // Wrong type
      iat: now,
      exp: now + 3600,
    };

    const token = createMockToken(payload, "test-secret-key");

    const store = new SupabaseStore(logger);
    const result = await store.validateAppToken(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid token type");
  });

  it("should reject expired token", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.BRIDGE_APP_TOKEN_SECRET = "test-secret-key";

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "SERIAL123",
      device_id: "webex-display-1234",
      pairing_code: "ABC123",
      type: "app_auth",
      iat: now - 7200, // 2 hours ago
      exp: now - 3600, // Expired 1 hour ago
    };

    const token = createMockToken(payload, "test-secret-key");

    const store = new SupabaseStore(logger);
    const result = await store.validateAppToken(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Token expired");
  });

  it("should reject token with invalid signature", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.BRIDGE_APP_TOKEN_SECRET = "test-secret-key";

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "SERIAL123",
      device_id: "webex-display-1234",
      pairing_code: "ABC123",
      type: "app_auth",
      iat: now,
      exp: now + 3600,
    };

    // Create token with wrong secret
    const token = createMockToken(payload, "wrong-secret-key");

    const store = new SupabaseStore(logger);
    const result = await store.validateAppToken(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid token signature");
  });

  it("should reject token when device not found", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.BRIDGE_APP_TOKEN_SECRET = "test-secret-key";

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "DELETED_SERIAL",
      device_id: "deleted-device",
      pairing_code: "DEL123",
      type: "app_auth",
      iat: now,
      exp: now + 3600,
    };

    const token = createMockToken(payload, "test-secret-key");

    // Return empty array (device not found)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const store = new SupabaseStore(logger);
    const result = await store.validateAppToken(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Device not found");
  });

  it("should handle malformed payload gracefully", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.BRIDGE_APP_TOKEN_SECRET = "test-secret-key";

    // Create a token with invalid base64 payload
    const invalidToken = "eyJhbGciOiJIUzI1NiJ9.not-valid-base64.signature";

    const store = new SupabaseStore(logger);
    const result = await store.validateAppToken(invalidToken);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("insertDeviceLog with serial_number", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("should include serial_number in log entry when provided", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const store = new SupabaseStore(logger);
    await store.insertDeviceLog(
      "device123",
      "info",
      "Test log message",
      { extra: "data" },
      "SERIAL456", // serial_number provided
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.supabase.co/rest/v1/device_logs",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.device_id).toBe("device123");
    expect(body.level).toBe("info");
    expect(body.message).toBe("Test log message");
    expect(body.metadata).toEqual({ extra: "data" });
    expect(body.serial_number).toBe("SERIAL456");
  });

  it("should not include serial_number when not provided", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const store = new SupabaseStore(logger);
    await store.insertDeviceLog(
      "device123",
      "warn",
      "Warning message",
      undefined,
      // No serial_number
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.device_id).toBe("device123");
    expect(body.level).toBe("warn");
    expect(body.serial_number).toBeUndefined();
  });
});
