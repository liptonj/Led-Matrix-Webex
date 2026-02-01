/**
 * Type definitions for the EmbeddedApp component and its sub-components.
 */

import type { WebexStatus } from '@/hooks/useWebexSDK';
import type { DeviceConfig as BaseDeviceConfig, DeviceStatus as BaseDeviceStatus } from '@/types';

/**
 * App authentication token returned from the exchange-pairing-code Edge Function.
 */
export interface AppToken {
  serial_number: string;
  device_id: string;
  token: string;
  expires_at: string;
}

/**
 * Tab identifiers for the main navigation.
 */
export type TabId = 'status' | 'display' | 'mqtt' | 'webex' | 'system';

/**
 * Debug log severity levels.
 */
export type DebugLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'activity';

/**
 * Extended device configuration interface matching firmware response from get_config command.
 * Extends base DeviceConfig with additional embedded-specific fields.
 */
export interface DeviceConfig extends Omit<BaseDeviceConfig, 'poll_interval' | 'pairing_code'> {
  scroll_speed_ms?: number;
  page_interval_ms?: number;
  sensor_page_enabled?: boolean;
  date_color?: string;
  time_color?: string;
  name_color?: string;
  metric_color?: string;
  poll_interval?: number;
  time_zone?: string;
  time_format?: string;
  date_format?: string;
  pairing_code?: string;
  mqtt_broker?: string;
  mqtt_port?: number;
  mqtt_username?: string;
  has_mqtt_password?: boolean;
  mqtt_topic?: string;
  display_sensor_mac?: string;
  display_metric?: string;
  sensor_macs?: string;
  sensor_serial?: string;
}

/**
 * Extended device status interface matching firmware response from get_status command.
 * Extends base DeviceStatus with Webex-specific connection and call state fields.
 */
export interface DeviceStatus extends BaseDeviceStatus {
  wifi_connected?: boolean;
  webex_authenticated?: boolean;
  bridge_connected?: boolean;
  webex_status?: string;
  camera_on?: boolean;
  mic_muted?: boolean;
  in_call?: boolean;
  pairing_code?: string;
  humidity?: number;
}

/**
 * A single entry in the debug console log.
 */
export interface DebugEntry {
  time: string;
  level: DebugLevel;
  message: string;
}

/**
 * Activity log entry for the status tab.
 */
export interface ActivityLogEntry {
  time: string;
  message: string;
}

/**
 * Realtime connection status.
 */
export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Status button configuration for the status tab.
 */
export interface StatusButtonConfig {
  status: WebexStatus;
  label: string;
  className: string;
}

/**
 * OAuth status for Webex authorization flow.
 */
export type WebexOAuthStatus = 'idle' | 'starting' | 'error';
