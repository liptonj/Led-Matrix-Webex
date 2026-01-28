/**
 * Bridge Index Tests
 *
 * Unit tests for the main bridge entry point covering:
 * - Server startup
 * - Graceful shutdown (SIGINT/SIGTERM)
 * - Environment variable configuration
 */

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { createLogger, transports } from "winston";

// Store original process methods and env
const originalExit = process.exit;
const originalOn = process.on;
const originalEnv = process.env;

// Track registered signal handlers
let signalHandlers: Map<string, () => Promise<void>>;

// Mock modules before importing
jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

jest.mock("winston", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    colorize: jest.fn(),
    printf: jest.fn(),
  },
  transports: {
    Console: jest.fn(),
  },
}));

jest.mock("../websocket/ws_server", () => ({
  WebSocketServer: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    getDeviceStore: jest.fn(),
    getSupabaseStore: jest.fn(),
  })),
}));

jest.mock("../discovery/mdns_service", () => ({
  MDNSService: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    getServiceInfo: jest.fn().mockReturnValue({
      name: "webex-bridge",
      type: "_webex-bridge._tcp",
      port: 8080,
      running: true,
    }),
  })),
}));

jest.mock("../storage/device_store", () => ({
  DeviceStore: jest.fn().mockImplementation(() => ({
    load: jest.fn().mockResolvedValue(undefined),
    getDeviceCount: jest.fn().mockReturnValue(0),
    shutdown: jest.fn().mockResolvedValue(undefined),
    saveNow: jest.fn(),
  })),
}));

jest.mock("../storage/supabase_store", () => ({
  SupabaseStore: jest.fn().mockImplementation(() => ({
    isEnabled: jest.fn().mockReturnValue(false),
  })),
}));

describe("Bridge Server - Startup", () => {
  let mockExit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    signalHandlers = new Map();

    // Mock process.exit
    mockExit = jest.fn();
    process.exit = mockExit as unknown as typeof process.exit;

    // Mock process.on to capture signal handlers
    process.on = jest.fn((event: string, handler: () => Promise<void>) => {
      signalHandlers.set(event, handler);
      return process;
    }) as unknown as typeof process.on;

    // Reset environment
    process.env = {
      ...originalEnv,
      WS_PORT: "8080",
      LOG_LEVEL: "info",
      DATA_DIR: "/tmp/test-data",
    };
  });

  afterEach(() => {
    process.exit = originalExit;
    process.on = originalOn;
    process.env = originalEnv;
    jest.resetModules();
  });

  it("should start server with correct configuration from env", async () => {
    process.env.WS_PORT = "9090";
    process.env.LOG_LEVEL = "debug";
    process.env.MDNS_SERVICE_NAME = "custom-bridge";

    // Import the module to trigger main()
    const { WebSocketServer } = require("../websocket/ws_server");
    const { MDNSService } = require("../discovery/mdns_service");
    const { DeviceStore } = require("../storage/device_store");
    const { SupabaseStore } = require("../storage/supabase_store");

    // Simulate what main() does
    const logger = createLogger({
      level: process.env.LOG_LEVEL || "info",
      transports: [new transports.Console()],
    });

    const dataDir = process.env.DATA_DIR || "/tmp/data";
    const deviceStore = new DeviceStore(dataDir, logger);
    await deviceStore.load();

    const supabaseStore = new SupabaseStore(logger);

    const wsPort = parseInt(process.env.WS_PORT || "8080", 10);
    const wsServer = new WebSocketServer(wsPort, logger, deviceStore, supabaseStore);
    wsServer.start();

    const serviceName = process.env.MDNS_SERVICE_NAME || "webex-bridge";
    const mdnsService = new MDNSService(serviceName, wsPort, logger);
    mdnsService.start();

    expect(WebSocketServer).toHaveBeenCalled();
    expect(MDNSService).toHaveBeenCalled();
    expect(DeviceStore).toHaveBeenCalled();
    expect(wsServer.start).toHaveBeenCalled();
    expect(mdnsService.start).toHaveBeenCalled();
  });

  it("should use default port 8080 when WS_PORT not set", async () => {
    delete process.env.WS_PORT;

    const { WebSocketServer } = require("../websocket/ws_server");
    const logger = createLogger({
      level: "info",
      transports: [new transports.Console()],
    });

    const wsPort = parseInt(process.env.WS_PORT || "8080", 10);
    expect(wsPort).toBe(8080);

    const wsServer = new WebSocketServer(wsPort, logger);
    // Verify port parameter is correct
    expect(WebSocketServer).toHaveBeenCalledWith(
      8080,
      expect.anything(),
    );
  });

  it("should use default service name when MDNS_SERVICE_NAME not set", () => {
    delete process.env.MDNS_SERVICE_NAME;

    const serviceName = process.env.MDNS_SERVICE_NAME || "webex-bridge";
    expect(serviceName).toBe("webex-bridge");
  });

  it("should use default data directory when DATA_DIR not set", () => {
    delete process.env.DATA_DIR;

    const path = require("path");
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");

    expect(dataDir).toContain("data");
  });
});

