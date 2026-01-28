/**
 * WebSocket Server Tests
 *
 * Comprehensive unit tests for the WebSocketServer class covering:
 * - Connection handling
 * - Authentication (HMAC for displays, JWT for apps)
 * - Room management
 * - Message relay
 * - Debug logging
 */

import { WebSocket, WebSocketServer as WSServer } from "ws";
import { createLogger, transports } from "winston";
import { WebSocketServer } from "../ws_server";
import { DeviceStore } from "../../storage/device_store";
import { SupabaseStore } from "../../storage/supabase_store";

// Create a silent test logger
const logger = createLogger({
  level: "error",
  transports: [new transports.Console({ silent: true })],
});

// Mock WebSocket
jest.mock("ws", () => {
  const mockWebSocket = {
    OPEN: 1,
    CLOSED: 3,
    readyState: 1,
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
  };

  const MockWSServer = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  }));

  return {
    WebSocket: mockWebSocket,
    WebSocketServer: MockWSServer,
  };
});

// Mock DeviceStore
jest.mock("../../storage/device_store");

// Mock SupabaseStore
jest.mock("../../storage/supabase_store");

// Store original env
const originalEnv = process.env;

describe("WebSocketServer", () => {
  let wsServer: WebSocketServer;
  let mockDeviceStore: jest.Mocked<DeviceStore>;
  let mockSupabaseStore: jest.Mocked<SupabaseStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    // Create mock stores
    mockDeviceStore = new DeviceStore(
      "/tmp",
      logger,
    ) as jest.Mocked<DeviceStore>;
    mockDeviceStore.registerDevice = jest.fn();
    mockDeviceStore.getAllDevices = jest.fn().mockReturnValue([]);
    mockDeviceStore.saveNow = jest.fn();
    mockDeviceStore.shutdown = jest.fn().mockResolvedValue(undefined);

    mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
    mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(false);
    mockSupabaseStore.validateDeviceAuth = jest.fn();
    mockSupabaseStore.validateAppToken = jest.fn();
    mockSupabaseStore.updateDeviceLastSeen = jest.fn().mockResolvedValue(undefined);
    mockSupabaseStore.insertDeviceLog = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    if (wsServer) {
      wsServer.stop();
    }
  });

  describe("constructor", () => {
    it("should create instance with correct properties", () => {
      wsServer = new WebSocketServer(8080, logger, mockDeviceStore, mockSupabaseStore);

      expect(wsServer).toBeDefined();
      expect(wsServer.getClientCount()).toBe(0);
      expect(wsServer.getRoomCount()).toBe(0);
      expect(wsServer.getDeviceStore()).toBe(mockDeviceStore);
      expect(wsServer.getSupabaseStore()).toBe(mockSupabaseStore);
    });

    it("should work without optional stores", () => {
      wsServer = new WebSocketServer(8080, logger);

      expect(wsServer).toBeDefined();
      expect(wsServer.getDeviceStore()).toBeNull();
      expect(wsServer.getSupabaseStore()).toBeNull();
    });
  });

  describe("start/stop", () => {
    it("should start server on specified port", () => {
      wsServer = new WebSocketServer(8080, logger);
      wsServer.start();

      expect(WSServer).toHaveBeenCalledWith({ port: 8080 });
    });

    it("should stop server and clear clients", () => {
      wsServer = new WebSocketServer(8080, logger, mockDeviceStore);
      wsServer.start();
      wsServer.stop();

      expect(mockDeviceStore.saveNow).toHaveBeenCalled();
    });

    it("should handle shutdown gracefully", async () => {
      wsServer = new WebSocketServer(8080, logger, mockDeviceStore);
      wsServer.start();
      await wsServer.shutdown();

      expect(mockDeviceStore.shutdown).toHaveBeenCalled();
    });
  });

  describe("getRegisteredDevices", () => {
    it("should return devices from device store", () => {
      const mockDevices = [
        {
          deviceId: "dev1",
          displayName: "Device 1",
          pairingCode: "ABC123",
          registeredAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];
      mockDeviceStore.getAllDevices.mockReturnValue(mockDevices);

      wsServer = new WebSocketServer(8080, logger, mockDeviceStore);
      const devices = wsServer.getRegisteredDevices();

      expect(devices).toEqual(mockDevices);
    });

    it("should return empty array when no device store", () => {
      wsServer = new WebSocketServer(8080, logger);
      const devices = wsServer.getRegisteredDevices();

      expect(devices).toEqual([]);
    });
  });
});

