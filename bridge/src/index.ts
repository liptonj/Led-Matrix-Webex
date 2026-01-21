/**
 * Webex Bridge Server
 * 
 * Provides real-time Webex presence updates to ESP32 devices
 * via WebSocket using the Webex JS SDK.
 * 
 * Supports two modes:
 * 1. Pairing Mode: Relays status between embedded apps and displays
 * 2. Legacy OAuth Mode: Direct Webex presence monitoring
 */

import dotenv from 'dotenv';
import path from 'path';
import { createLogger, format, transports } from 'winston';
import { WebexClient } from './webex/webex_client';
import { PresenceMonitor } from './webex/presence_monitor';
import { WebSocketServer } from './websocket/ws_server';
import { MDNSService } from './discovery/mdns_service';
import { ConfigManager } from './config/config_manager';
import { DeviceStore } from './storage/device_store';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.colorize(),
        format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level}]: ${message}`;
        })
    ),
    transports: [
        new transports.Console()
    ]
});

// Global state
let webexClient: WebexClient | null = null;
let presenceMonitor: PresenceMonitor | null = null;
let wsServer: WebSocketServer | null = null;
let mdnsService: MDNSService | null = null;
let deviceStore: DeviceStore | null = null;

async function main(): Promise<void> {
    logger.info('Starting Webex Bridge Server...');
    
    // Load configuration
    const config = new ConfigManager();
    
    // Initialize device store for persistence
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    deviceStore = new DeviceStore(dataDir, logger);
    await deviceStore.load();
    logger.info(`Device store initialized (${deviceStore.getDeviceCount()} devices)`);
    
    // Initialize WebSocket server (always needed for pairing mode)
    const wsPort = parseInt(process.env.WS_PORT || '8080', 10);
    wsServer = new WebSocketServer(wsPort, logger, deviceStore);
    wsServer.start();
    
    // Initialize Webex client only if credentials are configured
    if (config.hasWebexCredentials()) {
        logger.info('Webex credentials found, initializing legacy OAuth mode...');
        webexClient = new WebexClient(config, logger);
        
        try {
            await webexClient.initialize();
            logger.info('Webex client initialized successfully');
            
            // Initialize presence monitor
            presenceMonitor = new PresenceMonitor(webexClient, logger);
            presenceMonitor.onPresenceChange((presence) => {
                logger.info(`Presence changed: ${presence.status}`);
                
                // Broadcast to all connected ESP32 devices
                if (wsServer) {
                    wsServer.broadcast({
                        type: 'presence',
                        data: {
                            status: presence.status,
                            displayName: presence.displayName,
                            lastActivity: presence.lastActivity
                        },
                        timestamp: new Date().toISOString()
                    });
                }
            });
            
            // Start monitoring presence
            await presenceMonitor.start();
        } catch (error) {
            logger.warn(`Failed to initialize Webex client: ${error}`);
            logger.info('Continuing in pairing-only mode');
        }
    } else {
        logger.info('No Webex credentials configured - running in pairing-only mode');
    }
    
    // Start mDNS advertisement
    const serviceName = process.env.MDNS_SERVICE_NAME || 'webex-bridge';
    mdnsService = new MDNSService(serviceName, wsPort, logger);
    mdnsService.start();
    
    logger.info(`Webex Bridge Server is running on port ${wsPort}`);
    logger.info(`mDNS advertising as ${serviceName}.local`);
    logger.info(`Pairing mode: enabled`);
    logger.info(`Legacy OAuth mode: ${config.hasWebexCredentials() ? 'enabled' : 'disabled'}`);
    
    // Handle shutdown
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

async function shutdown(): Promise<void> {
    logger.info('Shutting down...');
    
    if (presenceMonitor) {
        presenceMonitor.stop();
    }
    
    if (wsServer) {
        await wsServer.shutdown();
    }
    
    if (mdnsService) {
        mdnsService.stop();
    }
    
    if (webexClient) {
        await webexClient.disconnect();
    }
    
    if (deviceStore) {
        await deviceStore.shutdown();
    }
    
    logger.info('Goodbye!');
    process.exit(0);
}

// Start the server
main().catch((error) => {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
});
