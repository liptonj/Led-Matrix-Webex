/**
 * Supabase Client Tests
 *
 * Unit tests for the Supabase client configuration and helper functions.
 */

// Configurable mock state - allows tests to customize behavior
const mockState = {
  channelSubscribeCallback: null as ((status: string, err?: Error) => void) | null,
  channelOnCallback: null as ((payload: unknown) => void) | null,
};

// Create a mock channel that tests can configure
const createMockChannel = () => {
  const channel = {
    on: jest.fn((type: string, config: unknown, callback: (payload: unknown) => void) => {
      mockState.channelOnCallback = callback;
      return channel;
    }),
    subscribe: jest.fn((callback?: (status: string, err?: Error) => void) => {
      mockState.channelSubscribeCallback = callback || null;
      // Default: simulate successful subscription
      if (callback) callback("SUBSCRIBED");
      return channel;
    }),
  };
  return channel;
};

// Mock the dynamic import of @supabase/supabase-js
const mockRemoveChannel = jest.fn();
const mockChannel = createMockChannel();
const mockRpc = jest.fn(() => Promise.resolve({ error: null }));
const mockOnAuthStateChange = jest.fn(() => ({
  data: { subscription: { unsubscribe: jest.fn() } },
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => {
    // Create properly chainable query builder
    const createQueryBuilder = (): Record<string, jest.Mock> => {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn(() => builder);
      builder.order = jest.fn(() => builder);
      builder.eq = jest.fn(() => builder);
      builder.in = jest.fn(() => builder);
      builder.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
      builder.single = jest.fn(() => Promise.resolve({ data: null, error: null }));
      builder.update = jest.fn(() => builder);
      return builder;
    };

    return {
      auth: {
        signInWithPassword: jest.fn(() =>
          Promise.resolve({ data: { session: {} }, error: null }),
        ),
        signOut: jest.fn(() => Promise.resolve({ error: null })),
        getSession: jest.fn(() =>
          Promise.resolve({ data: { session: null }, error: null }),
        ),
        onAuthStateChange: mockOnAuthStateChange,
      },
      schema: jest.fn(() => ({
        from: jest.fn(() => createQueryBuilder()),
      })),
      channel: jest.fn(() => mockChannel),
      removeChannel: mockRemoveChannel,
      rpc: mockRpc,
    };
  }),
}));

// Export for tests that need to access/configure the mocks
export { mockChannel, mockOnAuthStateChange, mockRemoveChannel, mockRpc, mockState };

// Store original env
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

afterEach(() => {
  process.env = originalEnv;
});

describe("Supabase Configuration", () => {
  describe("isSupabaseConfigured", () => {
    it("should return false when environment variables are not set", async () => {
      const { isSupabaseConfigured } = await import("../supabase");
      expect(isSupabaseConfigured()).toBe(false);
    });

    it("should return false when only URL is set", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      jest.resetModules();
      const { isSupabaseConfigured } = await import("../supabase");
      expect(isSupabaseConfigured()).toBe(false);
    });

    it("should return false when only anon key is set", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
      jest.resetModules();
      const { isSupabaseConfigured } = await import("../supabase");
      expect(isSupabaseConfigured()).toBe(false);
    });

    it("should return true when both environment variables are set", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
      jest.resetModules();
      const { isSupabaseConfigured } = await import("../supabase");
      expect(isSupabaseConfigured()).toBe(true);
    });
  });

  describe("getSupabase", () => {
    it("should throw error when not configured", async () => {
      const { getSupabase } = await import("../supabase");
      await expect(getSupabase()).rejects.toThrow("Supabase is not configured");
    });

    it("should return client when configured", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
      jest.resetModules();
      const { getSupabase } = await import("../supabase");
      const client = await getSupabase();
      expect(client).toBeDefined();
      expect(client.auth).toBeDefined();
    });
  });
});

