'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceConfig, DeviceStatus } from '../types';
import type { CommandResponse } from './useDeviceCommands';

export interface UseDeviceConfigOptions {
  isPeerConnected: boolean;
  sendCommand: (command: string, payload?: Record<string, unknown>) => Promise<CommandResponse>;
  addLog: (message: string) => void;
}

export interface UseDeviceConfigResult {
  deviceConfig: DeviceConfig | null;
  deviceStatus: DeviceStatus;
  brightness: number;
  setBrightness: (value: number) => void;
  scrollSpeedMs: number;
  setScrollSpeedMs: (value: number) => void;
  pageIntervalMs: number;
  setPageIntervalMs: (value: number) => void;
  displayPages: 'status' | 'sensors' | 'rotate';
  setDisplayPages: (value: 'status' | 'sensors' | 'rotate') => void;
  statusLayout: 'name' | 'sensors';
  setStatusLayout: (value: 'name' | 'sensors') => void;
  deviceName: string;
  setDeviceName: (value: string) => void;
  manualDisplayName: string;
  setManualDisplayName: (value: string) => void;
  dateColor: string;
  setDateColor: (value: string) => void;
  timeColor: string;
  setTimeColor: (value: string) => void;
  nameColor: string;
  setNameColor: (value: string) => void;
  metricColor: string;
  setMetricColor: (value: string) => void;
  mqttBroker: string;
  setMqttBroker: (value: string) => void;
  mqttPort: number;
  setMqttPort: (value: number) => void;
  mqttUsername: string;
  setMqttUsername: (value: string) => void;
  mqttPassword: string;
  setMqttPassword: (value: string) => void;
  mqttTopic: string;
  setMqttTopic: (value: string) => void;
  hasMqttPassword: boolean;
  displaySensorMac: string;
  setDisplaySensorMac: (value: string) => void;
  displayMetric: string;
  setDisplayMetric: (value: string) => void;
  isSaving: boolean;
  isRebooting: boolean;
  handleSaveSettings: () => Promise<void>;
  handleReboot: () => Promise<void>;
  handleBrightnessChange: (value: number) => void;
  setDeviceStatus: (status: DeviceStatus) => void;
  fetchDeviceConfig: () => Promise<void>;
  fetchDeviceStatus: () => Promise<void>;
}

const defaultDeviceStatus: DeviceStatus = { serial_number: '', firmware_version: '', ip_address: '', rssi: 0, uptime: 0, free_heap: 0, temperature: 0, humidity: 0 };

/**
 * Safely cast unknown response data to DeviceConfig.
 * The firmware is trusted to return data in the correct format.
 */
function asDeviceConfig(data: unknown): DeviceConfig {
  return data as DeviceConfig;
}

/**
 * Safely cast unknown response data to DeviceStatus.
 * The firmware is trusted to return data in the correct format.
 */
function asDeviceStatus(data: unknown): DeviceStatus {
  return data as DeviceStatus;
}

