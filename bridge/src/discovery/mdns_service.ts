/**
 * mDNS Service
 * 
 * Advertises the bridge server via mDNS for automatic discovery.
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

        // Publish the service
        this.service = this.bonjour.publish({
            name: this.serviceName,
            type: 'webex-bridge',
            port: this.port,
            txt: {
                version: '1.0.0',
                protocol: 'websocket'
            }
        });

        this.service.on('up', () => {
            this.logger.info(`mDNS service published: ${this.serviceName}._webex-bridge._tcp.local:${this.port}`);
        });

        this.service.on('error', (error) => {
            this.logger.error(`mDNS service error: ${error}`);
        });

        this.logger.info(`mDNS service starting: ${this.serviceName}`);
    }

    stop(): void {
        if (this.service && typeof this.service.stop === 'function') {
            this.service.stop();
            this.service = null;
        }

        if (this.bonjour) {
            this.bonjour.destroy();
            this.bonjour = null;
        }

        this.logger.info('mDNS service stopped');
    }

    getServiceName(): string {
        return this.serviceName;
    }

    getPort(): number {
        return this.port;
    }
}
