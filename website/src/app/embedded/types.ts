/**
 * Type definitions for the EmbeddedApp component and its sub-components.
 */

import type { WebexStatus } from '@/hooks/useWebexSDK';
import type { DeviceConfig as BaseDeviceConfig, DeviceStatus as BaseDeviceStatus } from '@/types';

/**
 * Tab identifiers for the main navigation.
 */
export type TabId = 'status' | 'webex' | 'devices';

/**
 * Debug log severity levels.
 */
export type DebugLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'activity';

/**
 * Extended device configuration interface matching firmware response from get_config command.
 * Extends base DeviceConfig with additional embedded-specific fields.
 */
export interface DeviceConfig extends Omit<BaseDeviceConfig, 'poll_interval' | 'pairing_code' | 'display_name'> {
  device_uuid?: string;
  user_uuid?: string | null;
  display_name?: string | null;
  last_webex_status?: string | null;
  serial_number?: string;
  firmware_version?: string;
  wifi_ssid?: string;
  wifi_rssi?: number;
  free_heap?: number;
  uptime_seconds?: number;
  brightness?: number;
  scroll_speed?: number;
  scroll_speed_ms?: number;
  page_interval_ms?: number;
  color_scheme?: string;
  sensor_page_enabled?: boolean;
  date_color?: string;
  time_color?: string;
  name_color?: string;
  metric_color?: string;
  poll_interval?: number;
  time_zone?: string;
  time_format?: string;
  date_format?: string;
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

/**
 * Realtime status event payload for webex_status broadcasts.
 */
export interface WebexStatusBroadcast {
  device_uuid: string;
  webex_status: string;
  in_call?: boolean;
  camera_on?: boolean;
  mic_muted?: boolean;
  display_name?: string;
  updated_at: string;
}
