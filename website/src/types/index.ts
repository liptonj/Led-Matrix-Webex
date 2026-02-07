// ESP Web Tools custom element declaration
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "esp-web-install-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          manifest?: string;
        },
        HTMLElement
      >;
    }
  }
}

// Firmware manifest types
export interface FirmwareAsset {
  name: string;
  url: string;
  size?: number;
}

export interface FirmwareVersion {
  tag: string;
  version: string;
  name: string;
  build_id: string;
  build_date: string;
  notes: string;
  prerelease: boolean;
  firmware: FirmwareAsset[];
}

export interface FirmwareManifest {
  version: string;
  build_id: string;
  build_date: string;
  firmware: Record<string, { url: string }>;
  bundle: Record<string, { url: string }>;
  generated: string;
  latest: string;
  versions: FirmwareVersion[];
}

// Bridge config types
export interface BridgeConfig {
  bridge: {
    url: string;
    fallback_url?: string;
  };
}

// Status types
export type WebexStatus =
  | "active"
  | "meeting"
  | "dnd"
  | "away"
  | "ooo"
  | "offline"
  | "unknown";

export interface StatusData {
  status: WebexStatus;
  display_name?: string;
  in_call?: boolean;
  camera_on?: boolean;
  mic_muted?: boolean;
  timestamp?: string;
}

// Device status types
export interface DeviceStatus {
  firmware_version?: string;
  firmware_build_id?: string;
  ip_address?: string;
  mac_address?: string;
  serial_number?: string;
  free_heap?: number;
  uptime?: number;
  rssi?: number;
  temperature?: number;
  ssid?: string;
  ota_partition?: string;
}

// Device config types
export interface DeviceConfig {
  device_name?: string;
  display_name?: string;
  brightness?: number;
  poll_interval?: number;
  pairing_code?: string;
  has_webex_tokens?: boolean;
  has_webex_credentials?: boolean;
  display_pages?: "status" | "sensors" | "rotate";
  status_layout?: "name" | "sensors";
}

// Navigation types
export interface NavItem {
  href: string;
  label: string;
  icon?: string;
  external?: boolean;
}

// Theme types
export type Theme = "light" | "dark";

// Database entity types
export interface Device {
  serial_number: string;
  pairing_code: string | null;
  paired_user_id: string | null;
  owner_user_id: string | null;
  created_at: string;
  last_seen: string | null;
  last_ip: string | null;
  firmware_version: string | null;
  target_firmware_version: string | null;
  debug_mode: boolean;
  approval_required: boolean;
  disabled: boolean;
  blacklisted: boolean;
}

export interface DeviceLog {
  id: string;
  device_serial: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  component: string | null;
  created_at: string;
}

export interface Command {
  id: string;
  device_serial: string;
  command: string;
  parameters: Record<string, unknown>;
  status: "pending" | "sent" | "acknowledged" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  created_by: string | null;
  response: string | null;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
  is_admin: boolean;
  is_disabled: boolean;
  webex_user_id: string | null;
  webex_access_token: string | null;
  webex_refresh_token: string | null;
  webex_token_expires_at: string | null;
}

export interface Release {
  version: string;
  created_at: string;
  release_notes: string | null;
  minimum_version: string | null;
  is_beta: boolean;
  is_deprecated: boolean;
  file_path: string;
  file_size: number;
  checksum: string;
}

// Support session types
export type {
  SupportSession,
  SupportSessionStatus,
  SerialOutputEvent,
  FlashProgressEvent,
  DeviceInfoEvent,
  ActionResultEvent,
  HeartbeatEvent,
  SerialInputEvent,
  ActionType,
  ActionEvent,
  SessionEndEvent,
  UserToAdminEvent,
  AdminToUserEvent,
  TerminalLineSource,
  TerminalLineLevel,
  TerminalLine,
  SerialPortStatus,
  FlashStatus,
  BridgeHealth,
} from './support';

export { };

