/**
 * WebSocket Server
 *
 * Handles WebSocket connections from ESP32 devices and Webex Embedded Apps.
 * Supports pairing rooms for real-time status sync between apps and displays.
 */

import { WebSocketServer as WSServer, WebSocket } from "ws";
import { Logger } from "winston";
import { DeviceStore, RegisteredDevice } from "../storage/device_store";
import { SupabaseStore } from "../storage/supabase_store";

interface Message {
  type: string;
  data?: Record<string, unknown>;
  timestamp?: string;
  deviceId?: string;
  message?: string;
  code?: string;
  clientType?: "display" | "app";
  status?: string;
  camera_on?: boolean;
  mic_muted?: boolean;
  in_call?: boolean;
  display_name?: string;
  // Device registration fields
  serial?: string;
  firmware_version?: string;
  ip_address?: string;
  // HMAC authentication fields (for displays)
  auth?: {
    timestamp: number;
    signature: string;
  };
  // App token authentication fields (for embedded apps)
  app_auth?: {
    token: string;
  };
  // Command relay fields
  command?: string;
  requestId?: string;
  payload?: Record<string, unknown>;
  success?: boolean;
  error?: string;
  // Debug log fields
  level?: "debug" | "info" | "warn" | "error";
  log_message?: string;
  log_metadata?: Record<string, unknown>;
}

interface Client {
  ws: WebSocket;
  deviceId: string;
  serialNumber?: string;
  connectedAt: Date;
  pairingCode?: string;
  clientType?: "display" | "app";
  authenticated: boolean;
  debugEnabled: boolean;
}

interface PairingRoom {
  code: string;
  display: WebSocket | null;
  app: WebSocket | null;
  createdAt: Date;
  lastActivity: Date;
}

export class WebSocketServer {
  private port: number;
  private logger: Logger;
  private server: WSServer | null = null;
  private clients: Map<WebSocket, Client> = new Map();
  private rooms: Map<string, PairingRoom> = new Map();
  private deviceStore: DeviceStore | null = null;
  private supabaseStore: SupabaseStore | null = null;
  private debugSubscribers: Map<string, Set<WebSocket>> = new Map();

