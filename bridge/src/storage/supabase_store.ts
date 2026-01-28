/**
 * Supabase Device Store
 *
 * Integrates with Supabase for device registration and HMAC validation.
 * Falls back to local file storage if Supabase is not configured.
 */

import { Logger } from "winston";

export interface SupabaseDevice {
  serial_number: string;
  device_id: string;
  pairing_code: string;
  display_name: string | null;
  firmware_version: string | null;
  ip_address: string | null;
  last_seen: string;
  debug_enabled: boolean;
  is_provisioned: boolean;
}

export interface AuthValidationResult {
  valid: boolean;
  error?: string;
  device?: SupabaseDevice;
}

export interface AppTokenPayload {
  sub: string; // UUID for Supabase auth.uid()
  serial_number: string; // Device serial number for bridge lookup
  device_id: string;
  pairing_code: string;
  type: string; // Must be "app_auth" for bridge validation
  iat: number;
  exp: number;
}

export interface ProvisionResult {
  success: boolean;
  device_id?: string;
  pairing_code?: string;
  error?: string;
}

export class SupabaseStore {
  private logger: Logger;
  private supabaseUrl: string;
  private supabaseKey: string;
  private appTokenSecret: string;
  private enabled: boolean;
  private schemaHeaders: Record<string, string>;

  constructor(logger: Logger) {
    this.logger = logger;
    this.supabaseUrl = process.env.SUPABASE_URL || "";
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    // Support BRIDGE_APP_TOKEN_SECRET and legacy SUPABASE_JWT_SECRET
    // They should be set to the same value for consistency
    this.appTokenSecret =
      process.env.BRIDGE_APP_TOKEN_SECRET ||
      process.env.DEVICE_JWT_SECRET ||
      process.env.SUPABASE_JWT_SECRET ||
      "";
    this.enabled = !!(this.supabaseUrl && this.supabaseKey);
    this.schemaHeaders = {
      "Content-Profile": "display",
      "Accept-Profile": "display",
    };

    if (this.enabled) {
      this.logger.info("Supabase integration enabled");
      if (!this.appTokenSecret) {
        this.logger.warn(
          "BRIDGE_APP_TOKEN_SECRET/DEVICE_JWT_SECRET/SUPABASE_JWT_SECRET not set - app token validation disabled",
        );
      } else {
        if (
          process.env.BRIDGE_APP_TOKEN_SECRET &&
          process.env.DEVICE_JWT_SECRET &&
          process.env.BRIDGE_APP_TOKEN_SECRET !== process.env.DEVICE_JWT_SECRET
        ) {
          this.logger.warn(
            "BRIDGE_APP_TOKEN_SECRET and DEVICE_JWT_SECRET differ - bridge validation may fail",
          );
        }
        if (
          process.env.BRIDGE_APP_TOKEN_SECRET &&
          process.env.SUPABASE_JWT_SECRET &&
          process.env.BRIDGE_APP_TOKEN_SECRET !== process.env.SUPABASE_JWT_SECRET
        ) {
          this.logger.warn(
            "BRIDGE_APP_TOKEN_SECRET and SUPABASE_JWT_SECRET differ - bridge validation may fail",
          );
        }
      }
    } else {
      this.logger.warn("Supabase not configured - device auth disabled");
      this.logger.debug(
        "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable",
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Provision a device (called by device on first boot)
   */
  async provisionDevice(
    serialNumber: string,
    keyHash: string,
    firmwareVersion?: string,
    ipAddress?: string,
  ): Promise<ProvisionResult> {
    if (!this.enabled) {
      return { success: false, error: "Supabase not configured" };
    }

    try {
      const response = await fetch(
        `${this.supabaseUrl}/functions/v1/provision-device`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.supabaseKey}`,
          },
          body: JSON.stringify({
            serial_number: serialNumber,
            key_hash: keyHash,
            firmware_version: firmwareVersion,
            ip_address: ipAddress,
          }),
        },
      );

      const result = (await response.json()) as {
        device_id?: string;
        pairing_code?: string;
        error?: string;
      };

      if (!response.ok) {
        this.logger.error(`Provision device failed: ${result.error}`);
        return { success: false, error: result.error };
      }

      this.logger.info(
        `Device provisioned: ${serialNumber} -> ${result.pairing_code}`,
      );
      return {
        success: true,
        device_id: result.device_id,
        pairing_code: result.pairing_code,
      };
    } catch (error) {
      this.logger.error(`Provision device error: ${error}`);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Validate device HMAC authentication
   * Called when a device sends a message with auth headers
   */
  async validateDeviceAuth(
    serialNumber: string,
    timestamp: number,
    signature: string,
    body: string = "",
  ): Promise<AuthValidationResult> {
    if (!this.enabled) {
      // Supabase not configured - allow unauthenticated access for backward compatibility
      return { valid: true };
    }

    try {
      const response = await fetch(
        `${this.supabaseUrl}/functions/v1/validate-device`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.supabaseKey}`,
            "X-Device-Serial": serialNumber,
            "X-Timestamp": String(timestamp),
            "X-Signature": signature,
          },
          body: body || "",
        },
      );

      const result = (await response.json()) as {
        valid?: boolean;
        error?: string;
        device?: SupabaseDevice;
      };

      if (!response.ok || !result.valid) {
        this.logger.warn(
          `Device auth failed for ${serialNumber}: ${result.error}`,
        );
        return { valid: false, error: result.error };
      }

      return {
        valid: true,
        device: result.device,
      };
    } catch (error) {
      this.logger.error(`Validate device auth error: ${error}`);
      return { valid: false, error: String(error) };
    }
  }

