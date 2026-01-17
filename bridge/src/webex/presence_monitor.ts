/**
 * Presence Monitor
 * 
 * Monitors Webex presence status and emits events on changes.
 */

import { Logger } from 'winston';
import { WebexClient, WebexPresence } from './webex_client';

type PresenceCallback = (presence: WebexPresence) => void;

export class PresenceMonitor {
    private webexClient: WebexClient;
    private logger: Logger;
    private pollInterval: NodeJS.Timeout | null = null;
    private lastStatus: string = '';
    private callbacks: PresenceCallback[] = [];
    private running: boolean = false;

    // Poll interval in milliseconds (30 seconds default)
    private readonly POLL_INTERVAL_MS = 30000;

    constructor(webexClient: WebexClient, logger: Logger) {
        this.webexClient = webexClient;
        this.logger = logger;
    }

    onPresenceChange(callback: PresenceCallback): void {
        this.callbacks.push(callback);
    }

    async start(): Promise<void> {
        if (this.running) {
            return;
        }

        this.logger.info('Starting presence monitor...');
        this.running = true;

        // Get initial presence
        await this.checkPresence();

        // Start polling
        this.pollInterval = setInterval(() => {
            this.checkPresence().catch((error) => {
                this.logger.error(`Error checking presence: ${error}`);
            });
        }, this.POLL_INTERVAL_MS);

        this.logger.info(`Presence monitor started (polling every ${this.POLL_INTERVAL_MS / 1000}s)`);
    }

    stop(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.running = false;
        this.logger.info('Presence monitor stopped');
    }

    private async checkPresence(): Promise<void> {
        try {
            const presence = await this.webexClient.getPresence();

            // Check if status changed
            if (presence.status !== this.lastStatus) {
                this.logger.info(`Status changed: ${this.lastStatus} -> ${presence.status}`);
                this.lastStatus = presence.status;

                // Notify all callbacks
                for (const callback of this.callbacks) {
                    try {
                        callback(presence);
                    } catch (error) {
                        this.logger.error(`Error in presence callback: ${error}`);
                    }
                }
            }
        } catch (error) {
            this.logger.error(`Failed to get presence: ${error}`);
        }
    }

    getCurrentStatus(): string {
        return this.lastStatus;
    }
}
