/**
 * Configuration constants for the EmbeddedApp component.
 */

import type { StatusButtonConfig } from './types';

/**
 * Application configuration with storage keys, timeouts, and intervals.
 */
export const CONFIG = {
  /** LocalStorage key for debug visibility */
  storageKeyDebugVisible: 'led_matrix_debug_visible',
  /** LocalStorage key for Webex poll interval */
  storageKeyWebexPollInterval: 'led_matrix_webex_poll_interval',
  /** Refresh token 5 minutes before expiry */
  tokenRefreshThresholdMs: 5 * 60 * 1000,
  /** Update app_last_seen every 30 seconds */
  heartbeatIntervalMs: 30 * 1000,
  /** Command timeout (increased from 10s to 15s) */
  commandTimeoutMs: 15 * 1000,
  /** Base delay before attempting reconnection (doubles each attempt) */
  reconnectDelayMs: 2000,
  /** Maximum reconnection attempts per burst */
  reconnectMaxAttempts: 5,
  /** Maximum delay between reconnection attempts (exponential backoff cap) */
  reconnectMaxDelayMs: 30 * 1000,
  /** Random jitter added to reconnection delay to prevent thundering herd */
  reconnectJitterMs: 500,
  /** Cooldown period after max reconnection burst before retrying */
  reconnectCooldownMs: 60 * 1000,
  /** Connection staleness threshold for watchdog */
  staleConnectionThresholdMs: 2 * 60 * 1000,
  /** Watchdog check interval */
  watchdogIntervalMs: 30 * 1000,
  /** Default Webex API poll interval */
  webexPollIntervalMs: 30 * 1000,
} as const;

/**
 * Application version from environment.
 * Returns undefined if not set, allowing fallback to package.json in consumer.
 */
export const getAppVersion = (): string | undefined => {
  return process.env.NEXT_PUBLIC_APP_VERSION || undefined;
};

/**
 * Status button configurations for the status tab.
 */
export const statusButtons: StatusButtonConfig[] = [
  {
    status: 'active',
    label: 'Available',
    className: 'bg-status-active/20 text-status-active hover:bg-status-active/30',
  },
  {
    status: 'away',
    label: 'Away',
    className: 'bg-status-away/20 text-status-away hover:bg-status-away/30',
  },
  {
    status: 'meeting',
    label: 'In a Call',
    className: 'bg-status-meeting/20 text-status-meeting hover:bg-status-meeting/30',
  },
  {
    status: 'dnd',
    label: 'DND',
    className: 'bg-status-dnd/20 text-status-dnd hover:bg-status-dnd/30',
  },
];

/**
 * Maximum number of debug log entries to keep.
 */
export const MAX_DEBUG_LOG_ENTRIES = 200;

/**
 * Maximum number of activity log entries to keep.
 */
export const MAX_ACTIVITY_LOG_ENTRIES = 30;