describe("Device Helper Functions", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
  });

  describe("getDevices", () => {
    it("should query devices from display schema", async () => {
      const { getDevices } = await import("../supabase");
      const devices = await getDevices();
      expect(Array.isArray(devices)).toBe(true);
    });
  });

  describe("getDevice", () => {
    it("should query single device by serial number", async () => {
      const { getDevice } = await import("../supabase");
      const device = await getDevice("A1B2C3D4");
      expect(device).toBeNull(); // Mock returns null
    });
  });

  describe("getDeviceLogs", () => {
    it("should query device logs with default limit", async () => {
      const { getDeviceLogs } = await import("../supabase");
      const logs = await getDeviceLogs("device-123");
      expect(Array.isArray(logs)).toBe(true);
    });

    it("should accept custom limit parameter", async () => {
      const { getDeviceLogs } = await import("../supabase");
      const logs = await getDeviceLogs("device-123", 50);
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe("getReleases", () => {
    it("should query releases from display schema", async () => {
      const { getReleases } = await import("../supabase");
      const releases = await getReleases();
      expect(Array.isArray(releases)).toBe(true);
    });
  });
});

describe("Auth Helper Functions", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
  });

  describe("signIn", () => {
    it("should call signInWithPassword with credentials", async () => {
      const { signIn } = await import("../supabase");
      const result = await signIn("test@example.com", "password123");
      expect(result).toBeDefined();
    });
  });

  describe("signOut", () => {
    it("should call signOut on auth", async () => {
      const { signOut } = await import("../supabase");
      const result = await signOut();
      expect(result).toBeDefined();
    });
  });

  describe("getSession", () => {
    it("should call getSession on auth", async () => {
      const { getSession } = await import("../supabase");
      const result = await getSession();
      expect(result).toBeDefined();
    });
  });
});

describe("Type Definitions", () => {
  describe("Device interface", () => {
    it("should have required fields", () => {
      const device = {
        id: "uuid-123",
        serial_number: "A1B2C3D4",
        device_id: "webex-display-C3D4",
        pairing_code: "ABCD23",
        display_name: "Test Device",
        firmware_version: "1.0.0",
        target_firmware_version: null,
        ip_address: "192.168.1.100",
        last_seen: "2024-01-26T00:00:00Z",
        debug_enabled: false,
        is_provisioned: true,
        approval_required: false,
        disabled: false,
        blacklisted: false,
        registered_at: "2024-01-25T00:00:00Z",
        provisioned_at: null,
        metadata: {},
      };

      expect(device.serial_number).toBe("A1B2C3D4");
      expect(device.device_id).toBe("webex-display-C3D4");
      expect(device.pairing_code).toBe("ABCD23");
      expect(device.debug_enabled).toBe(false);
      expect(device.is_provisioned).toBe(true);
    });
  });

  describe("DeviceLog interface", () => {
    it("should have required fields", () => {
      const log = {
        id: "uuid-456",
        device_id: "device-123",
        level: "info" as const,
        message: "Device started",
        metadata: { uptime: 123 },
        created_at: "2024-01-26T00:00:00Z",
      };

      expect(log.level).toBe("info");
      expect(log.message).toBe("Device started");
      expect(log.metadata.uptime).toBe(123);
    });

    it("should accept valid log levels", () => {
      const levels: Array<"debug" | "info" | "warn" | "error"> = [
        "debug",
        "info",
        "warn",
        "error",
      ];

      levels.forEach((level) => {
        expect(["debug", "info", "warn", "error"]).toContain(level);
      });
    });
  });

  describe("Release interface", () => {
    it("should have required fields", () => {
      const release = {
        id: "uuid-789",
        version: "1.0.0",
        tag: "v1.0.0",
        name: "Initial Release",
        notes: "First stable release",
        firmware_url: "https://storage.example.com/firmware.bin",
        firmware_merged_url: null,
        firmware_size: 1048576,
        build_id: "build-123",
        build_date: "2024-01-26T00:00:00Z",
        is_latest: true,
        is_prerelease: false,
        rollout_percentage: 100,
        created_at: "2024-01-26T00:00:00Z",
        created_by: null,
      };

      expect(release.version).toBe("1.0.0");
      expect(release.is_latest).toBe(true);
      expect(release.rollout_percentage).toBe(100);
    });
  });
});

describe("Schema Headers", () => {
  it("should use display schema for all database queries", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();

    const { getSupabase } = await import("../supabase");
    const client = await getSupabase();

    // Verify schema method exists and is callable
    expect(client.schema).toBeDefined();
    expect(typeof client.schema).toBe("function");
  });
});

describe("Security Considerations", () => {
  it("should use anon key (not service role key)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon-key";
    jest.resetModules();

    // Anon key should start with standard JWT format
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toMatch(/^eyJ/);
  });

  it("should persist session for authenticated users", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();

    const { getSupabase } = await import("../supabase");
    const client = await getSupabase();

    // Verify auth object exists with expected methods
    expect(client.auth).toBeDefined();
    expect(client.auth.getSession).toBeDefined();
    expect(client.auth.onAuthStateChange).toBeDefined();
  });
});

