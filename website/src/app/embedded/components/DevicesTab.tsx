'use client';

import { Button, Card } from '@/components/ui';
import { memo } from 'react';
import type { DeviceStatus } from '../types';

export interface DevicesTabProps {
  // Display settings
  deviceName: string;
  onDeviceNameChange: (value: string) => void;
  manualDisplayName: string;
  onDisplayNameChange: (value: string) => void;
  onDisplayNameBlur: () => void;
  brightness: number;
  onBrightnessChange: (value: number) => void;
  scrollSpeedMs: number;
  onScrollSpeedChange: (value: number) => void;
  pageIntervalMs: number;
  onPageIntervalChange: (value: number) => void;
  displayPages: 'status' | 'sensors' | 'rotate';
  onDisplayPagesChange: (value: 'status' | 'sensors' | 'rotate') => void;
  statusLayout: 'name' | 'sensors';
  onStatusLayoutChange: (value: 'name' | 'sensors') => void;
  dateColor: string;
  onDateColorChange: (value: string) => void;
  timeColor: string;
  onTimeColorChange: (value: string) => void;
  nameColor: string;
  onNameColorChange: (value: string) => void;
  metricColor: string;
  onMetricColorChange: (value: string) => void;
  // MQTT settings
  mqttBroker: string;
  onMqttBrokerChange: (value: string) => void;
  mqttPort: number;
  onMqttPortChange: (value: number) => void;
  mqttUsername: string;
  onMqttUsernameChange: (value: string) => void;
  mqttPassword: string;
  onMqttPasswordChange: (value: string) => void;
  mqttTopic: string;
  onMqttTopicChange: (value: string) => void;
  hasMqttPassword: boolean;
  displaySensorMac: string;
  onDisplaySensorMacChange: (value: string) => void;
  displayMetric: string;
  onDisplayMetricChange: (value: string) => void;
  // System info
  deviceStatus: DeviceStatus;
  appVersion: string;
  isBridgeConnected: boolean;
  isPeerConnected: boolean;
  isSaving: boolean;
  isRebooting: boolean;
  onSaveSettings: () => void;
  onReboot: () => void;
  onDisconnect: () => void;
}