  /**
   * Validate app authentication token (JWT signed with BRIDGE_APP_TOKEN_SECRET)
   * Called when an embedded app sends a join message with app_auth.token
   */
  async validateAppToken(token: string): Promise<AuthValidationResult> {
    if (!this.enabled) {
      // Supabase not configured - allow unauthenticated access for backward compatibility
      return { valid: true };
    }

    if (!this.appTokenSecret) {
      // App token secret not configured - skip validation
      this.logger.warn("App token validation skipped - BRIDGE_APP_TOKEN_SECRET not set");
      return { valid: true };
    }

    try {
      // Decode and verify the JWT token
      const parts = token.split(".");
      if (parts.length !== 3) {
        return { valid: false, error: "Invalid token format" };
      }

      // Decode payload (base64url)
      const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf8");
      const payload: AppTokenPayload = JSON.parse(payloadJson);

      // Check token type
      if (payload.type !== "app_auth") {
        return { valid: false, error: "Invalid token type" };
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: "Token expired" };
      }

      // Verify signature using HMAC-SHA256
      const { createHmac } = await import("crypto");
      const signatureInput = `${parts[0]}.${parts[1]}`;
      const expectedSignature = createHmac("sha256", this.appTokenSecret)
        .update(signatureInput)
        .digest("base64url");

      if (parts[2] !== expectedSignature) {
        return { valid: false, error: "Invalid token signature" };
      }

      // Token is valid - look up device to return device info
      const device = await this.getDeviceBySerial(payload.serial_number);
      if (!device) {
        return { valid: false, error: "Device not found" };
      }

      this.logger.debug(`App token validated for device ${payload.serial_number}`);

      return {
        valid: true,
        device,
      };
    } catch (error) {
      this.logger.error(`Validate app token error: ${error}`);
      return { valid: false, error: String(error) };
    }
  }

  /**
   * Get device by serial number
   */
  async getDeviceBySerial(
    serialNumber: string,
  ): Promise<SupabaseDevice | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/devices?serial_number=eq.${serialNumber}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.supabaseKey}`,
            apikey: this.supabaseKey,
            ...this.schemaHeaders,
          },
        },
      );

      const devices = (await response.json()) as SupabaseDevice[];
      return devices?.[0] || null;
    } catch (error) {
      this.logger.error(`Get device error: ${error}`);
      return null;
    }
  }

  /**
   * Update device last seen timestamp and info
   */
  async updateDeviceLastSeen(
    serialNumber: string,
    ipAddress?: string,
    firmwareVersion?: string,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const updates: Record<string, unknown> = {
        last_seen: new Date().toISOString(),
      };

      if (ipAddress) {
        updates.ip_address = ipAddress;
      }
      if (firmwareVersion) {
        updates.firmware_version = firmwareVersion;
      }

      await fetch(
        `${this.supabaseUrl}/rest/v1/devices?serial_number=eq.${serialNumber}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.supabaseKey}`,
            apikey: this.supabaseKey,
            Prefer: "return=minimal",
            ...this.schemaHeaders,
          },
          body: JSON.stringify(updates),
        },
      );
    } catch (error) {
      this.logger.error(`Update device error: ${error}`);
    }
  }

  /**
   * Insert a device log entry
   */
  async insertDeviceLog(
    deviceId: string,
    level: "debug" | "info" | "warn" | "error",
    message: string,
    metadata?: Record<string, unknown>,
    serialNumber?: string,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const logEntry: Record<string, unknown> = {
        device_id: deviceId,
        level,
        message,
        metadata: metadata || {},
      };

      // Include serial_number if provided (for Realtime filtering)
      if (serialNumber) {
        logEntry.serial_number = serialNumber;
      }

      await fetch(`${this.supabaseUrl}/rest/v1/device_logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.supabaseKey}`,
          apikey: this.supabaseKey,
          Prefer: "return=minimal",
          ...this.schemaHeaders,
        },
        body: JSON.stringify(logEntry),
      });
    } catch (error) {
      this.logger.error(`Insert device log error: ${error}`);
    }
  }

  /**
   * Get recent device logs
   */
  async getDeviceLogs(
    deviceId: string,
    limit: number = 100,
  ): Promise<Array<{ level: string; message: string; created_at: string }>> {
    if (!this.enabled) {
      return [];
    }

    try {
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/device_logs?device_id=eq.${deviceId}&order=created_at.desc&limit=${limit}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.supabaseKey}`,
            apikey: this.supabaseKey,
            ...this.schemaHeaders,
          },
        },
      );

      return (await response.json()) as Array<{
        level: string;
        message: string;
        created_at: string;
      }>;
    } catch (error) {
      this.logger.error(`Get device logs error: ${error}`);
      return [];
    }
  }

  /**
   * Enable/disable debug mode for a device
   */
  async setDeviceDebugMode(
    serialNumber: string,
    enabled: boolean,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      await fetch(
        `${this.supabaseUrl}/rest/v1/devices?serial_number=eq.${serialNumber}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.supabaseKey}`,
            apikey: this.supabaseKey,
            Prefer: "return=minimal",
            ...this.schemaHeaders,
          },
          body: JSON.stringify({ debug_enabled: enabled }),
        },
      );

      this.logger.info(
        `Debug mode ${enabled ? "enabled" : "disabled"} for ${serialNumber}`,
      );
    } catch (error) {
      this.logger.error(`Set debug mode error: ${error}`);
    }
  }
}