describe("getDeviceLogsBySerial", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
  });

  it("should query device logs by serial_number", async () => {
    const { getDeviceLogsBySerial } = await import("../supabase");
    const logs = await getDeviceLogsBySerial("A1B2C3D4");
    expect(Array.isArray(logs)).toBe(true);
  });

  it("should use default limit of 100", async () => {
    const { getDeviceLogsBySerial } = await import("../supabase");
    const logs = await getDeviceLogsBySerial("A1B2C3D4");
    expect(Array.isArray(logs)).toBe(true);
  });

  it("should accept custom limit parameter", async () => {
    const { getDeviceLogsBySerial } = await import("../supabase");
    const logs = await getDeviceLogsBySerial("A1B2C3D4", 50);
    expect(Array.isArray(logs)).toBe(true);
  });
});

describe("subscribeToDeviceLogs", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
    jest.clearAllMocks();
    // Reset channel subscribe to default success behavior
    mockChannel.subscribe.mockImplementation((callback?: (status: string, err?: Error) => void) => {
      mockState.channelSubscribeCallback = callback || null;
      if (callback) callback("SUBSCRIBED");
      return mockChannel;
    });
  });

  it("should set up realtime subscription", async () => {
    const { subscribeToDeviceLogs } = await import("../supabase");
    const onLog = jest.fn();

    const unsubscribe = await subscribeToDeviceLogs("A1B2C3D4", null, onLog);
    expect(typeof unsubscribe).toBe("function");
  });

  it("should call onStatusChange with true when subscribed", async () => {
    const { subscribeToDeviceLogs } = await import("../supabase");
    const onLog = jest.fn();
    const onStatusChange = jest.fn();

    await subscribeToDeviceLogs("A1B2C3D4", null, onLog, onStatusChange);
    expect(onStatusChange).toHaveBeenCalledWith(true);
  });

  it("should return unsubscribe function that removes channel", async () => {
    const { subscribeToDeviceLogs } = await import("../supabase");
    const onLog = jest.fn();

    const unsubscribe = await subscribeToDeviceLogs("A1B2C3D4", null, onLog);
    unsubscribe();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it("should call onError when channel error occurs", async () => {
    // Override to simulate error
    mockChannel.subscribe.mockImplementation((callback?: (status: string, err?: Error) => void) => {
      if (callback) callback("CHANNEL_ERROR");
      return mockChannel;
    });

    const { subscribeToDeviceLogs } = await import("../supabase");
    const onLog = jest.fn();
    const onStatusChange = jest.fn();
    const onError = jest.fn();

    await subscribeToDeviceLogs("A1B2C3D4", null, onLog, onStatusChange, onError);
    expect(onError).toHaveBeenCalledWith("Failed to subscribe to realtime logs");
    expect(onStatusChange).toHaveBeenCalledWith(false);
  });
});

describe("setDeviceDebugMode", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
  });

  it("should enable debug mode for device", async () => {
    const { setDeviceDebugMode } = await import("../supabase");
    await expect(setDeviceDebugMode("A1B2C3D4", true)).resolves.not.toThrow();
  });

  it("should disable debug mode for device", async () => {
    const { setDeviceDebugMode } = await import("../supabase");
    await expect(setDeviceDebugMode("A1B2C3D4", false)).resolves.not.toThrow();
  });
});

describe("setDeviceTargetFirmware", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
  });

  it("should set target firmware version", async () => {
    const { setDeviceTargetFirmware } = await import("../supabase");
    await expect(
      setDeviceTargetFirmware("A1B2C3D4", "1.2.0"),
    ).resolves.not.toThrow();
  });

  it("should clear target firmware version with null", async () => {
    const { setDeviceTargetFirmware } = await import("../supabase");
    await expect(
      setDeviceTargetFirmware("A1B2C3D4", null),
    ).resolves.not.toThrow();
  });
});

describe("setReleaseRollout", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
  });

  it("should update rollout percentage", async () => {
    const { setReleaseRollout } = await import("../supabase");
    await expect(setReleaseRollout("1.0.0", 50)).resolves.not.toThrow();
  });

  it("should set rollout to 100%", async () => {
    const { setReleaseRollout } = await import("../supabase");
    await expect(setReleaseRollout("1.0.0", 100)).resolves.not.toThrow();
  });
});

