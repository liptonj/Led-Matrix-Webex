'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceConfig, DeviceStatus } from '../types';
import type { CommandResponse } from './useDeviceCommands';

export interface UseDeviceConfigOptions {
  isPeerConnected: boolean;
  sendCommand: (command: string, payload?: Record<string, unknown>) => Promise<CommandResponse>;
  addLog: (message: string) => void;
  deviceIp?: string | null;
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
  updateDeviceConfig: (updates: Partial<DeviceConfig>) => Promise<boolean>;
  isLoading: boolean;
  error: string | null;
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

export function useDeviceConfig({ isPeerConnected, sendCommand, addLog, deviceIp }: UseDeviceConfigOptions): UseDeviceConfigResult {
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>(defaultDeviceStatus);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          // Sync all config values back from device response
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
          // Sync MQTT settings from device response
          if (config.mqtt_broker !== undefined) setMqttBroker(config.mqtt_broker);
          if (config.mqtt_port !== undefined) setMqttPort(config.mqtt_port);
          if (config.mqtt_username !== undefined) setMqttUsername(config.mqtt_username);
          if (config.has_mqtt_password !== undefined) setHasMqttPassword(config.has_mqtt_password);
          if (config.mqtt_topic !== undefined) setMqttTopic(config.mqtt_topic || 'meraki/v1/mt/#');
          if (config.display_sensor_mac !== undefined) setDisplaySensorMac(config.display_sensor_mac);
          if (config.display_metric !== undefined) setDisplayMetric(config.display_metric || 'tvoc');
          setMqttPassword(''); // Clear password field after save
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

  // Helper function to sync config values to state
  const syncConfigToState = useCallback((config: DeviceConfig) => {
    // Display settings - use !== undefined to handle 0 and false values
    if (config.brightness !== undefined) setBrightness(config.brightness);
    if (config.scroll_speed_ms !== undefined) setScrollSpeedMs(config.scroll_speed_ms);
    if (config.page_interval_ms !== undefined) setPageIntervalMs(config.page_interval_ms);
    if (config.display_pages) setDisplayPages(config.display_pages);
    else if (config.sensor_page_enabled !== undefined) setDisplayPages(config.sensor_page_enabled ? 'rotate' : 'status');
    if (config.status_layout) setStatusLayout(config.status_layout);
    
    // Color settings - only update if present (empty string is not valid)
    if (config.date_color) setDateColor(config.date_color);
    if (config.time_color) setTimeColor(config.time_color);
    if (config.name_color) setNameColor(config.name_color);
    if (config.metric_color) setMetricColor(config.metric_color);
    
    // Device/display names - sync from device (can be empty)
    if (config.device_name !== undefined) setDeviceName(config.device_name);
    if (config.display_name !== undefined) setManualDisplayName(config.display_name || 'User');
    
    // MQTT settings - always sync from device (can be empty strings)
    if (config.mqtt_broker !== undefined) setMqttBroker(config.mqtt_broker);
    if (config.mqtt_port !== undefined) setMqttPort(config.mqtt_port);
    if (config.mqtt_username !== undefined) setMqttUsername(config.mqtt_username);
    if (config.has_mqtt_password !== undefined) setHasMqttPassword(config.has_mqtt_password);
    if (config.mqtt_topic !== undefined) setMqttTopic(config.mqtt_topic || 'meraki/v1/mt/#');
    
    // Sensor settings - sync from device (can be empty)
    if (config.display_sensor_mac !== undefined) setDisplaySensorMac(config.display_sensor_mac);
    if (config.display_metric !== undefined) setDisplayMetric(config.display_metric || 'tvoc');
  }, [setBrightness, setScrollSpeedMs, setPageIntervalMs, setDisplayPages, setStatusLayout, setDeviceName, setManualDisplayName, setDateColor, setTimeColor, setNameColor, setMetricColor, setMqttBroker, setMqttPort, setMqttUsername, setHasMqttPassword, setMqttTopic, setDisplaySensorMac, setDisplayMetric]);

  // Fetch device config via HTTP API or command
  const fetchDeviceConfig = useCallback(async () => {
    if (!isPeerConnected) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      addLog('Fetching device config...');
      
      // Try HTTP API first if deviceIp is available
      if (deviceIp) {
        try {
          const apiUrl = `http://${deviceIp}/api/config`;
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000), // 5 second timeout
          });
          
          if (response.ok) {
            const config = asDeviceConfig(await response.json());
            setDeviceConfig(config);
            setIsLoading(false);
            // Sync config values (same logic as below)
            syncConfigToState(config);
            addLog('Device config loaded via HTTP API');
            return;
          }
        } catch (httpError) {
          // Fall back to command-based approach if HTTP fails
          addLog(`HTTP API failed, using command: ${httpError instanceof Error ? httpError.message : 'Unknown error'}`);
        }
      }
      
