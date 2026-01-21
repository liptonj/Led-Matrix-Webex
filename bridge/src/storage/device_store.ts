/**
 * Device Store
 * 
 * Persists device registration data to a JSON file.
 * Similar to Python pickle but for Node.js.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from 'winston';

export interface RegisteredDevice {
    deviceId: string;           // Unique device ID (from ESP32 MAC)
    displayName: string;        // User-friendly name
    pairingCode: string;        // Assigned pairing code
    registeredAt: string;       // ISO date string
    lastSeen: string;           // ISO date string
    ipAddress?: string;
    firmwareVersion?: string;
    metadata?: Record<string, unknown>;
}

export interface DeviceStoreData {
    version: number;
    devices: Record<string, RegisteredDevice>;  // keyed by deviceId
    pairingCodes: Record<string, string>;       // code -> deviceId mapping
}

const STORE_VERSION = 1;
const DEFAULT_DATA: DeviceStoreData = {
    version: STORE_VERSION,
    devices: {},
    pairingCodes: {}
};

export class DeviceStore {
    private filePath: string;
    private data: DeviceStoreData;
    private logger: Logger;
    private saveTimeout: NodeJS.Timeout | null = null;
    private dirty: boolean = false;

    constructor(dataDir: string, logger: Logger) {
        this.filePath = path.join(dataDir, 'devices.json');
        this.logger = logger;
        this.data = { ...DEFAULT_DATA };
    }

    /**
     * Load device data from file
     */
    async load(): Promise<void> {
        try {
            if (fs.existsSync(this.filePath)) {
                const content = fs.readFileSync(this.filePath, 'utf-8');
                const parsed = JSON.parse(content) as DeviceStoreData;
                
                // Validate version
                if (parsed.version === STORE_VERSION) {
                    this.data = parsed;
                    this.logger.info(`Loaded ${Object.keys(this.data.devices).length} devices from storage`);
                } else {
                    this.logger.warn(`Store version mismatch (${parsed.version} vs ${STORE_VERSION}), starting fresh`);
                    this.data = { ...DEFAULT_DATA };
                }
            } else {
                this.logger.info('No device store found, starting fresh');
                this.data = { ...DEFAULT_DATA };
            }
        } catch (error) {
            this.logger.error(`Failed to load device store: ${error}`);
            this.data = { ...DEFAULT_DATA };
        }
    }

    /**
     * Save device data to file (debounced)
     */
    private scheduleSave(): void {
        this.dirty = true;
        
        if (this.saveTimeout) {
            return; // Already scheduled
        }
        
        // Debounce saves to avoid excessive disk writes
        this.saveTimeout = setTimeout(() => {
            this.saveNow();
            this.saveTimeout = null;
        }, 1000);
    }

    /**
     * Save immediately
     */
    saveNow(): void {
        if (!this.dirty) return;
        
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
            this.dirty = false;
            this.logger.debug('Device store saved');
        } catch (error) {
            this.logger.error(`Failed to save device store: ${error}`);
        }
    }

    /**
     * Register or update a device
     */
    registerDevice(
        deviceId: string,
        pairingCode: string,
        displayName?: string,
        ipAddress?: string,
        firmwareVersion?: string
    ): RegisteredDevice {
        const now = new Date().toISOString();
        const existing = this.data.devices[deviceId];
        
        const device: RegisteredDevice = {
            deviceId,
            displayName: displayName || existing?.displayName || `Display ${deviceId.slice(-4)}`,
            pairingCode,
            registeredAt: existing?.registeredAt || now,
            lastSeen: now,
            ipAddress,
            firmwareVersion,
            metadata: existing?.metadata || {}
        };
        
        // Update device record
        this.data.devices[deviceId] = device;
        
        // Update pairing code mapping
        // Remove old code if device had a different one
        if (existing && existing.pairingCode !== pairingCode) {
            delete this.data.pairingCodes[existing.pairingCode];
        }
        this.data.pairingCodes[pairingCode] = deviceId;
        
        this.scheduleSave();
        this.logger.info(`Registered device: ${deviceId} with code ${pairingCode}`);
        
        return device;
    }

    /**
     * Update last seen timestamp
     */
    updateLastSeen(deviceId: string, ipAddress?: string): void {
        const device = this.data.devices[deviceId];
        if (device) {
            device.lastSeen = new Date().toISOString();
            if (ipAddress) {
                device.ipAddress = ipAddress;
            }
            this.scheduleSave();
        }
    }

    /**
     * Get device by ID
     */
    getDevice(deviceId: string): RegisteredDevice | undefined {
        return this.data.devices[deviceId];
    }

    /**
     * Get device by pairing code
     */
    getDeviceByCode(pairingCode: string): RegisteredDevice | undefined {
        const deviceId = this.data.pairingCodes[pairingCode.toUpperCase()];
        return deviceId ? this.data.devices[deviceId] : undefined;
    }

    /**
     * Check if pairing code is already in use
     */
    isCodeInUse(pairingCode: string): boolean {
        return pairingCode.toUpperCase() in this.data.pairingCodes;
    }

    /**
     * Get all registered devices
     */
    getAllDevices(): RegisteredDevice[] {
        return Object.values(this.data.devices);
    }

    /**
     * Remove a device
     */
    removeDevice(deviceId: string): boolean {
        const device = this.data.devices[deviceId];
        if (device) {
            delete this.data.pairingCodes[device.pairingCode];
            delete this.data.devices[deviceId];
            this.scheduleSave();
            this.logger.info(`Removed device: ${deviceId}`);
            return true;
        }
        return false;
    }

    /**
     * Update device display name
     */
    setDisplayName(deviceId: string, displayName: string): boolean {
        const device = this.data.devices[deviceId];
        if (device) {
            device.displayName = displayName;
            this.scheduleSave();
            return true;
        }
        return false;
    }

    /**
     * Get device count
     */
    getDeviceCount(): number {
        return Object.keys(this.data.devices).length;
    }

    /**
     * Cleanup - save any pending changes
     */
    async shutdown(): Promise<void> {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        this.saveNow();
    }
}
