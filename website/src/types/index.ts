// ESP Web Tools custom element declaration
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'esp-web-install-button': React.DetailedHTMLProps<
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
export type WebexStatus = 'active' | 'meeting' | 'dnd' | 'away' | 'ooo' | 'offline' | 'unknown';

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
  webex_status: WebexStatus;
  camera_on: boolean;
  mic_muted: boolean;
  in_call: boolean;
  firmware_version: string;
  firmware_build_id?: string;
  ip_address: string;
  free_heap: number;
  uptime: number;
  rssi: number;
}

// Device config types
export interface DeviceConfig {
  device_name: string;
  display_name: string;
  brightness: number;
  poll_interval: number;
  pairing_code?: string;
  has_webex_tokens?: boolean;
  has_webex_credentials?: boolean;
}

// Navigation types
export interface NavItem {
  href: string;
  label: string;
  icon?: string;
  external?: boolean;
}

// Theme types
export type Theme = 'light' | 'dark';

export {}
