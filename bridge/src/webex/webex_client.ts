/**
 * Webex Client
 * 
 * Wrapper around the Webex JS SDK for authentication and API access.
 */

import Webex from 'webex';
import { Logger } from 'winston';
import { ConfigManager } from '../config/config_manager';

export interface WebexPresence {
    status: string;
    displayName: string;
    email: string;
    lastActivity: string;
}

export class WebexClient {
    private config: ConfigManager;
    private logger: Logger;
    private webex: any; // Webex SDK instance
    private accessToken: string = '';
    private tokenExpiry: number = 0;

    constructor(config: ConfigManager, logger: Logger) {
        this.config = config;
        this.logger = logger;
    }

    async initialize(): Promise<void> {
        this.logger.info('Initializing Webex SDK...');

        // First, get an access token using the refresh token
        await this.refreshAccessToken();

        // Initialize the SDK with the access token
        this.webex = Webex.init({
            credentials: {
                access_token: this.accessToken
            }
        });

        // Verify connection by getting own profile
        try {
            const me = await this.webex.people.get('me');
            this.logger.info(`Authenticated as: ${me.displayName} (${me.emails[0]})`);
        } catch (error) {
            throw new Error(`Failed to authenticate: ${error}`);
        }
    }

    async refreshAccessToken(): Promise<void> {
        const clientId = this.config.getClientId();
        const clientSecret = this.config.getClientSecret();
        const refreshToken = this.config.getRefreshToken();

        this.logger.info('Refreshing access token...');

        const response = await fetch('https://webexapis.com/v1/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Token refresh failed: ${error}`);
        }

        const data = await response.json();
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000);

        // Update refresh token if a new one was provided
        if (data.refresh_token) {
            this.config.setRefreshToken(data.refresh_token);
        }

        this.logger.info('Access token refreshed successfully');
    }

    async getPresence(): Promise<WebexPresence> {
        // Ensure token is valid
        if (Date.now() > this.tokenExpiry - 300000) { // 5 min buffer
            await this.refreshAccessToken();
            
            // Reinitialize SDK with new token
            this.webex = Webex.init({
                credentials: {
                    access_token: this.accessToken
                }
            });
        }

        const me = await this.webex.people.get('me');

        return {
            status: me.status || 'unknown',
            displayName: me.displayName || '',
            email: me.emails?.[0] || '',
            lastActivity: me.lastActivity || ''
        };
    }

    getWebexInstance(): any {
        return this.webex;
    }

    async disconnect(): Promise<void> {
        this.logger.info('Disconnecting Webex client...');
        // Clean up SDK resources if needed
    }
}