      // Fallback to command-based approach
      const response = await sendCommand('get_config');
      if (response.success && response.data) {
        const config = asDeviceConfig(response.data);
        setDeviceConfig(config);
        syncConfigToState(config);
        addLog('Device config loaded');
      } else {
        throw new Error(response.error || 'Failed to fetch config');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(errorMessage);
      addLog(`Failed to fetch config: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [isPeerConnected, sendCommand, addLog, deviceIp, syncConfigToState]);

  // Update device config via HTTP API PATCH
  const updateDeviceConfig = useCallback(async (updates: Partial<DeviceConfig>): Promise<boolean> => {
    if (!isPeerConnected) {
      addLog('Cannot update - display not connected');
      return false;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Try HTTP API first if deviceIp is available
      if (deviceIp) {
        try {
          const apiUrl = `http://${deviceIp}/api/config`;
          const response = await fetch(apiUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
            signal: AbortSignal.timeout(10000), // 10 second timeout
          });
          
          if (response.ok) {
            const updatedConfig = asDeviceConfig(await response.json());
            setDeviceConfig(updatedConfig);
            syncConfigToState(updatedConfig);
            setIsLoading(false);
            addLog('Device config updated via HTTP API');
            return true;
          } else {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `HTTP ${response.status}`);
          }
        } catch (httpError) {
          // Fall back to command-based approach if HTTP fails
          addLog(`HTTP API update failed, using command: ${httpError instanceof Error ? httpError.message : 'Unknown error'}`);
        }
      }
      
      // Fallback to command-based approach
      const response = await sendCommand('set_config', updates);
      if (response.success && response.data) {
        const config = asDeviceConfig(response.data);
        setDeviceConfig(config);
        syncConfigToState(config);
        setIsLoading(false);
        addLog('Device config updated');
        return true;
      } else {
        throw new Error(response.error || 'Failed to update config');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(errorMessage);
      addLog(`Failed to update config: ${errorMessage}`);
      setIsLoading(false);
      return false;
    }
  }, [isPeerConnected, sendCommand, addLog, deviceIp, syncConfigToState]);

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

  // Auto-fetch config when device connects or deviceIp changes
  useEffect(() => {
    if (isPeerConnected) {
      fetchDeviceConfig();
      fetchDeviceStatus();
    }
  }, [isPeerConnected, deviceIp, fetchDeviceConfig, fetchDeviceStatus]);

  // Cleanup brightness timeout on unmount
  useEffect(() => {
    return () => {
      if (brightnessTimeoutRef.current) {
        clearTimeout(brightnessTimeoutRef.current);
      }
    };
  }, []);

  return { deviceConfig, deviceStatus, brightness, setBrightness, scrollSpeedMs, setScrollSpeedMs, pageIntervalMs, setPageIntervalMs, displayPages, setDisplayPages, statusLayout, setStatusLayout, deviceName, setDeviceName, manualDisplayName, setManualDisplayName, dateColor, setDateColor, timeColor, setTimeColor, nameColor, setNameColor, metricColor, setMetricColor, mqttBroker, setMqttBroker, mqttPort, setMqttPort, mqttUsername, setMqttUsername, mqttPassword, setMqttPassword, mqttTopic, setMqttTopic, hasMqttPassword, displaySensorMac, setDisplaySensorMac, displayMetric, setDisplayMetric, isSaving, isRebooting, handleSaveSettings, handleReboot, handleBrightnessChange, setDeviceStatus, fetchDeviceConfig, fetchDeviceStatus, updateDeviceConfig, isLoading, error };
}
