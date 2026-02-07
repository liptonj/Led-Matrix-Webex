/**
 * Remote support console feature type definitions.
 * 
 * These types define the database entity, Realtime channel events,
 * and terminal line metadata for the support session feature.
 */

/**
 * Support session entity matching the display.support_sessions table.
 * Represents a remote support session between a user and an admin.
 */
export interface SupportSession {
  id: string;
  user_id: string;
  admin_id: string | null;
  status: 'waiting' | 'active' | 'closed';
  device_serial: string | null;
  device_chip: string | null;
  device_firmware: string | null;
  created_at: string;
  joined_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
}

export type SupportSessionStatus = SupportSession['status'];

/**
 * Serial output event sent from user browser to admin.
 * Contains text output from the device serial port.
 */
export interface SerialOutputEvent {
  text: string;
  ts: number;
}

/**
 * Flash progress event sent from user browser to admin.
 * Reports progress during firmware flashing operations.
 */
export interface FlashProgressEvent {
  phase: string;
  percent: number;
  message: string;
}

/**
 * Device information event sent from user browser to admin.
 * Contains device identification details.
 */
export interface DeviceInfoEvent {
  chip: string;
  serial?: string;
  firmware?: string;
}

/**
 * Action result event sent from user browser to admin.
 * Reports the success or failure of an action command.
 */
export interface ActionResultEvent {
  action: string;
  success: boolean;
  error?: string;
}

/**
 * Heartbeat event sent from user browser to admin.
 * Indicates connection health status.
 */
export interface HeartbeatEvent {
  connected: boolean;
  ts: number;
}

/**
 * Serial input event sent from admin to user browser.
 * Contains text input to be sent to the device serial port.
 */
export interface SerialInputEvent {
  text: string;
}

/**
 * Action types that can be sent from admin to user browser.
 */
export type ActionType = 'reset' | 'bootloader' | 'flash' | 'flash_abort';

/**
 * Action event sent from admin to user browser.
 * Triggers a device action command.
 */
export interface ActionEvent {
  type: ActionType;
  manifestUrl?: string;
}

/**
 * Session end event sent from admin to user browser.
 * Signals that the support session should be terminated.
 */
export interface SessionEndEvent {
  reason: string;
}

/**
 * Shim hello event - PIO bridge announces itself.
 * Sent from admin (shim) to user browser.
 */
export interface ShimHelloEvent {
  type: 'pio_bridge';
}

/**
 * Signal event from shim to browser - raw DTR/RTS control.
 * Sent from admin (shim) to user browser.
 */
export interface SignalEvent {
  dtr: boolean;
  rts: boolean;
}

/**
 * Baud rate change request from shim to browser.
 * Sent from admin (shim) to user browser.
 */
export interface SetBaudEvent {
  rate: number;
}

/**
 * Baud rate change confirmation from browser to shim.
 * Sent from user browser to admin (shim).
 */
export interface BaudAckEvent {
  rate: number;
}

/**
 * Binary serial input event from shim (extends regular serial_input).
 * Sent from admin (shim) to user browser.
 */
export interface BinarySerialInputEvent {
  data: string; // base64-encoded bytes
  binary: true;
  chunk?: number;
}

/**
 * Binary serial output event from browser to shim.
 * Sent from user browser to admin (shim).
 */
export interface BinarySerialOutputEvent {
  data: string; // base64-encoded bytes
  binary: true;
}

/**
 * Union type for all events sent from user browser to admin.
 */
export type UserToAdminEvent =
  | { event: 'serial_output'; payload: SerialOutputEvent }
  | { event: 'serial_output'; payload: BinarySerialOutputEvent }
  | { event: 'flash_progress'; payload: FlashProgressEvent }
  | { event: 'device_info'; payload: DeviceInfoEvent }
  | { event: 'action_result'; payload: ActionResultEvent }
  | { event: 'heartbeat'; payload: HeartbeatEvent }
  | { event: 'baud_ack'; payload: BaudAckEvent };

/**
 * Union type for all events sent from admin to user browser.
 */
export type AdminToUserEvent =
  | { event: 'serial_input'; payload: SerialInputEvent }
  | { event: 'serial_input'; payload: BinarySerialInputEvent }
  | { event: 'action'; payload: ActionEvent }
  | { event: 'session_end'; payload: SessionEndEvent }
  | { event: 'shim_hello'; payload: ShimHelloEvent }
  | { event: 'signal'; payload: SignalEvent }
  | { event: 'set_baud'; payload: SetBaudEvent };

/**
 * Source of a terminal line (where it originated).
 */
export type TerminalLineSource = 'device' | 'admin' | 'system';

/**
 * Severity level of a terminal line.
 */
export type TerminalLineLevel = 'info' | 'warn' | 'error';

/**
 * Terminal line with metadata for display in the console.
 * Represents a single line of output in the support console terminal.
 */
export interface TerminalLine {
  text: string;
  source: TerminalLineSource;
  level?: TerminalLineLevel;
  timestamp: number;
}

/**
 * Serial port connection status.
 */
export type SerialPortStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Firmware flash operation status.
 */
export type FlashStatus =
  | 'idle'
  | 'connecting'
  | 'erasing'
  | 'flashing'
  | 'verifying'
  | 'resetting'
  | 'complete'
  | 'error';

/**
 * Bridge connection health status.
 */
export type BridgeHealth = 'unknown' | 'healthy' | 'degraded' | 'disconnected';
