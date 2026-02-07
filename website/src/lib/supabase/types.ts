export interface Device {
  id: string;
  serial_number: string;
  device_id: string;
  pairing_code: string;
  display_name: string | null;
  firmware_version: string | null;
  target_firmware_version: string | null;
  ip_address: string | null;
  last_seen: string;
  debug_enabled: boolean;
  is_provisioned: boolean;
  approval_required: boolean;
  disabled: boolean;
  blacklisted: boolean;
  registered_at: string;
  provisioned_at: string | null;
  metadata: Record<string, unknown>;
  release_channel: 'beta' | 'production';
  paired_user_name?: string | null;
  paired_user_email?: string | null;
}

export interface DeviceLog {
  id: string;
  device_id: string;
  serial_number: string | null;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Release {
  id: string;
  version: string;
  tag: string;
  name: string | null;
  notes: string | null;
  firmware_url: string;
  firmware_merged_url: string | null;
  firmware_size: number | null;
  build_id: string | null;
  build_date: string | null;
  is_latest: boolean;
  is_prerelease: boolean;
  rollout_percentage: number;
  release_channel: 'beta' | 'production';
  created_at: string;
  created_by: string | null;
}

export interface DeviceChangeEvent {
  event: "INSERT" | "UPDATE" | "DELETE";
  new: Device | null;
  old: Device | null;
}

export interface UserProfile {
  user_id: string;
  email: string;
  role: "admin" | "user";
  first_name: string | null;
  last_name: string | null;
  disabled: boolean;
  created_at: string;
  created_by: string | null;
}

export interface UserDeviceAssignment {
  id: string;
  user_id: string;
  serial_number: string;
  created_at: string;
  created_by: string | null;
}

export interface OAuthClient {
  id: string;
  provider: string;
  client_id: string;
  redirect_uri: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Pairing {
  pairing_code: string;
  serial_number: string;
  device_id: string | null;
  device_uuid: string | null;
  user_uuid: string | null;
  app_last_seen: string | null;
  device_last_seen: string | null;
  app_connected: boolean;
  device_connected: boolean;
  webex_status: string;
  camera_on: boolean;
  mic_muted: boolean;
  in_call: boolean;
  display_name: string | null;
  rssi: number | null;
  free_heap: number | null;
  uptime: number | null;
  temperature: number | null;
  firmware_version: string | null;
  ssid: string | null;
  ota_partition: string | null;
  config: Record<string, unknown>;
  status_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Command {
  id: string;
  pairing_code: string;
  serial_number: string;
  command: string;
  payload: Record<string, unknown>;
  status: "pending" | "acked" | "failed" | "expired";
  created_at: string;
  acked_at: string | null;
  expires_at: string;
  response: Record<string, unknown> | null;
  error: string | null;
}