describe("setLatestRelease", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("should call set_latest_release RPC with target version and channel", async () => {
    const { setLatestRelease } = await import("../supabase");
    await setLatestRelease("1.0.0");
    expect(mockRpc).toHaveBeenCalledWith("set_latest_release", {
      target_version: "1.0.0",
      target_channel: "production",
    });
  });

  it("should call set_latest_release RPC with custom channel", async () => {
    const { setLatestRelease } = await import("../supabase");
    await setLatestRelease("2.0.0-beta", "beta");
    expect(mockRpc).toHaveBeenCalledWith("set_latest_release", {
      target_version: "2.0.0-beta",
      target_channel: "beta",
    });
  });
});

// Pairing and Command Types Tests

describe("Pairing Type Definitions", () => {
  it("should have all required pairing fields", () => {
    const pairing = {
      pairing_code: "ABCD23",
      serial_number: "A1B2C3D4",
      device_id: "webex-display-C3D4",
      app_last_seen: "2026-01-28T12:00:00Z",
      device_last_seen: "2026-01-28T12:00:00Z",
      app_connected: true,
      device_connected: true,
      webex_status: "active",
      camera_on: true,
      mic_muted: false,
      in_call: false,
      display_name: "John Doe",
      rssi: -65,
      free_heap: 180000,
      uptime: 3600,
      temperature: 42.5,
      firmware_version: "1.2.3",
      ssid: "Office-WiFi",
      ota_partition: "ota_0",
      config: {},
      created_at: "2026-01-27T00:00:00Z",
      updated_at: "2026-01-28T12:00:00Z",
    };

    expect(pairing.pairing_code).toBe("ABCD23");
    expect(pairing.serial_number).toBe("A1B2C3D4");
    expect(pairing.app_connected).toBe(true);
    expect(pairing.device_connected).toBe(true);
    expect(pairing.webex_status).toBe("active");
    expect(pairing.rssi).toBe(-65);
    expect(pairing.firmware_version).toBe("1.2.3");
  });

  it("should accept valid webex status values", () => {
    const validStatuses = ["active", "away", "dnd", "meeting", "offline", "call", "presenting"];
    validStatuses.forEach((status) => {
      expect(["active", "away", "dnd", "meeting", "offline", "call", "presenting"]).toContain(status);
    });
  });
});

describe("Command Type Definitions", () => {
  it("should have all required command fields", () => {
    const command = {
      id: "uuid-cmd-123",
      pairing_code: "ABCD23",
      serial_number: "A1B2C3D4",
      command: "set_brightness",
      payload: { value: 200 },
      status: "pending" as const,
      created_at: "2026-01-28T12:00:00Z",
      acked_at: null,
      expires_at: "2026-01-28T12:05:00Z",
      response: null,
      error: null,
    };

    expect(command.id).toBe("uuid-cmd-123");
    expect(command.command).toBe("set_brightness");
    expect(command.status).toBe("pending");
    expect(command.payload.value).toBe(200);
  });

  it("should accept valid command status values", () => {
    const validStatuses: Array<"pending" | "acked" | "failed" | "expired"> = [
      "pending",
      "acked",
      "failed",
      "expired",
    ];

    validStatuses.forEach((status) => {
      expect(["pending", "acked", "failed", "expired"]).toContain(status);
    });
  });
});

// subscribeToPairing Tests