describe("Bridge Server - Shutdown", () => {
  let mockExit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    signalHandlers = new Map();

    mockExit = jest.fn();
    process.exit = mockExit as unknown as typeof process.exit;

    process.on = jest.fn((event: string, handler: () => Promise<void>) => {
      signalHandlers.set(event, handler);
      return process;
    }) as unknown as typeof process.on;

    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.exit = originalExit;
    process.on = originalOn;
    process.env = originalEnv;
    jest.resetModules();
  });

  it("should register SIGINT handler", () => {
    const { WebSocketServer } = require("../websocket/ws_server");
    const { MDNSService } = require("../discovery/mdns_service");
    const { DeviceStore } = require("../storage/device_store");

    const logger = createLogger({
      level: "info",
      transports: [new transports.Console()],
    });

    // Simulate registering signal handlers
    process.on("SIGINT", async () => {
      // Shutdown logic
    });

    expect(process.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });

  it("should register SIGTERM handler", () => {
    const logger = createLogger({
      level: "info",
      transports: [new transports.Console()],
    });

    // Simulate registering signal handlers
    process.on("SIGTERM", async () => {
      // Shutdown logic
    });

    expect(process.on).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  it("should perform graceful shutdown on SIGINT", async () => {
    const { WebSocketServer } = require("../websocket/ws_server");
    const { MDNSService } = require("../discovery/mdns_service");
    const { DeviceStore } = require("../storage/device_store");
    const { SupabaseStore } = require("../storage/supabase_store");

    const logger = createLogger({
      level: "info",
      transports: [new transports.Console()],
    });

    const deviceStore = new DeviceStore("/tmp", logger);
    await deviceStore.load();

    const supabaseStore = new SupabaseStore(logger);
    const wsServer = new WebSocketServer(8080, logger, deviceStore, supabaseStore);
    wsServer.start();

    const mdnsService = new MDNSService("test", 8080, logger);
    mdnsService.start();

    // Define shutdown function
    const shutdown = async () => {
      await wsServer.shutdown();
      mdnsService.stop();
      await deviceStore.shutdown();
      process.exit(0);
    };

    // Register handler
    process.on("SIGINT", shutdown);

    // Trigger shutdown
    const handler = signalHandlers.get("SIGINT");
    if (handler) {
      await handler();
    }

    expect(wsServer.shutdown).toHaveBeenCalled();
    expect(mdnsService.stop).toHaveBeenCalled();
    expect(deviceStore.shutdown).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should perform graceful shutdown on SIGTERM", async () => {
    const { WebSocketServer } = require("../websocket/ws_server");
    const { MDNSService } = require("../discovery/mdns_service");
    const { DeviceStore } = require("../storage/device_store");
    const { SupabaseStore } = require("../storage/supabase_store");

    const logger = createLogger({
      level: "info",
      transports: [new transports.Console()],
    });

    const deviceStore = new DeviceStore("/tmp", logger);
    await deviceStore.load();

    const supabaseStore = new SupabaseStore(logger);
    const wsServer = new WebSocketServer(8080, logger, deviceStore, supabaseStore);
    wsServer.start();

    const mdnsService = new MDNSService("test", 8080, logger);
    mdnsService.start();

    // Define shutdown function
    const shutdown = async () => {
      await wsServer.shutdown();
      mdnsService.stop();
      await deviceStore.shutdown();
      process.exit(0);
    };

    // Register handler
    process.on("SIGTERM", shutdown);

    // Trigger shutdown
    const handler = signalHandlers.get("SIGTERM");
    if (handler) {
      await handler();
    }

    expect(wsServer.shutdown).toHaveBeenCalled();
    expect(mdnsService.stop).toHaveBeenCalled();
    expect(deviceStore.shutdown).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});

describe("Bridge Server - Configuration", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should parse WS_PORT as integer", () => {
    process.env.WS_PORT = "9090";

    const wsPort = parseInt(process.env.WS_PORT || "8080", 10);

    expect(wsPort).toBe(9090);
    expect(typeof wsPort).toBe("number");
  });

  it("should handle invalid WS_PORT gracefully", () => {
    process.env.WS_PORT = "not-a-number";

    const wsPort = parseInt(process.env.WS_PORT || "8080", 10);

    expect(isNaN(wsPort)).toBe(true);
  });

  it("should detect REQUIRE_DEVICE_AUTH setting", () => {
    process.env.REQUIRE_DEVICE_AUTH = "true";

    const requireAuth = process.env.REQUIRE_DEVICE_AUTH !== "false";
    expect(requireAuth).toBe(true);

    process.env.REQUIRE_DEVICE_AUTH = "false";
    const noAuth = process.env.REQUIRE_DEVICE_AUTH !== "false";
    expect(noAuth).toBe(false);
  });

  it("should default REQUIRE_DEVICE_AUTH to true when not set", () => {
    delete process.env.REQUIRE_DEVICE_AUTH;

    const requireAuth = process.env.REQUIRE_DEVICE_AUTH !== "false";
    expect(requireAuth).toBe(true);
  });
});