export function useDeviceConfig({ isPeerConnected, sendCommand, addLog }: UseDeviceConfigOptions): UseDeviceConfigResult {
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>(defaultDeviceStatus);
  const [brightness, setBrightness] = useState(128);
  const [scrollSpeedMs, setScrollSpeedMs] = useState(250);
  const [pageIntervalMs, setPageIntervalMs] = useState(5000);
  const [displayPages, setDisplayPages] = useState<'status' | 'sensors' | 'rotate'>('rotate');
  const [statusLayout, setStatusLayout] = useState<'name' | 'sensors'>('sensors');
  const [deviceName, setDeviceName] = useState('');
  const [manualDisplayName, setManualDisplayName] = useState('User');
  const [dateColor, setDateColor] = useState('#00ffff');
  const [timeColor, setTimeColor] = useState('#ffffff');
  const [nameColor, setNameColor] = useState('#ffa500');
  const [metricColor, setMetricColor] = useState('#00bfff');
  const [mqttBroker, setMqttBroker] = useState('');
  const [mqttPort, setMqttPort] = useState(1883);
  const [mqttUsername, setMqttUsername] = useState('');
  const [mqttPassword, setMqttPassword] = useState('');
  const [mqttTopic, setMqttTopic] = useState('meraki/v1/mt/#');
  const [hasMqttPassword, setHasMqttPassword] = useState(false);
  const [displaySensorMac, setDisplaySensorMac] = useState('');
  const [displayMetric, setDisplayMetric] = useState('tvoc');
  const [isSaving, setIsSaving] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);
  const brightnessTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleBrightnessChange = useCallback((value: number) => {
    setBrightness(value);
    if (!isPeerConnected) return;
    if (brightnessTimeoutRef.current) clearTimeout(brightnessTimeoutRef.current);
    brightnessTimeoutRef.current = setTimeout(async () => { try { await sendCommand('set_brightness', { value }); } catch { /* brightness update failed - will retry on next change */ } }, 150);
  }, [isPeerConnected, sendCommand]);

  const handleSaveSettings = useCallback(async () => {
    if (!isPeerConnected) { addLog('Cannot save - display not connected'); return; }
    setIsSaving(true);
    addLog('Saving display settings...');
    try {
      const configPayload: Record<string, unknown> = { device_name: deviceName, display_name: manualDisplayName, brightness, scroll_speed_ms: scrollSpeedMs, page_interval_ms: pageIntervalMs, sensor_page_enabled: displayPages === 'rotate', display_pages: displayPages, status_layout: statusLayout, date_color: dateColor, time_color: timeColor, name_color: nameColor, metric_color: metricColor };
      if (mqttBroker.trim()) { configPayload.mqtt_broker = mqttBroker.trim(); configPayload.mqtt_port = mqttPort; configPayload.mqtt_username = mqttUsername; if (mqttPassword.trim()) configPayload.mqtt_password = mqttPassword.trim(); configPayload.mqtt_topic = mqttTopic.trim() || 'meraki/v1/mt/#'; }
      if (displaySensorMac.trim()) configPayload.display_sensor_mac = displaySensorMac.trim();
      if (displayMetric) configPayload.display_metric = displayMetric;
      const response = await sendCommand('set_config', configPayload);
      if (response.success) {
        addLog('Settings saved successfully');
        if (response.data) {
          const config = asDeviceConfig(response.data);
          setDeviceConfig(config);
          if (config.brightness !== undefined) setBrightness(config.brightness);
          if (config.scroll_speed_ms !== undefined) setScrollSpeedMs(config.scroll_speed_ms);
          if (config.page_interval_ms !== undefined) setPageIntervalMs(config.page_interval_ms);
          if (config.display_pages) setDisplayPages(config.display_pages);
          else if (config.sensor_page_enabled !== undefined) setDisplayPages(config.sensor_page_enabled ? 'rotate' : 'status');
          if (config.status_layout) setStatusLayout(config.status_layout);
          if (config.date_color) setDateColor(config.date_color);
          if (config.time_color) setTimeColor(config.time_color);
          if (config.name_color) setNameColor(config.name_color);
          if (config.metric_color) setMetricColor(config.metric_color);
          if (config.has_mqtt_password !== undefined) setHasMqttPassword(config.has_mqtt_password);
          setMqttPassword('');
        }
      } else addLog(`Failed to save: ${response.error || 'Unknown error'}`);
    } catch (error) { addLog(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`); }
    finally { setIsSaving(false); }
  }, [isPeerConnected, sendCommand, deviceName, manualDisplayName, brightness, scrollSpeedMs, pageIntervalMs, displayPages, statusLayout, dateColor, timeColor, nameColor, metricColor, mqttBroker, mqttPort, mqttUsername, mqttPassword, mqttTopic, displaySensorMac, displayMetric, addLog]);

  const handleReboot = useCallback(async () => {
    if (!isPeerConnected) { addLog('Cannot reboot - display not connected'); return; }
    setIsRebooting(true);
    addLog('Sending reboot command...');
    try { await sendCommand('reboot'); addLog('Reboot command sent - device will restart'); }
    catch (error) { addLog(`Reboot failed: ${error instanceof Error ? error.message : 'Unknown error'}`); }
    finally { setIsRebooting(false); }
  }, [isPeerConnected, sendCommand, addLog]);

  // Fetch device config
  const fetchDeviceConfig = useCallback(async () => {
    if (!isPeerConnected) return;
    try {
      addLog('Fetching device config...');
      const response = await sendCommand('get_config');
      if (response.success && response.data) {
        const config = asDeviceConfig(response.data);
        setDeviceConfig(config);
        if (config.brightness !== undefined) setBrightness(config.brightness);
        if (config.scroll_speed_ms !== undefined) setScrollSpeedMs(config.scroll_speed_ms);
        if (config.page_interval_ms !== undefined) setPageIntervalMs(config.page_interval_ms);
        if (config.display_pages) setDisplayPages(config.display_pages);
        else if (config.sensor_page_enabled !== undefined) setDisplayPages(config.sensor_page_enabled ? 'rotate' : 'status');
        if (config.status_layout) setStatusLayout(config.status_layout);
        if (config.date_color) setDateColor(config.date_color);
        if (config.time_color) setTimeColor(config.time_color);
        if (config.name_color) setNameColor(config.name_color);
        if (config.metric_color) setMetricColor(config.metric_color);
        if (config.device_name) setDeviceName(config.device_name);
        if (config.display_name) setManualDisplayName(config.display_name);
        if (config.mqtt_broker) setMqttBroker(config.mqtt_broker);
        if (config.mqtt_port !== undefined) setMqttPort(config.mqtt_port);
        if (config.mqtt_username !== undefined) setMqttUsername(config.mqtt_username);
        if (config.has_mqtt_password !== undefined) setHasMqttPassword(config.has_mqtt_password);
        if (config.mqtt_topic) setMqttTopic(config.mqtt_topic);
        if (config.display_sensor_mac) setDisplaySensorMac(config.display_sensor_mac);
        if (config.display_metric) setDisplayMetric(config.display_metric);
        addLog('Device config loaded');
      }
    } catch (error) {
      addLog(`Failed to fetch config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [isPeerConnected, sendCommand, addLog]);

  // Fetch device status
  const fetchDeviceStatus = useCallback(async () => {
    if (!isPeerConnected) return;
    try {
      const response = await sendCommand('get_status');
      if (response.success && response.data) {
        setDeviceStatus(asDeviceStatus(response.data));
      }
    } catch {
      // Status fetch failed - will retry on next interval
    }
  }, [isPeerConnected, sendCommand]);

  // Auto-fetch config when device connects
  useEffect(() => {
    if (isPeerConnected) {
      fetchDeviceConfig();
      fetchDeviceStatus();
    }
  }, [isPeerConnected, fetchDeviceConfig, fetchDeviceStatus]);

  // Cleanup brightness timeout on unmount
  useEffect(() => {
    return () => {
      if (brightnessTimeoutRef.current) {
        clearTimeout(brightnessTimeoutRef.current);
      }
    };
  }, []);

  return { deviceConfig, deviceStatus, brightness, setBrightness, scrollSpeedMs, setScrollSpeedMs, pageIntervalMs, setPageIntervalMs, displayPages, setDisplayPages, statusLayout, setStatusLayout, deviceName, setDeviceName, manualDisplayName, setManualDisplayName, dateColor, setDateColor, timeColor, setTimeColor, nameColor, setNameColor, metricColor, setMetricColor, mqttBroker, setMqttBroker, mqttPort, setMqttPort, mqttUsername, setMqttUsername, mqttPassword, setMqttPassword, mqttTopic, setMqttTopic, hasMqttPassword, displaySensorMac, setDisplaySensorMac, displayMetric, setDisplayMetric, isSaving, isRebooting, handleSaveSettings, handleReboot, handleBrightnessChange, setDeviceStatus, fetchDeviceConfig, fetchDeviceStatus };
}