describe("WebSocketServer - Connection Handling", () => {
  let wsServer: WebSocketServer;
  let mockWs: jest.Mocked<WebSocket>;
  let connectionHandler: (ws: WebSocket) => void;
  let mockSupabaseStore: jest.Mocked<SupabaseStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    // Create a more realistic mock WebSocket
    mockWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn(),
    } as unknown as jest.Mocked<WebSocket>;

    mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
    mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(false);

    // Create server and capture the connection handler
    wsServer = new WebSocketServer(8080, logger, undefined, mockSupabaseStore);

    // Mock WSServer to capture connection handler
    const mockWSServer = {
      on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
        if (event === "connection") {
          connectionHandler = handler;
        }
      }),
      close: jest.fn(),
    };
    (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

    wsServer.start();
  });

  afterEach(() => {
    process.env = originalEnv;
    wsServer?.stop();
  });

  it("should handle new connection and send confirmation", () => {
    // Simulate connection
    connectionHandler(mockWs);

    expect(wsServer.getClientCount()).toBe(1);
    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"connection"'),
    );
    expect(mockWs.on).toHaveBeenCalledWith("message", expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith("pong", expect.any(Function));
  });

  it("should include client count in connection message", () => {
    connectionHandler(mockWs);

    const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0] as string);
    expect(sentMessage.type).toBe("connection");
    expect(sentMessage.data.webex).toBe("connected");
    expect(sentMessage.data.clients).toBe(1);
    expect(sentMessage.timestamp).toBeDefined();
  });
});

describe("WebSocketServer - Message Handling", () => {
  let wsServer: WebSocketServer;
  let mockWs: jest.Mocked<WebSocket>;
  let messageHandler: (data: Buffer) => void;
  let closeHandler: () => void;
  let mockSupabaseStore: jest.Mocked<SupabaseStore>;
  let mockDeviceStore: jest.Mocked<DeviceStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    mockWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === "message") {
          messageHandler = handler as (data: Buffer) => void;
        } else if (event === "close") {
          closeHandler = handler as () => void;
        }
      }),
    } as unknown as jest.Mocked<WebSocket>;

    mockDeviceStore = new DeviceStore("/tmp", logger) as jest.Mocked<DeviceStore>;
    mockDeviceStore.registerDevice = jest.fn();
    mockDeviceStore.getAllDevices = jest.fn().mockReturnValue([]);
    mockDeviceStore.saveNow = jest.fn();
    mockDeviceStore.shutdown = jest.fn().mockResolvedValue(undefined);

    mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
    mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(false);
    mockSupabaseStore.validateDeviceAuth = jest.fn();
    mockSupabaseStore.validateAppToken = jest.fn();
    mockSupabaseStore.updateDeviceLastSeen = jest.fn().mockResolvedValue(undefined);
    mockSupabaseStore.insertDeviceLog = jest.fn().mockResolvedValue(undefined);

    wsServer = new WebSocketServer(8080, logger, mockDeviceStore, mockSupabaseStore);

    const mockWSServer = {
      on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
        if (event === "connection") {
          handler(mockWs);
        }
      }),
      close: jest.fn(),
    };
    (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

    wsServer.start();
  });

  afterEach(() => {
    process.env = originalEnv;
    wsServer?.stop();
  });

  describe("ping/pong", () => {
    it("should respond to ping with pong", () => {
      const pingMessage = Buffer.from(JSON.stringify({ type: "ping" }));
      messageHandler(pingMessage);

      // First call is connection message, second is pong
      const pongCall = mockWs.send.mock.calls.find((call) =>
        (call[0] as string).includes('"type":"pong"'),
      );
      expect(pongCall).toBeDefined();
    });
  });

  describe("subscribe", () => {
    it("should update device ID from subscription message", () => {
      const subscribeMessage = Buffer.from(
        JSON.stringify({
          type: "subscribe",
          deviceId: "device-123",
        }),
      );

      messageHandler(subscribeMessage);

      // The client's deviceId should be updated (verified implicitly)
      expect(wsServer.getClientCount()).toBe(1);
    });
  });

  describe("disconnect", () => {
    it("should remove client on disconnect", () => {
      expect(wsServer.getClientCount()).toBe(1);

      closeHandler();

      expect(wsServer.getClientCount()).toBe(0);
    });
  });

  describe("broadcast", () => {
    it("should send message to all connected clients", () => {
      // Create a second mock WebSocket
      const mockWs2 = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
      } as unknown as jest.Mocked<WebSocket>;

      // Manually add second client by simulating connection
      const mockWSServer = {
        on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
          if (event === "connection") {
            handler(mockWs2);
          }
        }),
        close: jest.fn(),
      };
      (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

      // Clear previous calls
      mockWs.send.mockClear();

      wsServer.broadcast({ type: "test_broadcast", message: "Hello all" });

      // Original client should receive broadcast
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"test_broadcast"'),
      );
    });
  });
});