export const DevicesTab = memo(function DevicesTab({
  deviceName,
  onDeviceNameChange,
  manualDisplayName,
  onDisplayNameChange,
  onDisplayNameBlur,
  brightness,
  onBrightnessChange,
  scrollSpeedMs,
  onScrollSpeedChange,
  pageIntervalMs,
  onPageIntervalChange,
  displayPages,
  onDisplayPagesChange,
  statusLayout,
  onStatusLayoutChange,
  dateColor,
  onDateColorChange,
  timeColor,
  onTimeColorChange,
  nameColor,
  onNameColorChange,
  metricColor,
  onMetricColorChange,
  mqttBroker,
  onMqttBrokerChange,
  mqttPort,
  onMqttPortChange,
  mqttUsername,
  onMqttUsernameChange,
  mqttPassword,
  onMqttPasswordChange,
  mqttTopic,
  onMqttTopicChange,
  hasMqttPassword,
  displaySensorMac,
  onDisplaySensorMacChange,
  displayMetric,
  onDisplayMetricChange,
  deviceStatus,
  appVersion,
  isBridgeConnected,
  isPeerConnected,
  isSaving,
  isRebooting,
  onSaveSettings,
  onReboot,
  onDisconnect,
}: DevicesTabProps) {
  return (
    <div className="space-y-6">
      {/* Display Settings */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">Display Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Device Name</label>
            <input
              type="text"
              placeholder="webex-display"
              value={deviceName}
              onChange={(e) => onDeviceNameChange(e.target.value)}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
              disabled={!isPeerConnected}
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-1">mDNS hostname</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Your Name</label>
            <input
              type="text"
              placeholder="John Doe"
              value={manualDisplayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              onBlur={onDisplayNameBlur}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-1">Name shown on display</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Brightness: {brightness}</label>
            <input
              type="range"
              min="10"
              max="255"
              value={brightness}
              onChange={(e) => onBrightnessChange(parseInt(e.target.value, 10))}
              className="w-full"
              disabled={!isPeerConnected}
            />
            <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
              <span>Dim</span>
              <span>Bright</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Scroll Speed: {scrollSpeedMs}ms</label>
            <input
              type="range"
              min="50"
              max="1000"
              step="50"
              value={scrollSpeedMs}
              onChange={(e) => onScrollSpeedChange(parseInt(e.target.value, 10))}
              className="w-full"
              disabled={!isPeerConnected}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Page Rotation: {pageIntervalMs / 1000}s</label>
            <input
              type="range"
              min="2000"
              max="30000"
              step="1000"
              value={pageIntervalMs}
              onChange={(e) => onPageIntervalChange(parseInt(e.target.value, 10))}
              className="w-full"
              disabled={!isPeerConnected}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Pages to Show</label>
            <select
              value={displayPages}
              onChange={(e) => onDisplayPagesChange(e.target.value as 'status' | 'sensors' | 'rotate')}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
              disabled={!isPeerConnected}
            >
              <option value="status">Status only</option>
              <option value="sensors">Sensors only</option>
              <option value="rotate">Rotate status & sensors</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Status Layout</label>
            <select
              value={statusLayout}
              onChange={(e) => onStatusLayoutChange(e.target.value as 'name' | 'sensors')}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
              disabled={!isPeerConnected}
            >
              <option value="name">Name large</option>
              <option value="sensors">Sensors large</option>
            </select>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">Text Colors</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Date</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={dateColor}
                    onChange={(e) => onDateColorChange(e.target.value)}
                    className="h-10 w-16 rounded border border-[var(--color-border)]"
                    disabled={!isPeerConnected}
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">{dateColor.toUpperCase()}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Time</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={timeColor}
                    onChange={(e) => onTimeColorChange(e.target.value)}
                    className="h-10 w-16 rounded border border-[var(--color-border)]"
                    disabled={!isPeerConnected}
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">{timeColor.toUpperCase()}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Name</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={nameColor}
                    onChange={(e) => onNameColorChange(e.target.value)}
                    className="h-10 w-16 rounded border border-[var(--color-border)]"
                    disabled={!isPeerConnected}
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">{nameColor.toUpperCase()}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Metric</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={metricColor}
                    onChange={(e) => onMetricColorChange(e.target.value)}
                    className="h-10 w-16 rounded border border-[var(--color-border)]"
                    disabled={!isPeerConnected}
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">{metricColor.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            onClick={onSaveSettings}
            disabled={!isPeerConnected || isSaving}
            className="mt-6"
          >
            {isSaving ? 'Saving...' : 'Save Display Settings'}
          </Button>
        </div>
      </Card>

      {/* MQTT Settings */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">MQTT Settings</h2>
        <p className="text-sm text-[var(--color-text-muted)] mb-6">
          Configure MQTT broker connection for sensor data display.
        </p>
        {!isPeerConnected && (
          <p className="text-sm text-warning mb-4">Connect a display to save changes.</p>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">MQTT Broker</label>
            <input
              type="text"
              placeholder="mqtt.example.com"
              value={mqttBroker}
              onChange={(e) => onMqttBrokerChange(e.target.value)}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
              disabled={isSaving}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Port</label>
              <input
                type="number"
                min="1"
                max="65535"
                value={mqttPort}
                onChange={(e) => onMqttPortChange(parseInt(e.target.value, 10) || 1883)}
                className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                disabled={isSaving}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Username</label>
              <input
                type="text"
                placeholder="Optional"
                value={mqttUsername}
                onChange={(e) => onMqttUsernameChange(e.target.value)}
                className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                disabled={isSaving}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">
              Password{hasMqttPassword && <span className="ml-2 text-xs text-[var(--color-text-muted)]">(set)</span>}
            </label>
            <input
              type="password"
              placeholder={hasMqttPassword ? 'Enter new to change' : 'Enter password'}
              value={mqttPassword}
              onChange={(e) => onMqttPasswordChange(e.target.value)}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
              disabled={isSaving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Topic</label>
            <input
              type="text"
              placeholder="meraki/v1/mt/#"
              value={mqttTopic}
              onChange={(e) => onMqttTopicChange(e.target.value)}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] font-mono"
              disabled={isSaving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Display Sensor MAC</label>
            <input
              type="text"
              placeholder="AA:BB:CC:DD:EE:FF"
              value={displaySensorMac}
              onChange={(e) => onDisplaySensorMacChange(e.target.value)}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] font-mono"
              disabled={isSaving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Display Metric</label>
            <select
              value={displayMetric}
              onChange={(e) => onDisplayMetricChange(e.target.value)}
              className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
              disabled={isSaving}
            >
              <option value="tvoc">TVOC</option>
              <option value="co2">CO2</option>
              <option value="pm2_5">PM2.5</option>
              <option value="noise">Noise</option>
            </select>
          </div>
        </div>
        <Button
          variant="primary"
          onClick={onSaveSettings}
          disabled={!isPeerConnected || isSaving}
          className="mt-6"
        >
          {isSaving ? 'Saving...' : 'Save MQTT Settings'}
        </Button>
      </Card>

      {/* System Information */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">System Information</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-[var(--color-text-muted)]">Serial:</span>
            <span className="ml-2 font-mono">{deviceStatus?.serial_number || 'Unknown'}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">App Version:</span>
            <span className="ml-2">v{appVersion}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Connection:</span>
            <span className="ml-2">{isBridgeConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Display:</span>
            <span className="ml-2">{isPeerConnected ? 'Yes' : 'No'}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Firmware:</span>
            <span className="ml-2">{deviceStatus?.firmware_version || 'Unknown'}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Free Memory:</span>
            <span className="ml-2">
              {deviceStatus?.free_heap ? `${Math.round(deviceStatus.free_heap / 1024)} KB` : 'Unknown'}
            </span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">IP:</span>
            <span className="ml-2">{deviceStatus?.ip_address || 'Unknown'}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">WiFi:</span>
            <span className="ml-2">{deviceStatus?.rssi ? `${deviceStatus.rssi} dBm` : 'Unknown'}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Uptime:</span>
            <span className="ml-2">
              {deviceStatus?.uptime
                ? `${Math.floor(deviceStatus.uptime / 3600)}h ${Math.floor((deviceStatus.uptime % 3600) / 60)}m`
                : 'Unknown'}
            </span>
          </div>
        </div>
        {deviceStatus?.temperature !== undefined && deviceStatus.temperature > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
            <h3 className="font-medium mb-2">Sensor Data</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[var(--color-text-muted)]">Temperature:</span>
                <span className="ml-2">{deviceStatus.temperature}°C</span>
              </div>
              {deviceStatus?.humidity !== undefined && deviceStatus.humidity > 0 && (
                <div>
                  <span className="text-[var(--color-text-muted)]">Humidity:</span>
                  <span className="ml-2">{deviceStatus.humidity}%</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Device Actions */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">Device Actions</h2>
        <p className="text-sm text-[var(--color-text-muted)] mb-4">
          Restart the display device if it&apos;s not responding.
        </p>
        <div className="flex gap-4">
          <Button
            variant="warning"
            onClick={onReboot}
            disabled={isRebooting || !isPeerConnected}
          >
            {isRebooting ? 'Rebooting...' : 'Reboot Device'}
          </Button>
          <Button variant="warning" onClick={onDisconnect}>
            Disconnect Display
          </Button>
        </div>
        {!isPeerConnected && (
          <p className="text-xs text-[var(--color-text-muted)] mt-2">Connect to a display first.</p>
        )}
      </Card>
    </div>
  );
});
