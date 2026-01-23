/**
 * mDNS Service
 *
 * Advertises the bridge server via mDNS for automatic discovery.
 * 
 * ESP32 devices search for "_webex-bridge._tcp" service type.
 * The bonjour-service library automatically formats the service type
 * by prepending "_" and appending "._tcp" (or ._udp).
 */

import { Bonjour, Service } from 'bonjour-service';
import { Logger } from 'winston';

export class MDNSService {
    private serviceName: string;
    private port: number;
    private logger: Logger;
    private bonjour: Bonjour | null = null;
    private service: Service | null = null;

    constructor(serviceName: string, port: number, logger: Logger) {
        this.serviceName = serviceName;
        this.port = port;
        this.logger = logger;
    }

    start(): void {
        this.bonjour = new Bonjour();

        this.logger.info(`Starting mDNS service: ${this.serviceName} on port ${this.port}`);

        // Publish the service with correct format for ESP32 discovery
        // ESP32 searches for "_webex-bridge._tcp" service type
        this.service = this.bonjour.publish({
            name: this.serviceName,
            type: 'webex-bridge',  // bonjour-service will format as _webex-bridge._tcp
            port: this.port,
            protocol: 'tcp',
            txt: {
                version: '1.0.0',
                protocol: 'websocket'
            }
        });

        this.service.on('up', () => {
            this.logger.info(`mDNS service published: ${this.serviceName}._webex-bridge._tcp.local:${this.port}`);
            this.logger.info(`ESP32 devices should now be able to discover this bridge`);
            this.logger.debug(`mDNS TXT records: version=1.0.0, protocol=websocket`);
        });

        this.service.on('error', (error) => {
            this.logger.error(`mDNS service error: ${error}`);
        });
    }

    stop(): void {
        this.logger.info('Stopping mDNS service...');
        
        if (this.service && typeof this.service.stop === 'function') {
            try {
                this.service.stop();
                this.logger.info('mDNS service stopped successfully');
            } catch (error) {
                this.logger.error(`Error stopping mDNS service: ${error}`);
            }
            this.service = null;
        }

        if (this.bonjour) {
            try {
                this.bonjour.destroy();
                this.logger.info('Bonjour instance destroyed');
            } catch (error) {
                this.logger.error(`Error destroying Bonjour instance: ${error}`);
            }
            this.bonjour = null;
        }
    }

    /**
     * Check if the mDNS service is currently running
     */
    isRunning(): boolean {
        return this.service !== null && this.bonjour !== null;
    }

    /**
     * Get service information for debugging
     */
    getServiceInfo(): { name: string; type: string; port: number; running: boolean } {
        return {
            name: this.serviceName,
            type: '_webex-bridge._tcp',
            port: this.port,
            running: this.isRunning()
        };
    }

    getServiceName(): string {
        return this.serviceName;
    }

    getPort(): number {
        return this.port;
    }
}