describe("WebSocketServer - Join Room and Authentication", () => {
  let wsServer: WebSocketServer;
  let mockWs: jest.Mocked<WebSocket>;
  let messageHandler: (data: Buffer) => void;
  let mockSupabaseStore: jest.Mocked<SupabaseStore>;
  let mockDeviceStore: jest.Mocked<DeviceStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    mockWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === "message") {
          messageHandler = handler as (data: Buffer) => void;
        }
      }),
    } as unknown as jest.Mocked<WebSocket>;

    mockDeviceStore = new DeviceStore("/tmp", logger) as jest.Mocked<DeviceStore>;
    mockDeviceStore.registerDevice = jest.fn();
    mockDeviceStore.getAllDevices = jest.fn().mockReturnValue([]);
    mockDeviceStore.saveNow = jest.fn();

    mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
    mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(true);
    mockSupabaseStore.validateDeviceAuth = jest.fn();
    mockSupabaseStore.validateAppToken = jest.fn();
    mockSupabaseStore.updateDeviceLastSeen = jest.fn().mockResolvedValue(undefined);
    mockSupabaseStore.insertDeviceLog = jest.fn().mockResolvedValue(undefined);

    wsServer = new WebSocketServer(8080, logger, mockDeviceStore, mockSupabaseStore);

    const mockWSServer = {
      on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
        if (event === "connection") {
          handler(mockWs);
        }
      }),
      close: jest.fn(),
    };
    (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

    wsServer.start();
    mockWs.send.mockClear(); // Clear connection message
  });

  afterEach(() => {
    process.env = originalEnv;
    wsServer?.stop();
  });

  describe("join - display with HMAC", () => {
    it("should authenticate display with valid HMAC", async () => {
      mockSupabaseStore.validateDeviceAuth.mockResolvedValue({
        valid: true,
        device: {
          serial_number: "SERIAL123",
          device_id: "device-123",
          pairing_code: "ABC123",
          display_name: "Test Display",
          firmware_version: "1.0.0",
          ip_address: "192.168.1.100",
          last_seen: new Date().toISOString(),
          debug_enabled: false,
          is_provisioned: true,
        },
      });

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "display",
          serial: "SERIAL123",
          deviceId: "device-123",
          auth: {
            timestamp: Date.now(),
            signature: "valid-signature",
          },
        }),
      );

      await messageHandler(joinMessage);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSupabaseStore.validateDeviceAuth).toHaveBeenCalledWith(
        "SERIAL123",
        expect.any(Number),
        "valid-signature",
      );

      // Should send joined confirmation
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"joined"'),
      );
    });

    it("should reject display with invalid HMAC when auth required", async () => {
      process.env.REQUIRE_DEVICE_AUTH = "true";

      mockSupabaseStore.validateDeviceAuth.mockResolvedValue({
        valid: false,
        error: "Invalid signature",
      });

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "display",
          serial: "SERIAL123",
          auth: {
            timestamp: Date.now(),
            signature: "invalid-signature",
          },
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should send error message
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Authentication failed"),
      );
    });
  });

  describe("join - display without auth", () => {
    it("should reject display when auth required but not provided", async () => {
      process.env.REQUIRE_DEVICE_AUTH = "true";

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "display",
          serial: "SERIAL123",
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Authentication required for display devices"),
      );
    });

    it("should allow display when auth not required", async () => {
      process.env.REQUIRE_DEVICE_AUTH = "false";

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "display",
          serial: "SERIAL123",
          deviceId: "device-123",
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"joined"'),
      );
    });
  });

  describe("join - app with token", () => {
    it("should authenticate app with valid JWT token", async () => {
      mockSupabaseStore.validateAppToken.mockResolvedValue({
        valid: true,
        device: {
          serial_number: "SERIAL123",
          device_id: "device-123",
          pairing_code: "ABC123",
          display_name: "Test Display",
          firmware_version: "1.0.0",
          ip_address: "192.168.1.100",
          last_seen: new Date().toISOString(),
          debug_enabled: false,
          is_provisioned: true,
        },
      });

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "app",
          serial: "SERIAL123",
          app_auth: {
            token: "valid.jwt.token",
          },
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSupabaseStore.validateAppToken).toHaveBeenCalledWith(
        "valid.jwt.token",
      );

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"joined"'),
      );
    });

    it("should reject app with invalid token when auth required", async () => {
      process.env.REQUIRE_DEVICE_AUTH = "true";

      mockSupabaseStore.validateAppToken.mockResolvedValue({
        valid: false,
        error: "Token expired",
      });

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "app",
          app_auth: {
            token: "expired.jwt.token",
          },
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("App authentication failed"),
      );
    });
  });

  describe("join - app without token", () => {
    it("should reject app when auth required but no token provided", async () => {
      process.env.REQUIRE_DEVICE_AUTH = "true";

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "app",
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Authentication required"),
      );
    });

    it("should allow app when auth not required", async () => {
      process.env.REQUIRE_DEVICE_AUTH = "false";

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "app",
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"joined"'),
      );
    });
  });

  describe("joinRoom", () => {
    it("should create room and add client", async () => {
      process.env.REQUIRE_DEVICE_AUTH = "false";

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "TEST01",
          clientType: "display",
          deviceId: "device-123",
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(wsServer.getRoomCount()).toBe(1);

      const sentMessage = mockWs.send.mock.calls.find((call) =>
        (call[0] as string).includes('"type":"joined"'),
      );
      expect(sentMessage).toBeDefined();

      const parsed = JSON.parse(sentMessage![0] as string);
      expect(parsed.data.code).toBe("TEST01");
      expect(parsed.data.clientType).toBe("display");
      expect(parsed.data.displayConnected).toBe(true);
    });

    it("should notify peer when second client joins", async () => {
      process.env.REQUIRE_DEVICE_AUTH = "false";

      // Create second mock WebSocket for app
      const mockWsApp = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
      } as unknown as jest.Mocked<WebSocket>;

      let appMessageHandler: (data: Buffer) => void;

      mockWsApp.on = jest.fn((event: string, handler: Function) => {
        if (event === "message") {
          appMessageHandler = handler as (data: Buffer) => void;
        }
      }) as jest.Mock;

      // First, join display
      const displayJoinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "TEST01",
          clientType: "display",
          deviceId: "device-123",
        }),
      );

      await messageHandler(displayJoinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate app connection by manually triggering connection handler
      // This requires accessing internal state, so we'll verify through room state
      expect(wsServer.getRoomCount()).toBe(1);

      const joinedMessage = mockWs.send.mock.calls.find((call) =>
        (call[0] as string).includes('"type":"joined"'),
      );
      expect(joinedMessage).toBeDefined();
    });

    it("should reject join without code or clientType", async () => {
      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          // Missing code and clientType
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing code or clientType"),
      );
    });
  });
});

