/**
 * Test Data Fixtures
 *
 * Reusable test data for consistent testing across the application.
 */

import type { Command, Device, DeviceConfig, DeviceLog, Release, User } from "@/types";

/**
 * Creates a mock device with sensible defaults
 */
export function createMockDevice(overrides?: Partial<Device>): Device {
  const now = new Date().toISOString();
  
  return {
    serial_number: "TEST-DEVICE-001",
    pairing_code: "ABC123",
    paired_user_id: null,
    owner_user_id: null,
    created_at: now,
    last_seen: now,
    last_ip: "192.168.1.100",
    firmware_version: "1.0.0",
    target_firmware_version: null,
    debug_mode: false,
    approval_required: false,
    disabled: false,
    blacklisted: false,
    ...overrides,
  };
}

/**
 * Creates a mock device config with sensible defaults
 */
export function createMockDeviceConfig(overrides?: Partial<DeviceConfig>): DeviceConfig {
  return {
    device_name: "Test Device",
    display_name: "Test User",
    brightness: 50,
    poll_interval: 30,
    pairing_code: "ABC123",
    has_webex_tokens: false,
    has_webex_credentials: false,
    display_pages: "status",
    status_layout: "name",
    ...overrides,
  };
}

/**
 * Creates a mock device log entry
 */
export function createMockDeviceLog(overrides?: Partial<DeviceLog>): DeviceLog {
  const now = new Date().toISOString();
  
  return {
    id: `log-${Date.now()}`,
    device_serial: "TEST-DEVICE-001",
    timestamp: now,
    level: "info",
    message: "Test log message",
    component: "test",
    created_at: now,
    ...overrides,
  };
}

/**
 * Creates a mock command
 */
export function createMockCommand(overrides?: Partial<Command>): Command {
  const now = new Date().toISOString();
  
  return {
    id: `cmd-${Date.now()}`,
    device_serial: "TEST-DEVICE-001",
    command: "test_command",
    parameters: {},
    status: "pending",
    created_at: now,
    updated_at: now,
    created_by: "admin",
    response: null,
    ...overrides,
  };
}

/**
 * Creates a mock user
 */
export function createMockUser(overrides?: Partial<User>): User {
  const now = new Date().toISOString();
  
  return {
    id: "user-123",
    email: "test@example.com",
    full_name: "Test User",
    created_at: now,
    updated_at: now,
    is_admin: false,
    is_disabled: false,
    webex_user_id: null,
    webex_access_token: null,
    webex_refresh_token: null,
    webex_token_expires_at: null,
    ...overrides,
  };
}

/**
 * Creates a mock firmware release
 */
export function createMockRelease(overrides?: Partial<Release>): Release {
  const now = new Date().toISOString();
  
  return {
    version: "1.0.0",
    created_at: now,
    release_notes: "Test release",
    minimum_version: null,
    is_beta: false,
    is_deprecated: false,
    file_path: "/firmware/test-1.0.0.bin",
    file_size: 1024000,
    checksum: "abc123def456",
    ...overrides,
  };
}

/**
 * Creates mock device heartbeat data
 */
export interface DeviceHeartbeat {
  serial_number: string;
  last_seen: string;
  last_ip: string;
}

export function createMockHeartbeat(overrides?: Partial<DeviceHeartbeat>): DeviceHeartbeat {
  return {
    serial_number: "TEST-DEVICE-001",
    last_seen: new Date().toISOString(),
    last_ip: "192.168.1.100",
    ...overrides,
  };
}

/**
 * Creates multiple mock devices for list testing
 */
export function createMockDeviceList(count: number): Device[] {
  return Array.from({ length: count }, (_, i) =>
    createMockDevice({
      serial_number: `TEST-DEVICE-${String(i + 1).padStart(3, "0")}`,
      pairing_code: `CODE${i + 1}`,
    })
  );
}

/**
 * Creates multiple mock logs for testing pagination
 */
export function createMockLogList(count: number, deviceSerial?: string): DeviceLog[] {
  return Array.from({ length: count }, (_, i) =>
    createMockDeviceLog({
      id: `log-${Date.now()}-${i}`,
      device_serial: deviceSerial ?? "TEST-DEVICE-001",
      message: `Log message ${i + 1}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
    })
  );
}

/**
 * Creates multiple mock commands for testing
 */
export function createMockCommandList(count: number, deviceSerial?: string): Command[] {
  return Array.from({ length: count }, (_, i) =>
    createMockCommand({
      id: `cmd-${Date.now()}-${i}`,
      device_serial: deviceSerial ?? "TEST-DEVICE-001",
      command: `command_${i + 1}`,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    })
  );
}

/**
 * Mock environment variables for testing
 */
export function setMockEnv(env: Record<string, string>): void {
  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

/**
 * Clear specific environment variables
 */
export function clearMockEnv(keys: string[]): void {
  keys.forEach(key => {
    delete process.env[key];
  });
}

/**
 * Common test environment setup
 */
export function setupTestEnv(): void {
  setMockEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    NEXT_PUBLIC_WEBEX_CLIENT_ID: "test-client-id",
    NEXT_PUBLIC_WEBEX_REDIRECT_URI: "http://localhost:3000/callback",
  });
}

/**
 * Clean up test environment
 */
export function cleanupTestEnv(): void {
  clearMockEnv([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_WEBEX_CLIENT_ID",
    "NEXT_PUBLIC_WEBEX_REDIRECT_URI",
  ]);
}
