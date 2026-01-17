/**
 * Configuration Manager
 * 
 * Handles loading and managing configuration from environment variables.
 */

export class ConfigManager {
    private clientId: string;
    private clientSecret: string;
    private refreshToken: string;
    private wsPort: number;
    private mdnsServiceName: string;
    private logLevel: string;

    constructor() {
        this.clientId = process.env.WEBEX_CLIENT_ID || '';
        this.clientSecret = process.env.WEBEX_CLIENT_SECRET || '';
        this.refreshToken = process.env.WEBEX_REFRESH_TOKEN || '';
        this.wsPort = parseInt(process.env.WS_PORT || '8080', 10);
        this.mdnsServiceName = process.env.MDNS_SERVICE_NAME || 'webex-bridge';
        this.logLevel = process.env.LOG_LEVEL || 'info';
    }

    hasWebexCredentials(): boolean {
        return !!(this.clientId && this.clientSecret && this.refreshToken);
    }

    getClientId(): string {
        return this.clientId;
    }

    getClientSecret(): string {
        return this.clientSecret;
    }

    getRefreshToken(): string {
        return this.refreshToken;
    }

    setRefreshToken(token: string): void {
        this.refreshToken = token;
        // In production, you would persist this to a secure store
    }

    getWsPort(): number {
        return this.wsPort;
    }

    getMdnsServiceName(): string {
        return this.mdnsServiceName;
    }

    getLogLevel(): string {
        return this.logLevel;
    }
}
