/**
 * Webex Bridge Server
 *
 * WebSocket relay server that connects Webex Embedded Apps to ESP32 displays.
 * The embedded app (running in Webex) handles all Webex SDK/presence logic
 * and sends status updates through this bridge to the display.
 */

import dotenv from "dotenv";
import path from "path";
import { createLogger, format, transports } from "winston";
import { WebSocketServer } from "./websocket/ws_server";
import { MDNSService } from "./discovery/mdns_service";
import { DeviceStore } from "./storage/device_store";
import { SupabaseStore } from "./storage/supabase_store";

// Load environment variables
dotenv.config();

// Initialize logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp(),
    format.colorize(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    }),
  ),
  transports: [new transports.Console()],
});

// Global state
let wsServer: WebSocketServer | null = null;
let mdnsService: MDNSService | null = null;
let deviceStore: DeviceStore | null = null;
let supabaseStore: SupabaseStore | null = null;

async function main(): Promise<void> {
  logger.info("Starting Webex Bridge Server...");
  logger.debug(
    `Configuration: WS_PORT=${process.env.WS_PORT || "8080"}, LOG_LEVEL=${process.env.LOG_LEVEL || "info"}`,
  );

  // Initialize local device store for persistence (fallback)
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  deviceStore = new DeviceStore(dataDir, logger);
  await deviceStore.load();
  logger.info(
    `Device store initialized (${deviceStore.getDeviceCount()} devices)`,
  );

  // Initialize Supabase store for cloud device management
  supabaseStore = new SupabaseStore(logger);
  if (supabaseStore.isEnabled()) {
    logger.info(
      "Supabase cloud integration active - devices will be synced to cloud",
    );

    // Log authentication mode
    const requireAuth = process.env.REQUIRE_DEVICE_AUTH !== "false";
    if (requireAuth) {
      logger.info("Device authentication REQUIRED (REQUIRE_DEVICE_AUTH=true)");
      logger.info("  - Displays must provide valid HMAC signatures");
      logger.info("  - Apps must provide valid JWT tokens");
    } else {
      logger.warn("Device authentication DISABLED (REQUIRE_DEVICE_AUTH=false)");
      logger.warn("  - This is not recommended for production use");
    }
  }

  // Initialize WebSocket server with both stores
  const wsPort = parseInt(process.env.WS_PORT || "8080", 10);
  wsServer = new WebSocketServer(wsPort, logger, deviceStore, supabaseStore);
  wsServer.start();

  // Start mDNS advertisement
  const serviceName = process.env.MDNS_SERVICE_NAME || "webex-bridge";
  mdnsService = new MDNSService(serviceName, wsPort, logger);
  mdnsService.start();

  // Log service info for debugging
  const serviceInfo = mdnsService.getServiceInfo();
  logger.info(`Webex Bridge Server is running on port ${wsPort}`);
  logger.info(
    `mDNS service: ${serviceInfo.name}.${serviceInfo.type}.local:${serviceInfo.port}`,
  );
  logger.info(
    `ESP32 devices can discover this bridge by searching for "${serviceInfo.type}" service`,
  );
  logger.debug(`mDNS running: ${serviceInfo.running}`);

  // Handle shutdown
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function shutdown(): Promise<void> {
  logger.info("Shutting down...");

  if (wsServer) {
    await wsServer.shutdown();
  }

  if (mdnsService) {
    mdnsService.stop();
  }

  if (deviceStore) {
    await deviceStore.shutdown();
  }

  logger.info("Goodbye!");
  process.exit(0);
}

// Start the server
main().catch((error) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