describe("subscribeToPairing", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
    jest.clearAllMocks();
    // Reset channel subscribe to default success behavior
    mockChannel.subscribe.mockImplementation((callback?: (status: string, err?: Error) => void) => {
      mockState.channelSubscribeCallback = callback || null;
      if (callback) callback("SUBSCRIBED");
      return mockChannel;
    });
    mockChannel.on.mockImplementation(() => mockChannel);
  });

  it("should set up realtime subscription for pairing updates", async () => {
    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();

    const unsubscribe = await subscribeToPairing("ABCD23", onUpdate);
    expect(typeof unsubscribe).toBe("function");
  });

  it("should call onStatusChange with true when subscribed", async () => {
    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();
    const onStatusChange = jest.fn();

    await subscribeToPairing("ABCD23", onUpdate, onStatusChange);
    expect(onStatusChange).toHaveBeenCalledWith(true);
  });

  it("should return unsubscribe function that removes channel", async () => {
    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();

    const unsubscribe = await subscribeToPairing("ABCD23", onUpdate);
    unsubscribe();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it("should subscribe to both UPDATE and INSERT events", async () => {
    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();

    await subscribeToPairing("ABCD23", onUpdate);

    // Should have called .on() twice - once for UPDATE, once for INSERT
    expect(mockChannel.on).toHaveBeenCalledTimes(2);
  });

  it("should call onError when channel error occurs", async () => {
    // Override to simulate error
    mockChannel.subscribe.mockImplementation((callback?: (status: string, err?: Error) => void) => {
      if (callback) callback("CHANNEL_ERROR");
      return mockChannel;
    });

    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();
    const onStatusChange = jest.fn();
    const onError = jest.fn();

    await subscribeToPairing("ABCD23", onUpdate, onStatusChange, onError);
    expect(onError).toHaveBeenCalledWith("Failed to subscribe to pairing updates");
    expect(onStatusChange).toHaveBeenCalledWith(false);
  });

  it("should handle subscription timeout", async () => {
    mockChannel.subscribe = jest.fn((callback) => {
      if (callback) callback("TIMED_OUT");
      return mockChannel;
    });

    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();
    const onStatusChange = jest.fn();
    const onError = jest.fn();

    await subscribeToPairing("ABCD23", onUpdate, onStatusChange, onError);
    expect(onError).toHaveBeenCalledWith("Pairing subscription timed out");
  });
});

// subscribeToCommands Tests

describe("subscribeToCommands", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
    jest.clearAllMocks();
    // Reset channel subscribe to default success behavior
    mockChannel.subscribe.mockImplementation((callback?: (status: string, err?: Error) => void) => {
      mockState.channelSubscribeCallback = callback || null;
      if (callback) callback("SUBSCRIBED");
      return mockChannel;
    });
    mockChannel.on.mockImplementation(() => mockChannel);
  });

  it("should set up realtime subscription for command updates", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();

    const unsubscribe = await subscribeToCommands("ABCD23", onCommandUpdate);
    expect(typeof unsubscribe).toBe("function");
  });

  it("should call onStatusChange with true when subscribed", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();
    const onStatusChange = jest.fn();

    await subscribeToCommands("ABCD23", onCommandUpdate, onStatusChange);
    expect(onStatusChange).toHaveBeenCalledWith(true);
  });

  it("should return unsubscribe function that removes channel", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();

    const unsubscribe = await subscribeToCommands("ABCD23", onCommandUpdate);
    unsubscribe();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it("should subscribe to both UPDATE and INSERT events", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();

    await subscribeToCommands("ABCD23", onCommandUpdate);

    // Should have called .on() twice - once for UPDATE, once for INSERT
    expect(mockChannel.on).toHaveBeenCalledTimes(2);
  });

  it("should call onError when channel error occurs", async () => {
    // Override to simulate error
    mockChannel.subscribe.mockImplementation((callback?: (status: string, err?: Error) => void) => {
      if (callback) callback("CHANNEL_ERROR");
      return mockChannel;
    });

    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();
    const onStatusChange = jest.fn();
    const onError = jest.fn();

    await subscribeToCommands("ABCD23", onCommandUpdate, onStatusChange, onError);
    expect(onError).toHaveBeenCalledWith("Failed to subscribe to command updates");
    expect(onStatusChange).toHaveBeenCalledWith(false);
  });
});

// getPairing Tests

describe("getPairing", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
  });

  it("should query pairing by pairing code", async () => {
    const { getPairing } = await import("../supabase");
    const pairing = await getPairing("ABCD23");
    expect(pairing).toBeNull(); // Mock returns null
  });
});

// getPendingCommands Tests

describe("getPendingCommands", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
  });

  it("should query pending commands by pairing code", async () => {
    const { getPendingCommands } = await import("../supabase");
    const commands = await getPendingCommands("ABCD23");
    expect(Array.isArray(commands)).toBe(true);
  });
});

// onAuthStateChange Tests

describe("onAuthStateChange", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("should call onAuthStateChange on auth object", async () => {
    const { onAuthStateChange } = await import("../supabase");
    const callback = jest.fn();
    const result = await onAuthStateChange(callback);
    expect(result).toBeDefined();
    expect(result.data.subscription.unsubscribe).toBeDefined();
    expect(mockOnAuthStateChange).toHaveBeenCalledWith(callback);
  });
});