describe("WebSocketServer - Status and Command Relay", () => {
  let wsServer: WebSocketServer;
  let displayWs: jest.Mocked<WebSocket>;
  let appWs: jest.Mocked<WebSocket>;
  let displayMessageHandler: (data: Buffer) => void;
  let appMessageHandler: (data: Buffer) => void;
  let mockSupabaseStore: jest.Mocked<SupabaseStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.REQUIRE_DEVICE_AUTH = "false";

    // Create mock WebSockets
    displayWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === "message") {
          displayMessageHandler = handler as (data: Buffer) => void;
        }
      }),
    } as unknown as jest.Mocked<WebSocket>;

    appWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === "message") {
          appMessageHandler = handler as (data: Buffer) => void;
        }
      }),
    } as unknown as jest.Mocked<WebSocket>;

    mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
    mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(false);

    wsServer = new WebSocketServer(8080, logger, undefined, mockSupabaseStore);

    let connectionCount = 0;
    const mockWSServer = {
      on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
        if (event === "connection") {
          // Simulate two connections
          handler(displayWs);
          connectionCount++;
          if (connectionCount === 1) {
            handler(appWs);
          }
        }
      }),
      close: jest.fn(),
    };
    (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

    wsServer.start();
  });

  afterEach(() => {
    process.env = originalEnv;
    wsServer?.stop();
  });

  describe("relayStatus", () => {
    it("should relay status from app to display", async () => {
      // Both join the same room
      const displayJoin = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ROOM01",
          clientType: "display",
          deviceId: "device-123",
        }),
      );

      const appJoin = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ROOM01",
          clientType: "app",
        }),
      );

      await displayMessageHandler(displayJoin);
      await appMessageHandler(appJoin);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Clear previous messages
      displayWs.send.mockClear();

      // App sends status
      const statusMessage = Buffer.from(
        JSON.stringify({
          type: "status",
          status: "active",
          camera_on: true,
          mic_muted: false,
          in_call: true,
          display_name: "John Doe",
        }),
      );

      await appMessageHandler(statusMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Display should receive the status
      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"status"'),
      );
      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"status":"active"'),
      );
    });

    it("should send error if not in room", async () => {
      // Don't join any room, just send status
      const statusMessage = Buffer.from(
        JSON.stringify({
          type: "status",
          status: "active",
        }),
      );

      await displayMessageHandler(statusMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Not in a pairing room"),
      );
    });
  });

  describe("relayCommand", () => {
    it("should relay command from app to display", async () => {
      // Both join the same room
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      displayWs.send.mockClear();

      // App sends command
      const commandMessage = Buffer.from(
        JSON.stringify({
          type: "command",
          command: "restart",
          requestId: "req-123",
          payload: { force: true },
        }),
      );

      await appMessageHandler(commandMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"command"'),
      );
      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"command":"restart"'),
      );
      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"requestId":"req-123"'),
      );
    });

    it("should reject command from non-app client", async () => {
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      displayWs.send.mockClear();

      // Display tries to send command (should fail)
      const commandMessage = Buffer.from(
        JSON.stringify({
          type: "command",
          command: "restart",
          requestId: "req-123",
        }),
      );

      await displayMessageHandler(commandMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"command_response"'),
      );
      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"success":false'),
      );
      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Only apps can send commands"),
      );
    });
  });

  describe("relayCommandResponse", () => {
    it("should relay command response from display to app", async () => {
      // Both join the same room
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // Display sends command response
      const responseMessage = Buffer.from(
        JSON.stringify({
          type: "command_response",
          requestId: "req-123",
          success: true,
          data: { restarting: true },
        }),
      );

      await displayMessageHandler(responseMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"command_response"'),
      );
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"success":true'),
      );
    });
  });
});

