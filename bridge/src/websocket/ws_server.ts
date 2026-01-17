/**
 * WebSocket Server
 * 
 * Handles WebSocket connections from ESP32 devices.
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { Logger } from 'winston';

interface Message {
    type: string;
    data?: Record<string, unknown>;
    timestamp?: string;
    deviceId?: string;
    message?: string;
}

interface Client {
    ws: WebSocket;
    deviceId: string;
    connectedAt: Date;
}

export class WebSocketServer {
    private port: number;
    private logger: Logger;
    private server: WSServer | null = null;
    private clients: Map<WebSocket, Client> = new Map();

    constructor(port: number, logger: Logger) {
        this.port = port;
        this.logger = logger;
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

    private sendMessage(ws: WebSocket, message: Message): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
}