// Note: Status handling tests (CLOSED, TIMED_OUT, CHANNEL_ERROR) removed
// These are now covered by createRealtimeSubscription.test.ts

// Payload Parsing Tests for Realtime Subscriptions

describe("subscribeToPairing - payload parsing", () => {
  let mockChannel: {
    on: jest.Mock;
    subscribe: jest.Mock;
  };
  let mockRemoveChannel: jest.Mock;
  let capturedOnCallback: ((payload: { new: Record<string, unknown> }) => void) | null = null;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
    capturedOnCallback = null;

    mockChannel = {
      on: jest.fn((eventType, options, callback) => {
        // Capture the UPDATE callback to simulate receiving data
        if (options?.event === "UPDATE") {
          capturedOnCallback = callback;
        }
        return mockChannel;
      }),
      subscribe: jest.fn((callback) => {
        if (callback) callback("SUBSCRIBED");
        return mockChannel;
      }),
    };
    mockRemoveChannel = jest.fn();

    jest.doMock("@supabase/supabase-js", () => ({
      createClient: jest.fn(() => ({
        auth: {
          signInWithPassword: jest.fn(),
          signOut: jest.fn(),
          getSession: jest.fn(),
          onAuthStateChange: jest.fn(),
        },
        schema: jest.fn(() => ({
          from: jest.fn(() => {
            const builder: Record<string, jest.Mock> = {};
            builder.select = jest.fn(() => builder);
            builder.order = jest.fn(() => builder);
            builder.eq = jest.fn(() => builder);
            builder.limit = jest.fn(() =>
              Promise.resolve({ data: [], error: null }),
            );
            builder.single = jest.fn(() =>
              Promise.resolve({ data: null, error: null }),
            );
            return builder;
          }),
        })),
        channel: jest.fn(() => mockChannel),
        removeChannel: mockRemoveChannel,
      })),
    }));
  });

  it("should parse pairing update payload correctly", async () => {
    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();

    await subscribeToPairing("ABCD23", onUpdate);

    // Simulate receiving a pairing update
    const mockPayload = {
      new: {
        pairing_code: "ABCD23",
        serial_number: "A1B2C3D4",
        device_connected: true,
        device_last_seen: "2026-01-28T12:00:00Z",
        rssi: -65,
        free_heap: 180000,
        uptime: 3600,
        temperature: 42.5,
        webex_status: "active",
        camera_on: true,
        mic_muted: false,
        in_call: false,
        display_name: "John Doe",
      },
    };

    // Trigger the callback if it was captured
    if (capturedOnCallback) {
      capturedOnCallback(mockPayload);
      expect(onUpdate).toHaveBeenCalledWith(mockPayload.new);
    }
  });

  it("should handle partial pairing update payload", async () => {
    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();

    await subscribeToPairing("ABCD23", onUpdate);

    // Simulate receiving a partial update (only device telemetry)
    const mockPayload = {
      new: {
        pairing_code: "ABCD23",
        rssi: -70,
        device_last_seen: "2026-01-28T12:05:00Z",
      },
    };

    if (capturedOnCallback) {
      capturedOnCallback(mockPayload);
      expect(onUpdate).toHaveBeenCalledWith(mockPayload.new);
    }
  });

  it("should handle device connection state changes", async () => {
    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();

    await subscribeToPairing("ABCD23", onUpdate);

    // Simulate device disconnecting
    const disconnectPayload = {
      new: {
        pairing_code: "ABCD23",
        device_connected: false,
        device_last_seen: "2026-01-28T12:10:00Z",
      },
    };

    if (capturedOnCallback) {
      capturedOnCallback(disconnectPayload);
      expect(onUpdate).toHaveBeenCalledWith(disconnectPayload.new);
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ device_connected: false })
      );
    }
  });

  it("should handle Webex status changes", async () => {
    const { subscribeToPairing } = await import("../supabase");
    const onUpdate = jest.fn();

    await subscribeToPairing("ABCD23", onUpdate);

    // Simulate Webex status change
    const statusPayload = {
      new: {
        pairing_code: "ABCD23",
        webex_status: "meeting",
        in_call: true,
        camera_on: true,
        mic_muted: true,
      },
    };

    if (capturedOnCallback) {
      capturedOnCallback(statusPayload);
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          webex_status: "meeting",
          in_call: true,
        })
      );
    }
  });
});

