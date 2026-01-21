/**
 * WebSocket Server
 * 
 * Handles WebSocket connections from ESP32 devices and Webex Embedded Apps.
 * Supports pairing rooms for real-time status sync between apps and displays.
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { Logger } from 'winston';
import { DeviceStore, RegisteredDevice } from '../storage/device_store';

interface Message {
    type: string;
    data?: Record<string, unknown>;
    timestamp?: string;
    deviceId?: string;
    message?: string;
    code?: string;
    clientType?: 'display' | 'app';
    status?: string;
    camera_on?: boolean;
    mic_muted?: boolean;
    in_call?: boolean;
    display_name?: string;
    // Device registration fields
    firmware_version?: string;
    ip_address?: string;
    // Command relay fields
    command?: string;
    requestId?: string;
    payload?: Record<string, unknown>;
    success?: boolean;
    error?: string;
}

interface Client {
    ws: WebSocket;
    deviceId: string;
    connectedAt: Date;
    pairingCode?: string;
    clientType?: 'display' | 'app';
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

    constructor(port: number, logger: Logger, deviceStore?: DeviceStore) {
        this.port = port;
        this.logger = logger;
        this.deviceStore = deviceStore || null;
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

        this.server.on('connection', (ws: WebSocket) => {
            this.handleConnection(ws);
        });

        this.server.on('error', (error) => {
            this.logger.error(`WebSocket server error: ${error}`);
        });

        this.logger.info(`WebSocket server started on port ${this.port}`);
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
            this.logger.info('WebSocket server stopped');
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

        // Initialize client with temporary ID
        const client: Client = {
            ws,
            deviceId: clientId,
            connectedAt: new Date()
        };
        this.clients.set(ws, client);

        // Send connection confirmation
        this.sendMessage(ws, {
            type: 'connection',
            data: {
                webex: 'connected',
                clients: this.clients.size
            },
            timestamp: new Date().toISOString()
        });

        // Handle messages
        ws.on('message', (data: Buffer) => {
            this.handleMessage(ws, data.toString());
        });

        // Handle disconnect
        ws.on('close', () => {
            const client = this.clients.get(ws);
            if (client) {
                this.logger.info(`Client disconnected: ${client.deviceId}`);
                
                // Clean up pairing room
                if (client.pairingCode) {
                    const room = this.rooms.get(client.pairingCode);
                    if (room) {
                        if (client.clientType === 'display') {
                            room.display = null;
                            // Notify app that display disconnected
                            if (room.app && room.app.readyState === WebSocket.OPEN) {
                                this.sendMessage(room.app, {
                                    type: 'peer_disconnected',
                                    data: { peerType: 'display' },
                                    timestamp: new Date().toISOString()
                                });
                            }
                        } else if (client.clientType === 'app') {
                            room.app = null;
                            // Notify display that app disconnected
                            if (room.display && room.display.readyState === WebSocket.OPEN) {
                                this.sendMessage(room.display, {
                                    type: 'peer_disconnected',
                                    data: { peerType: 'app' },
                                    timestamp: new Date().toISOString()
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
        ws.on('error', (error) => {
            this.logger.error(`WebSocket error for ${clientId}: ${error}`);
        });

        // Setup ping/pong for keepalive
        ws.on('pong', () => {
            // Client responded to ping
        });
    }

    private handleMessage(ws: WebSocket, data: string): void {
        try {
            const message: Message = JSON.parse(data);
            const client = this.clients.get(ws);

            switch (message.type) {
                case 'subscribe':
                    // Update device ID from subscription message
                    if (client && message.deviceId) {
                        client.deviceId = message.deviceId;
                        this.logger.info(`Device registered: ${message.deviceId}`);
                    }
                    break;

                case 'join':
                    // Join a pairing room
                    if (message.code && message.clientType) {
                        this.joinRoom(ws, message.code, message.clientType, {
                            deviceId: message.deviceId,
                            displayName: message.display_name,
                            firmwareVersion: message.firmware_version,
                            ipAddress: message.ip_address
                        });
                    } else {
                        this.sendMessage(ws, { 
                            type: 'error', 
                            message: 'Missing code or clientType' 
                        });
                    }
                    break;

                case 'status':
                    // Relay status update to paired client
                    this.relayStatus(ws, message);
                    break;

                case 'command':
                    // Relay command from app to display
                    this.relayCommand(ws, message);
                    break;

                case 'command_response':
                    // Relay command response from display to app
                    this.relayCommandResponse(ws, message);
                    break;

                case 'get_config':
                    // Request config from display
                    this.relayToDisplay(ws, message);
                    break;

                case 'config':
                    // Config response from display to app
                    this.relayToApp(ws, message);
                    break;

                case 'get_status':
                    // Request status from display
                    this.relayToDisplay(ws, message);
                    break;

                case 'ping':
                    this.sendMessage(ws, { type: 'pong' });
                    break;

                default:
                    this.logger.debug(`Unknown message type: ${message.type}`);
            }
        } catch (error) {
            this.logger.error(`Failed to parse message: ${error}`);
        }
    }

    private joinRoom(
        ws: WebSocket, 
        code: string, 
        clientType: 'display' | 'app',
        deviceInfo?: {
            deviceId?: string;
            displayName?: string;
            firmwareVersion?: string;
            ipAddress?: string;
        }
    ): void {
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
                lastActivity: new Date()
            };
            this.rooms.set(code, room);
            this.logger.info(`Created pairing room: ${code}`);
        }

        // Add client to room
        if (clientType === 'display') {
            // If there's an existing display, close it
            if (room.display && room.display !== ws) {
                this.sendMessage(room.display, { 
                    type: 'error', 
                    message: 'Another display joined with this code' 
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
                    deviceInfo.firmwareVersion
                );
            }
        } else {
            // If there's an existing app, close it
            if (room.app && room.app !== ws) {
                this.sendMessage(room.app, { 
                    type: 'error', 
                    message: 'Another app joined with this code' 
                });
            }
            room.app = ws;
            this.logger.info(`App joined room ${code}`);
        }

        room.lastActivity = new Date();

        // Send confirmation
        this.sendMessage(ws, {
            type: 'joined',
            data: {
                code,
                clientType,
                displayConnected: room.display !== null,
                appConnected: room.app !== null
            },
            timestamp: new Date().toISOString()
        });

        // Notify the other client if present
        const otherClient = clientType === 'display' ? room.app : room.display;
        if (otherClient && otherClient.readyState === WebSocket.OPEN) {
            this.sendMessage(otherClient, {
                type: 'peer_connected',
                data: {
                    peerType: clientType
                },
                timestamp: new Date().toISOString()
            });
        }
    }

    private relayStatus(ws: WebSocket, message: Message): void {
        const client = this.clients.get(ws);
        if (!client || !client.pairingCode) {
            this.sendMessage(ws, { 
                type: 'error', 
                message: 'Not in a pairing room. Send join message first.' 
            });
            return;
        }

        const room = this.rooms.get(client.pairingCode);
        if (!room) {
            this.sendMessage(ws, { 
                type: 'error', 
                message: 'Pairing room not found' 
            });
            return;
        }

        room.lastActivity = new Date();

        // Determine target (relay from app to display, or display to app)
        const target = client.clientType === 'app' ? room.display : room.app;

        if (target && target.readyState === WebSocket.OPEN) {
            // Forward the status message
            this.sendMessage(target, {
                type: 'status',
                status: message.status,
                camera_on: message.camera_on,
                mic_muted: message.mic_muted,
                in_call: message.in_call,
                display_name: message.display_name,
                data: message.data,
                timestamp: new Date().toISOString()
            });
            this.logger.debug(`Relayed status from ${client.clientType} to peer in room ${client.pairingCode}`);
        } else {
            this.logger.debug(`No peer connected in room ${client.pairingCode} to receive status`);
        }
    }

    /**
     * Relay a command from app to display
     */
    private relayCommand(ws: WebSocket, message: Message): void {
        const client = this.clients.get(ws);
        if (!client || client.clientType !== 'app') {
            this.sendMessage(ws, { 
                type: 'command_response', 
                requestId: message.requestId,
                success: false,
                error: 'Only apps can send commands' 
            });
            return;
        }

        if (!client.pairingCode) {
            this.sendMessage(ws, { 
                type: 'command_response',
                requestId: message.requestId,
                success: false,
                error: 'Not in a pairing room' 
            });
            return;
        }

        const room = this.rooms.get(client.pairingCode);
        if (!room || !room.display || room.display.readyState !== WebSocket.OPEN) {
            this.sendMessage(ws, { 
                type: 'command_response',
                requestId: message.requestId,
                success: false,
                error: 'Display not connected' 
            });
            return;
        }

        // Forward command to display
        this.sendMessage(room.display, {
            type: 'command',
            command: message.command,
            requestId: message.requestId,
            payload: message.payload,
            timestamp: new Date().toISOString()
        });

        this.logger.debug(`Relayed command '${message.command}' to display in room ${client.pairingCode}`);
    }

    /**
     * Relay a command response from display to app
     */
    private relayCommandResponse(ws: WebSocket, message: Message): void {
        const client = this.clients.get(ws);
        if (!client || client.clientType !== 'display' || !client.pairingCode) {
            return;
        }

        const room = this.rooms.get(client.pairingCode);
        if (!room || !room.app || room.app.readyState !== WebSocket.OPEN) {
            return;
        }

        // Forward response to app
        this.sendMessage(room.app, {
            type: 'command_response',
            command: message.command,
            requestId: message.requestId,
            success: message.success,
            data: message.data,
            error: message.error,
            timestamp: new Date().toISOString()
        });

        this.logger.debug(`Relayed command response to app in room ${client.pairingCode}`);
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
                type: 'error',
                message: 'Display not connected' 
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
            ws.send(JSON.stringify(message));
        }
    }
}