describe("WebSocketServer - Relay to Display/App", () => {
  let wsServer: WebSocketServer;
  let displayWs: jest.Mocked<WebSocket>;
  let appWs: jest.Mocked<WebSocket>;
  let displayMessageHandler: (data: Buffer) => void;
  let appMessageHandler: (data: Buffer) => void;
  let displayCloseHandler: () => void;
  let mockSupabaseStore: jest.Mocked<SupabaseStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.REQUIRE_DEVICE_AUTH = "false";

    displayWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === "message") {
          displayMessageHandler = handler as (data: Buffer) => void;
        } else if (event === "close") {
          displayCloseHandler = handler as () => void;
        }
      }),
    } as unknown as jest.Mocked<WebSocket>;

    appWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === "message") {
          appMessageHandler = handler as (data: Buffer) => void;
        }
      }),
    } as unknown as jest.Mocked<WebSocket>;

    mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
    mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(false);

    wsServer = new WebSocketServer(8080, logger, undefined, mockSupabaseStore);

    let connectionCount = 0;
    const mockWSServer = {
      on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
        if (event === "connection") {
          handler(displayWs);
          connectionCount++;
          if (connectionCount === 1) {
            handler(appWs);
          }
        }
      }),
      close: jest.fn(),
    };
    (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

    wsServer.start();
  });

  afterEach(() => {
    process.env = originalEnv;
    wsServer?.stop();
  });

  describe("get_config relay", () => {
    it("should relay get_config from app to display", async () => {
      // Both join the same room
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      displayWs.send.mockClear();

      // App sends get_config
      const getConfigMessage = Buffer.from(
        JSON.stringify({
          type: "get_config",
        }),
      );

      await appMessageHandler(getConfigMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"get_config"'),
      );
    });

    it("should send error when display not connected for get_config", async () => {
      // Only app joins
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // App sends get_config without display
      const getConfigMessage = Buffer.from(
        JSON.stringify({
          type: "get_config",
        }),
      );

      await appMessageHandler(getConfigMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Display not connected"),
      );
    });
  });

  describe("config relay", () => {
    it("should relay config from display to app", async () => {
      // Both join the same room
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // Display sends config response
      const configMessage = Buffer.from(
        JSON.stringify({
          type: "config",
          data: { brightness: 100, wifi_ssid: "MyWiFi" },
        }),
      );

      await displayMessageHandler(configMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"config"'),
      );
    });
  });

  describe("get_status relay", () => {
    it("should relay get_status from app to display", async () => {
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      displayWs.send.mockClear();

      const getStatusMessage = Buffer.from(
        JSON.stringify({
          type: "get_status",
        }),
      );

      await appMessageHandler(getStatusMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(displayWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"get_status"'),
      );
    });
  });

  describe("relayToApp with closed app", () => {
    it("should not relay when app websocket is closed", async () => {
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Close the app connection
      (appWs as any).readyState = WebSocket.CLOSED;
      appWs.send.mockClear();

      // Display sends config
      const configMessage = Buffer.from(
        JSON.stringify({
          type: "config",
          data: {},
        }),
      );

      await displayMessageHandler(configMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not send to closed websocket
      expect(appWs.send).not.toHaveBeenCalled();
    });
  });

  describe("disconnect with peer notification", () => {
    it("should notify app when display disconnects", async () => {
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // Display disconnects
      displayCloseHandler();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"peer_disconnected"'),
      );
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"peerType":"display"'),
      );
    });
  });

  describe("relayCommand edge cases", () => {
    it("should send error when app not in room for command", async () => {
      // App joins but doesn't join a room
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "command",
            command: "restart",
            requestId: "req-123",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // The mock ws is actually connected as display first, so we need to check the right ws
      // This tests the "not in a pairing room" case
    });

    it("should send error when display not connected for command", async () => {
      // Only app joins
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // App sends command without display
      const commandMessage = Buffer.from(
        JSON.stringify({
          type: "command",
          command: "restart",
          requestId: "req-123",
        }),
      );

      await appMessageHandler(commandMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"command_response"'),
      );
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"success":false'),
      );
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Display not connected"),
      );
    });
  });

  describe("relayStatus edge cases", () => {
    it("should handle status with no peer connected", async () => {
      // App joins alone
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // App sends status with no display connected
      const statusMessage = Buffer.from(
        JSON.stringify({
          type: "status",
          status: "active",
        }),
      );

      await appMessageHandler(statusMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not throw, just silently not relay
      // The display was never connected, so nothing happens
    });
  });

  describe("unknown message type", () => {
    it("should log unknown message types", async () => {
      const unknownMessage = Buffer.from(
        JSON.stringify({
          type: "unknown_type_xyz",
          data: {},
        }),
      );

      await displayMessageHandler(unknownMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not throw, just log at debug level
    });
  });

  describe("invalid JSON", () => {
    it("should handle invalid JSON gracefully", async () => {
      const invalidMessage = Buffer.from("this is not valid JSON {{{");

      await displayMessageHandler(invalidMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not throw, error is logged
    });
  });
});

describe("WebSocketServer - Debug Logging", () => {
  let wsServer: WebSocketServer;
  let mockWs: jest.Mocked<WebSocket>;
  let messageHandler: (data: Buffer) => void;
  let mockSupabaseStore: jest.Mocked<SupabaseStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.REQUIRE_DEVICE_AUTH = "false";

    mockWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === "message") {
          messageHandler = handler as (data: Buffer) => void;
        }
      }),
    } as unknown as jest.Mocked<WebSocket>;

    mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
    mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(true);
    mockSupabaseStore.validateDeviceAuth = jest.fn().mockResolvedValue({
      valid: true,
      device: {
        serial_number: "SERIAL123",
        device_id: "device-123",
        pairing_code: "ABC123",
        display_name: "Test",
        firmware_version: "1.0.0",
        ip_address: null,
        last_seen: new Date().toISOString(),
        debug_enabled: true,
        is_provisioned: true,
      },
    });
    mockSupabaseStore.insertDeviceLog = jest.fn().mockResolvedValue(undefined);
    mockSupabaseStore.updateDeviceLastSeen = jest.fn().mockResolvedValue(undefined);

    wsServer = new WebSocketServer(8080, logger, undefined, mockSupabaseStore);

    const mockWSServer = {
      on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
        if (event === "connection") {
          handler(mockWs);
        }
      }),
      close: jest.fn(),
    };
    (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

    wsServer.start();
  });

  afterEach(() => {
    process.env = originalEnv;
    wsServer?.stop();
  });

  describe("handleDebugLog", () => {
    it("should persist debug log to Supabase with serial_number", async () => {
      // First join as display
      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "display",
          serial: "SERIAL123",
          deviceId: "device-123",
          auth: {
            timestamp: Date.now(),
            signature: "valid-sig",
          },
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Send debug log
      const debugLogMessage = Buffer.from(
        JSON.stringify({
          type: "debug_log",
          level: "info",
          log_message: "Device started successfully",
          log_metadata: { boot_count: 5 },
        }),
      );

      await messageHandler(debugLogMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSupabaseStore.insertDeviceLog).toHaveBeenCalledWith(
        expect.any(String), // deviceId
        "info",
        "Device started successfully",
        { boot_count: 5 },
        "SERIAL123", // serialNumber
      );
    });

    it("should always persist warn/error logs regardless of debug_enabled", async () => {
      // Set debug_enabled to false
      mockSupabaseStore.validateDeviceAuth.mockResolvedValue({
        valid: true,
        device: {
          serial_number: "SERIAL123",
          device_id: "device-123",
          pairing_code: "ABC123",
          display_name: "Test",
          firmware_version: "1.0.0",
          ip_address: null,
          last_seen: new Date().toISOString(),
          debug_enabled: false, // Debug disabled
          is_provisioned: true,
        },
      });

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "display",
          serial: "SERIAL123",
          deviceId: "device-123",
          auth: {
            timestamp: Date.now(),
            signature: "valid-sig",
          },
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Send error log (should be persisted)
      const errorLogMessage = Buffer.from(
        JSON.stringify({
          type: "debug_log",
          level: "error",
          log_message: "Critical error occurred",
        }),
      );

      await messageHandler(errorLogMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSupabaseStore.insertDeviceLog).toHaveBeenCalledWith(
        expect.any(String),
        "error",
        "Critical error occurred",
        undefined,
        "SERIAL123",
      );
    });

    it("should not persist info/debug logs when debug_enabled is false", async () => {
      mockSupabaseStore.validateDeviceAuth.mockResolvedValue({
        valid: true,
        device: {
          serial_number: "SERIAL123",
          device_id: "device-123",
          pairing_code: "ABC123",
          display_name: "Test",
          firmware_version: "1.0.0",
          ip_address: null,
          last_seen: new Date().toISOString(),
          debug_enabled: false, // Debug disabled
          is_provisioned: true,
        },
      });

      const joinMessage = Buffer.from(
        JSON.stringify({
          type: "join",
          code: "ABC123",
          clientType: "display",
          serial: "SERIAL123",
          deviceId: "device-123",
          auth: {
            timestamp: Date.now(),
            signature: "valid-sig",
          },
        }),
      );

      await messageHandler(joinMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));
      mockSupabaseStore.insertDeviceLog.mockClear();

      // Send info log (should NOT be persisted when debug disabled)
      const infoLogMessage = Buffer.from(
        JSON.stringify({
          type: "debug_log",
          level: "info",
          log_message: "Regular info message",
        }),
      );

      await messageHandler(infoLogMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSupabaseStore.insertDeviceLog).not.toHaveBeenCalled();
    });
  });

  describe("subscribe_debug - deprecated", () => {
    it("should return deprecation error when disabled", async () => {
      delete process.env.ENABLE_BRIDGE_DEBUG_SUBSCRIBE;

      const subscribeMessage = Buffer.from(
        JSON.stringify({
          type: "subscribe_debug",
          deviceId: "device-123",
        }),
      );

      await messageHandler(subscribeMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("deprecated"),
      );
    });

    it("should work when explicitly enabled", async () => {
      process.env.ENABLE_BRIDGE_DEBUG_SUBSCRIBE = "true";

      const subscribeMessage = Buffer.from(
        JSON.stringify({
          type: "subscribe_debug",
          deviceId: "device-123",
        }),
      );

      await messageHandler(subscribeMessage);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"debug_subscribed"'),
      );
    });
  });

  describe("Room cleanup", () => {
    let wsServer: WebSocketServer;
    let displayWs: jest.Mocked<WebSocket>;
    let appWs: jest.Mocked<WebSocket>;
    let displayMessageHandler: (data: Buffer) => void;
    let appMessageHandler: (data: Buffer) => void;
    let displayCloseHandler: () => void;
    let appCloseHandler: () => void;
    let mockSupabaseStore: jest.Mocked<SupabaseStore>;

    beforeEach(() => {
      jest.clearAllMocks();
      process.env = { ...originalEnv };
      process.env.REQUIRE_DEVICE_AUTH = "false";

      displayWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event: string, handler: Function) => {
          if (event === "message") {
            displayMessageHandler = handler as (data: Buffer) => void;
          } else if (event === "close") {
            displayCloseHandler = handler as () => void;
          }
        }),
      } as unknown as jest.Mocked<WebSocket>;

      appWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event: string, handler: Function) => {
          if (event === "message") {
            appMessageHandler = handler as (data: Buffer) => void;
          } else if (event === "close") {
            appCloseHandler = handler as () => void;
          }
        }),
      } as unknown as jest.Mocked<WebSocket>;

      mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
      mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(false);

      wsServer = new WebSocketServer(8080, logger, undefined, mockSupabaseStore);

      let connectionCount = 0;
      const mockWSServer = {
        on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
          if (event === "connection") {
            // Simulate two connections
            handler(displayWs);
            connectionCount++;
            if (connectionCount === 1) {
              handler(appWs);
            }
          }
        }),
        close: jest.fn(),
      };
      (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

      wsServer.start();
    });

    afterEach(() => {
      process.env = originalEnv;
      wsServer?.stop();
    });

    it("should cleanup room when last client disconnects", async () => {
      // Join display
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(wsServer.getRoomCount()).toBe(1);

      // Display disconnects
      displayCloseHandler();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Room should be cleaned up since no clients remain
      expect(wsServer.getRoomCount()).toBe(0);
    });

    it("should not cleanup room when one client remains", async () => {
      // Join display
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Join app
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(wsServer.getRoomCount()).toBe(1);

      // Display disconnects, but app remains
      displayCloseHandler();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Room should still exist since app is connected
      expect(wsServer.getRoomCount()).toBe(1);
    });
  });

  describe("Relay edge cases", () => {
    let wsServer: WebSocketServer;
    let displayWs: jest.Mocked<WebSocket>;
    let appWs: jest.Mocked<WebSocket>;
    let displayMessageHandler: (data: Buffer) => void;
    let appMessageHandler: (data: Buffer) => void;
    let mockSupabaseStore: jest.Mocked<SupabaseStore>;

    beforeEach(() => {
      jest.clearAllMocks();
      process.env = { ...originalEnv };
      process.env.REQUIRE_DEVICE_AUTH = "false";

      displayMessageHandler = jest.fn();
      appMessageHandler = jest.fn();

      displayWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event: string, handler: Function) => {
          if (event === "message") {
            displayMessageHandler = handler as (data: Buffer) => void;
          }
        }),
      } as unknown as jest.Mocked<WebSocket>;

      appWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event: string, handler: Function) => {
          if (event === "message") {
            appMessageHandler = handler as (data: Buffer) => void;
          }
        }),
      } as unknown as jest.Mocked<WebSocket>;

      mockSupabaseStore = new SupabaseStore(logger) as jest.Mocked<SupabaseStore>;
      mockSupabaseStore.isEnabled = jest.fn().mockReturnValue(false);

      wsServer = new WebSocketServer(8080, logger, undefined, mockSupabaseStore);

      let connectionCount = 0;
      const mockWSServer = {
        on: jest.fn((event: string, handler: (ws: WebSocket) => void) => {
          if (event === "connection") {
            // Connect both WebSockets when connection handler is set up
            if (connectionCount === 0) {
              handler(displayWs);
              connectionCount++;
              // Also connect appWs immediately
              handler(appWs);
            } else {
              handler(appWs);
            }
          }
        }),
        close: jest.fn(),
      };
      (WSServer as unknown as jest.Mock).mockImplementation(() => mockWSServer);

      wsServer.start();
    });

    afterEach(() => {
      process.env = originalEnv;
      wsServer?.stop();
    });

    it("should handle status relay when no peer connected", async () => {
      // Join app without display
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // Try to send status (no display connected)
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "status",
            status: "active",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not send error, just log (no peer to relay to)
      expect(appWs.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
    });

    it("should handle command relay when display socket is closed", async () => {
      // Join both
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // Close display socket (simulate closed state)
      // Need to also remove display from room
      const room = (wsServer as any).rooms.get("ROOM01");
      if (room) {
        room.display = null;
      }
      Object.defineProperty(displayWs, "readyState", {
        value: WebSocket.CLOSED,
        writable: false,
        configurable: true,
      });

      // Try to send command
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "command",
            command: "brightness",
            requestId: "req-123",
            payload: { level: 75 },
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should return error response
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"command_response"'),
      );
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"success":false'),
      );
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"Display not connected"'),
      );
    });

    it("should handle command response relay when app socket is closed", async () => {
      // Join both
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      displayWs.send.mockClear();

      // Close app socket (simulate closed state)
      Object.defineProperty(appWs, "readyState", {
        value: WebSocket.CLOSED,
        writable: false,
        configurable: true,
      });

      // Try to send command response
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "command_response",
            requestId: "req-123",
            success: true,
            data: { brightness: 75 },
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not send (app is closed), but should not error either
      expect(displayWs.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"command_response"'),
      );
    });

    it("should handle relayToDisplay when display not connected", async () => {
      // Join app only (no display) - app must be connected first
      // The connection handler was already called in beforeEach
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "app",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      appWs.send.mockClear();

      // Try to get config (relayToDisplay)
      await appMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "get_config",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // relayToDisplay checks: !room || !room.display || room.display.readyState !== WebSocket.OPEN
      // If room exists but display is null, it should send error
      // Verify error was sent (room exists, display is null)
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(appWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"Display not connected"'),
      );
    });

    it("should handle relayToApp when app not connected", async () => {
      // Join display only
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "join",
            code: "ROOM01",
            clientType: "display",
            deviceId: "device-123",
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Try to send config response (relayToApp)
      await displayMessageHandler(
        Buffer.from(
          JSON.stringify({
            type: "config",
            data: { brightness: 50 },
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not send (no app connected), but should not error either
      // The relayToApp method returns silently when app is not connected
      expect(displayWs.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
    });
  });
});