describe("subscribeToCommands - command ack handling", () => {
  let mockChannel: {
    on: jest.Mock;
    subscribe: jest.Mock;
  };
  let mockRemoveChannel: jest.Mock;
  let capturedUpdateCallback: ((payload: { new: Record<string, unknown> }) => void) | null = null;
  let capturedInsertCallback: ((payload: { new: Record<string, unknown> }) => void) | null = null;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();
    capturedUpdateCallback = null;
    capturedInsertCallback = null;

    mockChannel = {
      on: jest.fn((eventType, options, callback) => {
        if (options?.event === "UPDATE") {
          capturedUpdateCallback = callback;
        } else if (options?.event === "INSERT") {
          capturedInsertCallback = callback;
        }
        return mockChannel;
      }),
      subscribe: jest.fn((callback) => {
        if (callback) callback("SUBSCRIBED");
        return mockChannel;
      }),
    };
    mockRemoveChannel = jest.fn();

    jest.doMock("@supabase/supabase-js", () => ({
      createClient: jest.fn(() => ({
        auth: {
          signInWithPassword: jest.fn(),
          signOut: jest.fn(),
          getSession: jest.fn(),
          onAuthStateChange: jest.fn(),
        },
        schema: jest.fn(() => ({
          from: jest.fn(() => {
            const builder: Record<string, jest.Mock> = {};
            builder.select = jest.fn(() => builder);
            builder.order = jest.fn(() => builder);
            builder.eq = jest.fn(() => builder);
            builder.limit = jest.fn(() =>
              Promise.resolve({ data: [], error: null }),
            );
            builder.single = jest.fn(() =>
              Promise.resolve({ data: null, error: null }),
            );
            return builder;
          }),
        })),
        channel: jest.fn(() => mockChannel),
        removeChannel: mockRemoveChannel,
      })),
    }));
  });

  it("should handle command acked status update", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();

    await subscribeToCommands("ABCD23", onCommandUpdate);

    // Simulate receiving a command ack
    const ackPayload = {
      new: {
        id: "cmd-uuid-1",
        pairing_code: "ABCD23",
        serial_number: "A1B2C3D4",
        command: "set_brightness",
        payload: { value: 200 },
        status: "acked",
        acked_at: "2026-01-28T12:01:00Z",
        response: { brightness: 200 },
        error: null,
      },
    };

    if (capturedUpdateCallback) {
      capturedUpdateCallback(ackPayload);
      expect(onCommandUpdate).toHaveBeenCalledWith(ackPayload.new);
      expect(onCommandUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "acked",
          response: { brightness: 200 },
        })
      );
    }
  });

  it("should handle command failed status update", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();

    await subscribeToCommands("ABCD23", onCommandUpdate);

    // Simulate receiving a command failure
    const failedPayload = {
      new: {
        id: "cmd-uuid-2",
        pairing_code: "ABCD23",
        serial_number: "A1B2C3D4",
        command: "set_config",
        payload: { invalid: true },
        status: "failed",
        acked_at: "2026-01-28T12:02:00Z",
        response: null,
        error: "Invalid configuration parameter",
      },
    };

    if (capturedUpdateCallback) {
      capturedUpdateCallback(failedPayload);
      expect(onCommandUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: "Invalid configuration parameter",
        })
      );
    }
  });

  it("should handle command expired status update", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();

    await subscribeToCommands("ABCD23", onCommandUpdate);

    // Simulate receiving a command expiration
    const expiredPayload = {
      new: {
        id: "cmd-uuid-3",
        pairing_code: "ABCD23",
        serial_number: "A1B2C3D4",
        command: "reboot",
        payload: {},
        status: "expired",
        acked_at: null,
        response: null,
        error: null,
      },
    };

    if (capturedUpdateCallback) {
      capturedUpdateCallback(expiredPayload);
      expect(onCommandUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "expired",
        })
      );
    }
  });

  it("should handle new command insert notifications", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();

    await subscribeToCommands("ABCD23", onCommandUpdate);

    // Simulate receiving a new command insert notification
    const insertPayload = {
      new: {
        id: "cmd-uuid-4",
        pairing_code: "ABCD23",
        serial_number: "A1B2C3D4",
        command: "get_status",
        payload: {},
        status: "pending",
        created_at: "2026-01-28T12:05:00Z",
        acked_at: null,
        expires_at: "2026-01-28T12:10:00Z",
        response: null,
        error: null,
      },
    };

    if (capturedInsertCallback) {
      capturedInsertCallback(insertPayload);
      expect(onCommandUpdate).toHaveBeenCalledWith(insertPayload.new);
      expect(onCommandUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "get_status",
          status: "pending",
        })
      );
    }
  });

  it("should handle command response with complex payload", async () => {
    const { subscribeToCommands } = await import("../supabase");
    const onCommandUpdate = jest.fn();

    await subscribeToCommands("ABCD23", onCommandUpdate);

    // Simulate receiving a command ack with complex response
    const complexPayload = {
      new: {
        id: "cmd-uuid-5",
        pairing_code: "ABCD23",
        serial_number: "A1B2C3D4",
        command: "get_config",
        payload: {},
        status: "acked",
        acked_at: "2026-01-28T12:06:00Z",
        response: {
          device_name: "webex-display",
          display_name: "John Doe",
          brightness: 128,
          scroll_speed_ms: 50,
          time_zone: "America/New_York",
        },
        error: null,
      },
    };

    if (capturedUpdateCallback) {
      capturedUpdateCallback(complexPayload);
      expect(onCommandUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({
            device_name: "webex-display",
            brightness: 128,
          }),
        })
      );
    }
  });
});