  constructor(
    port: number,
    logger: Logger,
    deviceStore?: DeviceStore,
    supabaseStore?: SupabaseStore,
  ) {
    this.port = port;
    this.logger = logger;
    this.deviceStore = deviceStore || null;
    this.supabaseStore = supabaseStore || null;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getDeviceStore(): DeviceStore | null {
    return this.deviceStore;
  }

  /**
   * Get all registered devices
   */
  getRegisteredDevices(): RegisteredDevice[] {
    return this.deviceStore?.getAllDevices() || [];
  }

  start(): void {
    this.server = new WSServer({ port: this.port });

    this.server.on("connection", (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.server.on("error", (error) => {
      this.logger.error(`WebSocket server error: ${error}`);
    });

    this.logger.info(`WebSocket server started on port ${this.port}`);
    this.logger.debug(
      `WebSocket server listening on ws://0.0.0.0:${this.port}`,
    );
  }

  stop(): void {
    if (this.server) {
      // Close all client connections
      for (const [ws] of this.clients) {
        ws.close();
      }
      this.clients.clear();

      this.server.close();
      this.server = null;
      this.logger.info("WebSocket server stopped");
    }

    // Save device store
    if (this.deviceStore) {
      this.deviceStore.saveNow();
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
    if (this.deviceStore) {
      await this.deviceStore.shutdown();
    }
  }

  broadcast(message: Message): void {
    const data = JSON.stringify(message);

    for (const [ws, client] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
        this.logger.debug(`Sent to ${client.deviceId}: ${message.type}`);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  private handleConnection(ws: WebSocket): void {
    const clientId = `client-${Date.now()}`;
    this.logger.info(`New connection: ${clientId}`);
    this.logger.debug(
      `Client ${clientId} connected, total clients: ${this.clients.size + 1}`,
    );

    // Initialize client with temporary ID
    const client: Client = {
      ws,
      deviceId: clientId,
      connectedAt: new Date(),
      authenticated: false,
      debugEnabled: false,
    };
    this.clients.set(ws, client);

    // Send connection confirmation
    const connectionMsg = {
      type: "connection",
      data: {
        webex: "connected",
        clients: this.clients.size,
      },
      timestamp: new Date().toISOString(),
    };
    this.logger.debug(
      `[${clientId}] Sending: ${JSON.stringify(connectionMsg)}`,
    );
    this.sendMessage(ws, connectionMsg);

    // Handle messages
    ws.on("message", (data: Buffer) => {
      // Handle async message processing
      this.handleMessage(ws, data.toString()).catch((error) => {
        this.logger.error(`Error handling message: ${error}`);
      });
    });

    // Handle disconnect
    ws.on("close", () => {
      const client = this.clients.get(ws);
      if (client) {
        this.logger.info(`Client disconnected: ${client.deviceId}`);
        this.logger.debug(
          `[${client.deviceId}] Disconnect - type=${client.clientType} room=${client.pairingCode}`,
        );

        // Clean up pairing room
        if (client.pairingCode) {
          const room = this.rooms.get(client.pairingCode);
          if (room) {
            if (client.clientType === "display") {
              room.display = null;
              // Notify app that display disconnected
              if (room.app && room.app.readyState === WebSocket.OPEN) {
                this.sendMessage(room.app, {
                  type: "peer_disconnected",
                  data: { peerType: "display" },
                  timestamp: new Date().toISOString(),
                });
              }
            } else if (client.clientType === "app") {
              room.app = null;
              // Notify display that app disconnected
              if (room.display && room.display.readyState === WebSocket.OPEN) {
                this.sendMessage(room.display, {
                  type: "peer_disconnected",
                  data: { peerType: "app" },
                  timestamp: new Date().toISOString(),
                });
              }
            }
            // Clean up empty room
            this.cleanupRoom(client.pairingCode);
          }
        }

        this.clients.delete(ws);
      }
    });

    // Handle errors
    ws.on("error", (error) => {
      this.logger.error(`WebSocket error for ${clientId}: ${error}`);
    });

    // Setup ping/pong for keepalive
    ws.on("pong", () => {
      // Client responded to ping
    });
  }

  private async handleMessage(ws: WebSocket, data: string): Promise<void> {
    const client = this.clients.get(ws);
    const clientId = client?.deviceId || "unknown";
    const clientType = client?.clientType || "unregistered";

    // Log every incoming message with raw JSON
    this.logger.debug(`[${clientId}] (${clientType}) Received: ${data}`);

    try {
      const message: Message = JSON.parse(data);

      switch (message.type) {
        case "subscribe":
          // Update device ID from subscription message
          if (client && message.deviceId) {
            client.deviceId = message.deviceId;
            this.logger.info(`Device registered: ${message.deviceId}`);
            this.logger.debug(`[${message.deviceId}] Subscribe complete`);
          }
          break;

        case "join":
          // Join a pairing room
          this.logger.debug(
            `[${clientId}] Join request: code=${message.code} type=${message.clientType} deviceId=${message.deviceId} serial=${message.serial}`,
          );
          if (message.code && message.clientType) {
            // Check if authentication is required
            // REQUIRE_DEVICE_AUTH defaults to true when Supabase is enabled
            const requireAuth = this.supabaseStore?.isEnabled() &&
              (process.env.REQUIRE_DEVICE_AUTH !== "false");

            // Validate authentication based on client type
            if (message.clientType === "display") {
              // Display clients use HMAC authentication
              if (message.auth && message.serial && this.supabaseStore?.isEnabled()) {
                const authResult = await this.supabaseStore.validateDeviceAuth(
                  message.serial,
                  message.auth.timestamp,
                  message.auth.signature,
                );

                if (authResult.valid) {
                  if (client) {
                    client.authenticated = true;
                    client.serialNumber = message.serial;
                    client.debugEnabled =
                      authResult.device?.debug_enabled || false;
                  }
                  this.logger.info(
                    `Device ${message.serial} authenticated successfully`,
                  );
                } else {
                  this.logger.warn(
                    `Device auth failed for ${message.serial}: ${authResult.error}`,
                  );

                  // Reject if auth is required
                  if (requireAuth) {
                    this.sendMessage(ws, {
                      type: "error",
                      message: `Authentication failed: ${authResult.error}`,
                    });
                    return;
                  }
                }
              } else if (requireAuth) {
                // No auth provided but auth is required
                this.logger.warn(
                  `Device ${message.serial || clientId} rejected: auth required but not provided`,
                );
                this.sendMessage(ws, {
                  type: "error",
                  message: "Authentication required for display devices",
                });
                return;
              }
            } else if (message.clientType === "app") {
              // App clients use JWT token authentication
              if (message.app_auth?.token && this.supabaseStore?.isEnabled()) {
                const authResult = await this.supabaseStore.validateAppToken(
                  message.app_auth.token,
                );

                if (authResult.valid) {
                  if (client) {
                    client.authenticated = true;
                    client.serialNumber = message.serial || authResult.device?.serial_number;
                  }
                  this.logger.info(
                    `App authenticated for device ${message.serial}`,
                  );
                } else {
                  this.logger.warn(
                    `App auth failed: ${authResult.error}`,
                  );

                  // Reject if auth is required
                  if (requireAuth) {
                    this.sendMessage(ws, {
                      type: "error",
                      message: `App authentication failed: ${authResult.error}`,
                    });
                    return;
                  }
                }
              } else if (requireAuth) {
                // No app token provided but auth is required
                this.logger.warn(
                  `App ${clientId} rejected: auth required but no app_auth.token provided`,
                );
                this.sendMessage(ws, {
                  type: "error",
                  message: "Authentication required. Please obtain an app token using the pairing code.",
                });
                return;
              }
            }

            await this.joinRoom(ws, message.code, message.clientType, {
              deviceId: message.deviceId,
              serialNumber: message.serial,
              displayName: message.display_name,
              firmwareVersion: message.firmware_version,
              ipAddress: message.ip_address,
            });
          } else {
            this.logger.debug(
              `[${clientId}] Join rejected: missing code or clientType`,
            );
            this.sendMessage(ws, {
              type: "error",
              message: "Missing code or clientType",
            });
          }
          break;

        case "status":
          // Relay status update to paired client
          this.logger.debug(
            `[${clientId}] Status update: status=${message.status} camera=${message.camera_on} mic_muted=${message.mic_muted} in_call=${message.in_call}`,
          );
          this.relayStatus(ws, message);
          break;

        case "command":
          // Relay command from app to display
          this.logger.debug(
            `[${clientId}] Command: ${message.command} requestId=${message.requestId}`,
          );
          this.relayCommand(ws, message);
          break;

        case "command_response":
          // Relay command response from display to app
          this.logger.debug(
            `[${clientId}] Command response: requestId=${message.requestId} success=${message.success}`,
          );
          this.relayCommandResponse(ws, message);
          break;

        case "get_config":
          // Request config from display
          this.relayToDisplay(ws, message);
          break;

        case "config":
          // Config response from display to app
          this.relayToApp(ws, message);
          break;

        case "get_status":
          // Request status from display
          this.relayToDisplay(ws, message);
          break;

        case "ping":
          this.sendMessage(ws, { type: "pong" });
          break;

        case "debug_log":
          // Handle debug log from device
          await this.handleDebugLog(ws, message);
          break;

        case "subscribe_debug":
          // Admin subscribing to device debug logs
          // DEPRECATED: Use Supabase Realtime subscriptions instead
          if (process.env.ENABLE_BRIDGE_DEBUG_SUBSCRIBE === "true") {
            this.subscribeToDebugLogs(ws, message.deviceId || "");
          } else {
            this.sendMessage(ws, {
              type: "error",
              message: "Debug streaming via bridge is deprecated. Use Supabase Realtime subscriptions instead.",
            });
            this.logger.warn("subscribe_debug is deprecated - client should use Supabase Realtime");
          }
          break;

        case "unsubscribe_debug":
          // Admin unsubscribing from device debug logs
          // DEPRECATED: Use Supabase Realtime subscriptions instead
          if (process.env.ENABLE_BRIDGE_DEBUG_SUBSCRIBE === "true") {
            this.unsubscribeFromDebugLogs(ws, message.deviceId || "");
          }
          break;

        default:
          this.logger.debug(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to parse message: ${error}`);
    }
  }

  private async joinRoom(
    ws: WebSocket,
    code: string,
    clientType: "display" | "app",
    deviceInfo?: {
      deviceId?: string;
      serialNumber?: string;
      displayName?: string;
      firmwareVersion?: string;
      ipAddress?: string;
    },
  ): Promise<void> {
    const client = this.clients.get(ws);
    if (!client) {
      return;
    }

    // Normalize code to uppercase
    code = code.toUpperCase();

    // Update client info
    client.pairingCode = code;
    client.clientType = clientType;

    // Update device ID if provided
    if (deviceInfo?.deviceId) {
      client.deviceId = deviceInfo.deviceId;
    }

    // Get or create room
    let room = this.rooms.get(code);
    if (!room) {
      room = {
        code,
        display: null,
        app: null,
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      this.rooms.set(code, room);
      this.logger.info(`Created pairing room: ${code}`);
      this.logger.debug(
        `Room ${code} created, total rooms: ${this.rooms.size}`,
      );
    } else {
      this.logger.debug(
        `Room ${code} exists: display=${room.display !== null} app=${room.app !== null}`,
      );
    }

    // Add client to room
    if (clientType === "display") {
      // If there's an existing display, close it
      if (room.display && room.display !== ws) {
        this.sendMessage(room.display, {
          type: "error",
          message: "Another display joined with this code",
        });
      }
      room.display = ws;
      this.logger.info(`Display joined room ${code}`);

      // Register device if we have device info and a store
      if (this.deviceStore && deviceInfo?.deviceId) {
        this.deviceStore.registerDevice(
          deviceInfo.deviceId,
          code,
          deviceInfo.displayName,
          deviceInfo.ipAddress,
          deviceInfo.firmwareVersion,
        );
      }

      // Sync to Supabase if enabled and device has serial number
      if (
        this.supabaseStore?.isEnabled() &&
        client.serialNumber
      ) {
        // Fire and forget - don't block the join
        this.supabaseStore
          .updateDeviceLastSeen(
            client.serialNumber,
            deviceInfo?.ipAddress,
            deviceInfo?.firmwareVersion,
          )
          .catch((err) => {
            this.logger.error(`Failed to sync device to Supabase: ${err}`);
          });
      }
    } else {
      // If there's an existing app, close it
      if (room.app && room.app !== ws) {
        this.sendMessage(room.app, {
          type: "error",
          message: "Another app joined with this code",
        });
      }
      room.app = ws;
      this.logger.info(`App joined room ${code}`);
    }

    room.lastActivity = new Date();

    // Send confirmation
    const joinedMsg = {
      type: "joined",
      data: {
        code,
        clientType,
        displayConnected: room.display !== null,
        appConnected: room.app !== null,
      },
      timestamp: new Date().toISOString(),
    };
    this.logger.debug(
      `[${client.deviceId}] Sending joined confirmation: ${JSON.stringify(joinedMsg.data)}`,
    );
    this.sendMessage(ws, joinedMsg);

    // Notify the other client if present
    const otherClient = clientType === "display" ? room.app : room.display;
    if (otherClient && otherClient.readyState === WebSocket.OPEN) {
      this.logger.debug(`Room ${code}: Notifying peer of new ${clientType}`);
      this.sendMessage(otherClient, {
        type: "peer_connected",
        data: {
          peerType: clientType,
        },
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.debug(
        `Room ${code}: No peer to notify (${clientType === "display" ? "app" : "display"} not connected)`,
      );
    }
  }

  private relayStatus(ws: WebSocket, message: Message): void {
    const client = this.clients.get(ws);
    if (!client || !client.pairingCode) {
      this.sendMessage(ws, {
        type: "error",
        message: "Not in a pairing room. Send join message first.",
      });
      return;
    }

    const room = this.rooms.get(client.pairingCode);
    if (!room) {
      this.sendMessage(ws, {
        type: "error",
        message: "Pairing room not found",
      });
      return;
    }

    room.lastActivity = new Date();

    // Determine target (relay from app to display, or display to app)
    const target = client.clientType === "app" ? room.display : room.app;

    if (target && target.readyState === WebSocket.OPEN) {
      // Forward the status message
      const statusMsg = {
        type: "status",
        status: message.status,
        camera_on: message.camera_on,
        mic_muted: message.mic_muted,
        in_call: message.in_call,
        display_name: message.display_name,
        data: message.data,
        timestamp: new Date().toISOString(),
      };
      this.sendMessage(target, statusMsg);
      this.logger.debug(
        `Relayed status from ${client.clientType} to peer in room ${client.pairingCode}: ${JSON.stringify(statusMsg)}`,
      );
    } else {
      this.logger.debug(
        `No peer connected in room ${client.pairingCode} to receive status (target=${target ? "exists but closed" : "null"})`,
      );
    }
  }

  /**
   * Relay a command from app to display
   */
  private relayCommand(ws: WebSocket, message: Message): void {
    const client = this.clients.get(ws);
    if (!client || client.clientType !== "app") {
      this.sendMessage(ws, {
        type: "command_response",
        requestId: message.requestId,
        success: false,
        error: "Only apps can send commands",
      });
      return;
    }

    if (!client.pairingCode) {
      this.sendMessage(ws, {
        type: "command_response",
        requestId: message.requestId,
        success: false,
        error: "Not in a pairing room",
      });
      return;
    }

    const room = this.rooms.get(client.pairingCode);
    if (!room || !room.display || room.display.readyState !== WebSocket.OPEN) {
      this.sendMessage(ws, {
        type: "command_response",
        requestId: message.requestId,
        success: false,
        error: "Display not connected",
      });
      return;
    }

    // Forward command to display
    this.sendMessage(room.display, {
      type: "command",
      command: message.command,
      requestId: message.requestId,
      payload: message.payload,
      timestamp: new Date().toISOString(),
    });

    this.logger.debug(
      `Relayed command '${message.command}' to display in room ${client.pairingCode}`,
    );
  }

  /**
   * Relay a command response from display to app
   */
  private relayCommandResponse(ws: WebSocket, message: Message): void {
    const client = this.clients.get(ws);
    if (!client || client.clientType !== "display" || !client.pairingCode) {
      return;
    }

    const room = this.rooms.get(client.pairingCode);
    if (!room || !room.app || room.app.readyState !== WebSocket.OPEN) {
      return;
    }

    // Forward response to app
    this.sendMessage(room.app, {
      type: "command_response",
      command: message.command,
      requestId: message.requestId,
      success: message.success,
      data: message.data,
      error: message.error,
      timestamp: new Date().toISOString(),
    });

    this.logger.debug(
      `Relayed command response to app in room ${client.pairingCode}`,
    );
  }

  /**
   * Relay a message from app to display
   */
  private relayToDisplay(ws: WebSocket, message: Message): void {
    const client = this.clients.get(ws);
    if (!client || !client.pairingCode) {
      return;
    }

    const room = this.rooms.get(client.pairingCode);
    if (!room || !room.display || room.display.readyState !== WebSocket.OPEN) {
      this.sendMessage(ws, {
        type: "error",
        message: "Display not connected",
      });
      return;
    }

    this.sendMessage(room.display, message);
  }

  /**
   * Relay a message from display to app
   */
  private relayToApp(ws: WebSocket, message: Message): void {
    const client = this.clients.get(ws);
    if (!client || !client.pairingCode) {
      return;
    }

    const room = this.rooms.get(client.pairingCode);
    if (!room || !room.app || room.app.readyState !== WebSocket.OPEN) {
      return;
    }

    this.sendMessage(room.app, message);
  }

  private cleanupRoom(code: string): void {
    const room = this.rooms.get(code);
    if (room && !room.display && !room.app) {
      this.rooms.delete(code);
      this.logger.info(`Cleaned up empty room: ${code}`);
    }
  }

  private sendMessage(ws: WebSocket, message: Message): void {
    if (ws.readyState === WebSocket.OPEN) {
      const data = JSON.stringify(message);
      ws.send(data);
      // Log outgoing messages at debug level
      const client = this.clients.get(ws);
      if (client) {
        this.logger.debug(`[${client.deviceId}] Sending: ${data}`);
      }
    }
  }

  /**
   * Handle debug log from device
   */
  private async handleDebugLog(ws: WebSocket, message: Message): Promise<void> {
    const client = this.clients.get(ws);
    if (!client || client.clientType !== "display") {
      return;
    }

    const deviceId = client.deviceId;
    const serialNumber = client.serialNumber;
    const level = message.level || "debug";
    const logMessage = message.log_message || message.message || "";
    const metadata = message.log_metadata;

    // Apply rate limiting for high-volume logs
    // Always persist warn/error; throttle info/debug when debug_enabled
    const shouldPersist = level === "warn" || level === "error" || client.debugEnabled;

    // Store in Supabase if enabled and should persist
    if (this.supabaseStore?.isEnabled() && shouldPersist) {
      await this.supabaseStore.insertDeviceLog(
        deviceId,
        level,
        logMessage,
        metadata,
        serialNumber,
      );
    }

    // Forward to any subscribers (admins watching this device) - deprecated path
    if (process.env.ENABLE_BRIDGE_DEBUG_SUBSCRIBE === "true") {
      const subscribers = this.debugSubscribers.get(deviceId);
      if (subscribers) {
        const logEvent: Message = {
          type: "debug_log",
          deviceId,
          level,
          log_message: logMessage,
          log_metadata: metadata,
          timestamp: new Date().toISOString(),
        };

        for (const subscriber of subscribers) {
          if (subscriber.readyState === WebSocket.OPEN) {
            this.sendMessage(subscriber, logEvent);
          }
        }
      }
    }

    this.logger.debug(`[${serialNumber || deviceId}] Debug log: [${level}] ${logMessage}`);
  }

  /**
   * Subscribe admin to device debug logs
   */
  private subscribeToDebugLogs(ws: WebSocket, deviceId: string): void {
    if (!deviceId) {
      this.sendMessage(ws, { type: "error", message: "Missing deviceId" });
      return;
    }

    let subscribers = this.debugSubscribers.get(deviceId);
    if (!subscribers) {
      subscribers = new Set();
      this.debugSubscribers.set(deviceId, subscribers);
    }
    subscribers.add(ws);

    this.sendMessage(ws, {
      type: "debug_subscribed",
      deviceId,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Admin subscribed to debug logs for ${deviceId}`);
  }

  /**
   * Unsubscribe admin from device debug logs
   */
  private unsubscribeFromDebugLogs(ws: WebSocket, deviceId: string): void {
    const subscribers = this.debugSubscribers.get(deviceId);
    if (subscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        this.debugSubscribers.delete(deviceId);
      }
    }

    this.sendMessage(ws, {
      type: "debug_unsubscribed",
      deviceId,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Admin unsubscribed from debug logs for ${deviceId}`);
  }

  /**
   * Get Supabase store for external access
   */
  getSupabaseStore(): SupabaseStore | null {
    return this.supabaseStore;
  }
}