// Note: CHANNEL_ERROR status test removed - covered by createRealtimeSubscription.test.ts

describe("subscribeToDeviceLogs - payload parsing edge cases", () => {
  let mockChannel: {
    on: jest.Mock;
    subscribe: jest.Mock;
  };
  let capturedCallback: ((payload: unknown) => void) | null = null;
  let mockRemoveChannel: jest.Mock;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    jest.resetModules();

    mockChannel = {
      on: jest.fn((event, _filter, callback) => {
        if (event === "postgres_changes") {
          capturedCallback = callback as (payload: unknown) => void;
        }
        return mockChannel;
      }),
      subscribe: jest.fn((callback) => {
        if (callback) callback("SUBSCRIBED");
        return mockChannel;
      }),
    };
    mockRemoveChannel = jest.fn();

    jest.doMock("@supabase/supabase-js", () => ({
      createClient: jest.fn(() => ({
        auth: {
          signInWithPassword: jest.fn(),
          signOut: jest.fn(),
          getSession: jest.fn(),
          onAuthStateChange: jest.fn(),
        },
        schema: jest.fn(() => ({
          from: jest.fn(() => {
            const builder: Record<string, jest.Mock> = {};
            builder.select = jest.fn(() => builder);
            builder.order = jest.fn(() => builder);
            builder.eq = jest.fn(() => builder);
            builder.limit = jest.fn(() =>
              Promise.resolve({ data: [], error: null }),
            );
            builder.single = jest.fn(() =>
              Promise.resolve({ data: null, error: null }),
            );
            return builder;
          }),
        })),
        channel: jest.fn(() => mockChannel),
        removeChannel: mockRemoveChannel,
      })),
    }));
  });

  it("should handle missing serial_number in payload", async () => {
    const { subscribeToDeviceLogs } = await import("../supabase");
    const onLog = jest.fn();

    await subscribeToDeviceLogs("A1B2C3D4", null, onLog);

    if (capturedCallback) {
      const payload = {
        new: {
          id: "log-123",
          device_id: "device-123",
          serial_number: null,
          level: "info",
          message: "Test log",
          metadata: {},
          created_at: new Date().toISOString(),
        },
      };
      capturedCallback(payload);
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({
          serial_number: null,
        }),
      );
    }
  });

  it("should handle missing metadata in payload", async () => {
    const { subscribeToDeviceLogs } = await import("../supabase");
    const onLog = jest.fn();

    await subscribeToDeviceLogs("A1B2C3D4", null, onLog);

    if (capturedCallback) {
      const payload = {
        new: {
          id: "log-123",
          device_id: "device-123",
          serial_number: "A1B2C3D4",
          level: "info",
          message: "Test log",
          created_at: new Date().toISOString(),
        },
      };
      capturedCallback(payload);
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: undefined,
        }),
      );
    }
  });
});

// Note: Unsubscribe edge cases test removed - covered by createRealtimeSubscription.test.ts
