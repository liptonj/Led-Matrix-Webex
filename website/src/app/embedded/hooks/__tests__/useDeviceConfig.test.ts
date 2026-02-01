/**
 * Unit tests for useDeviceConfig hook
 * 
 * Tests config fetching, status fetching, and save settings functionality.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

import { useDeviceConfig, type UseDeviceConfigOptions } from '../useDeviceConfig';
import type { CommandResponse } from '../useDeviceCommands';

describe('useDeviceConfig hook', () => {
  const mockAddLog = jest.fn();
  const mockSendCommand = jest.fn<Promise<CommandResponse>, [string, Record<string, unknown>?]>();

  const defaultOptions: UseDeviceConfigOptions = {
    isPeerConnected: true,
    sendCommand: mockSendCommand,
    addLog: mockAddLog,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have default form state values', () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      expect(result.current.brightness).toBe(128);
      expect(result.current.scrollSpeedMs).toBe(250);
      expect(result.current.pageIntervalMs).toBe(5000);
      expect(result.current.displayPages).toBe('rotate');
      expect(result.current.statusLayout).toBe('sensors');
      expect(result.current.manualDisplayName).toBe('User');
      expect(result.current.dateColor).toBe('#00ffff');
      expect(result.current.timeColor).toBe('#ffffff');
      expect(result.current.nameColor).toBe('#ffa500');
      expect(result.current.metricColor).toBe('#00bfff');
      expect(result.current.mqttPort).toBe(1883);
      expect(result.current.mqttTopic).toBe('meraki/v1/mt/#');
      expect(result.current.displayMetric).toBe('tvoc');
    });

    it('should have empty device config and status initially', () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      expect(result.current.deviceConfig).toBeNull();
      expect(result.current.deviceStatus).toEqual(expect.any(Object));
    });

    it('should not be saving or rebooting initially', () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      expect(result.current.isSaving).toBe(false);
      expect(result.current.isRebooting).toBe(false);
    });
  });

  describe('fetchDeviceConfig', () => {
    it('should fetch config when peer is connected', async () => {
      mockSendCommand.mockResolvedValueOnce({
        success: true,
        data: {
          brightness: 200,
          scroll_speed_ms: 100,
          page_interval_ms: 10000,
          display_pages: 'status',
          status_layout: 'name',
          device_name: 'my-display',
          display_name: 'John Doe',
          date_color: '#ff0000',
          time_color: '#00ff00',
          name_color: '#0000ff',
          metric_color: '#ffff00',
          mqtt_broker: 'mqtt.example.com',
          mqtt_port: 8883,
          mqtt_username: 'user',
          has_mqtt_password: true,
          mqtt_topic: 'custom/topic/#',
          display_sensor_mac: 'AA:BB:CC:DD:EE:FF',
          display_metric: 'co2',
        },
      });

      // Also mock the status fetch that happens in the same effect
      mockSendCommand.mockResolvedValueOnce({
        success: true,
        data: { wifi_connected: true },
      });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      // Config should be fetched automatically when connected
      await waitFor(() => {
        expect(mockSendCommand).toHaveBeenCalledWith('get_config');
      });

      await waitFor(() => {
        expect(result.current.brightness).toBe(200);
        expect(result.current.scrollSpeedMs).toBe(100);
        expect(result.current.pageIntervalMs).toBe(10000);
        expect(result.current.displayPages).toBe('status');
        expect(result.current.statusLayout).toBe('name');
        expect(result.current.deviceName).toBe('my-display');
        expect(result.current.manualDisplayName).toBe('John Doe');
        expect(result.current.dateColor).toBe('#ff0000');
        expect(result.current.timeColor).toBe('#00ff00');
        expect(result.current.nameColor).toBe('#0000ff');
        expect(result.current.metricColor).toBe('#ffff00');
        expect(result.current.mqttBroker).toBe('mqtt.example.com');
        expect(result.current.mqttPort).toBe(8883);
        expect(result.current.mqttUsername).toBe('user');
        expect(result.current.hasMqttPassword).toBe(true);
        expect(result.current.mqttTopic).toBe('custom/topic/#');
        expect(result.current.displaySensorMac).toBe('AA:BB:CC:DD:EE:FF');
        expect(result.current.displayMetric).toBe('co2');
      });

      expect(mockAddLog).toHaveBeenCalledWith('Device config loaded');
    });

    it('should not fetch config when peer is not connected', async () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      await act(async () => {
        await result.current.fetchDeviceConfig();
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it('should handle sensor_page_enabled legacy field', async () => {
      mockSendCommand.mockResolvedValueOnce({
        success: true,
        data: {
          sensor_page_enabled: true,
        },
      });
      mockSendCommand.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => {
        expect(result.current.displayPages).toBe('rotate');
      });
    });

    it('should handle config fetch failure', async () => {
      mockSendCommand.mockRejectedValueOnce(new Error('Network error'));
      mockSendCommand.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => {
        expect(mockAddLog).toHaveBeenCalledWith('Failed to fetch config: Network error');
      });
    });
  });

  describe('fetchDeviceStatus', () => {
    it('should fetch status when peer is connected', async () => {
      mockSendCommand.mockResolvedValueOnce({
        success: true,
        data: {},
      }); // get_config
      mockSendCommand.mockResolvedValueOnce({
        success: true,
        data: {
          wifi_connected: true,
          ip_address: '192.168.1.100',
          firmware_version: '1.0.0',
          serial_number: 'ABC123',
          free_heap: 150000,
          uptime: 3600,
          rssi: -50,
        },
      }); // get_status

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => {
        expect(mockSendCommand).toHaveBeenCalledWith('get_status');
      });

      await waitFor(() => {
        expect(result.current.deviceStatus.wifi_connected).toBe(true);
        expect(result.current.deviceStatus.ip_address).toBe('192.168.1.100');
        expect(result.current.deviceStatus.firmware_version).toBe('1.0.0');
      });
    });

    it('should not fetch status when peer is not connected', async () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      await act(async () => {
        await result.current.fetchDeviceStatus();
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });

  describe('handleBrightnessChange', () => {
    it('should update brightness immediately', () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      act(() => {
        result.current.handleBrightnessChange(200);
      });

      expect(result.current.brightness).toBe(200);
    });

    it('should debounce brightness command when connected', async () => {
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      // Clear initial fetch calls
      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();

      // Change brightness multiple times rapidly
      act(() => {
        result.current.handleBrightnessChange(100);
      });
      act(() => {
        result.current.handleBrightnessChange(150);
      });
      act(() => {
        result.current.handleBrightnessChange(200);
      });

      // Command should not be sent yet (debouncing)
      expect(mockSendCommand).not.toHaveBeenCalledWith('set_brightness', expect.any(Object));

      // Advance timer past debounce (150ms)
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      // Only the last value should be sent
      expect(mockSendCommand).toHaveBeenCalledWith('set_brightness', { value: 200 });
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
    });

    it('should not send command when not connected', async () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      act(() => {
        result.current.handleBrightnessChange(200);
      });

      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
    });
  });

  describe('handleSaveSettings', () => {
    it('should save settings with correct payload', async () => {
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      // Wait for initial fetch
      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();

      // Set some values
      act(() => {
        result.current.setDeviceName('test-device');
        result.current.setManualDisplayName('Test User');
        result.current.setBrightness(150);
        result.current.setScrollSpeedMs(300);
        result.current.setPageIntervalMs(8000);
        result.current.setDisplayPages('sensors');
        result.current.setStatusLayout('name');
        result.current.setDateColor('#aabbcc');
        result.current.setTimeColor('#ddeeff');
        result.current.setNameColor('#112233');
        result.current.setMetricColor('#445566');
      });

      await act(async () => {
        await result.current.handleSaveSettings();
      });

      expect(mockSendCommand).toHaveBeenCalledWith('set_config', expect.objectContaining({
        device_name: 'test-device',
        display_name: 'Test User',
        brightness: 150,
        scroll_speed_ms: 300,
        page_interval_ms: 8000,
        display_pages: 'sensors',
        status_layout: 'name',
        date_color: '#aabbcc',
        time_color: '#ddeeff',
        name_color: '#112233',
        metric_color: '#445566',
      }));
      expect(mockAddLog).toHaveBeenCalledWith('Settings saved successfully');
    });

    it('should include MQTT settings when broker is set', async () => {
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();

      act(() => {
        result.current.setMqttBroker('mqtt.example.com');
        result.current.setMqttPort(8883);
        result.current.setMqttUsername('user');
        result.current.setMqttPassword('secret');
        result.current.setMqttTopic('custom/topic/#');
      });

      await act(async () => {
        await result.current.handleSaveSettings();
      });

      expect(mockSendCommand).toHaveBeenCalledWith('set_config', expect.objectContaining({
        mqtt_broker: 'mqtt.example.com',
        mqtt_port: 8883,
        mqtt_username: 'user',
        mqtt_password: 'secret',
        mqtt_topic: 'custom/topic/#',
      }));
    });

    it('should not include password if empty', async () => {
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();

      act(() => {
        result.current.setMqttBroker('mqtt.example.com');
        result.current.setMqttPassword(''); // Empty password
      });

      await act(async () => {
        await result.current.handleSaveSettings();
      });

      const call = mockSendCommand.mock.calls.find(c => c[0] === 'set_config');
      expect(call).toBeDefined();
      expect(call![1]).not.toHaveProperty('mqtt_password');
    });

    it('should not save when not connected', async () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      await act(async () => {
        await result.current.handleSaveSettings();
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(mockAddLog).toHaveBeenCalledWith('Cannot save - display not connected');
    });

    it('should handle save failure', async () => {
      mockSendCommand.mockResolvedValue({ success: true, data: {} }); // Initial fetches
      
      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();
      mockSendCommand.mockResolvedValueOnce({ success: false, error: 'Invalid config' });

      await act(async () => {
        await result.current.handleSaveSettings();
      });

      expect(mockAddLog).toHaveBeenCalledWith('Failed to save: Invalid config');
    });

    it('should set isSaving during save operation', async () => {
      let resolvePromise: (value: CommandResponse) => void = () => {};
      const pendingPromise = new Promise<CommandResponse>((resolve) => {
        resolvePromise = resolve;
      });
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();
      mockSendCommand.mockReturnValueOnce(pendingPromise);

      // Start save
      let savePromise: Promise<void>;
      act(() => {
        savePromise = result.current.handleSaveSettings();
      });

      await waitFor(() => {
        expect(result.current.isSaving).toBe(true);
      });

      // Complete save
      await act(async () => {
        resolvePromise({ success: true, data: {} });
        await savePromise;
      });

      expect(result.current.isSaving).toBe(false);
    });

    it('should update form state from response data', async () => {
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();
      mockSendCommand.mockResolvedValueOnce({
        success: true,
        data: {
          brightness: 100,
          has_mqtt_password: true,
        },
      });

      await act(async () => {
        await result.current.handleSaveSettings();
      });

      expect(result.current.brightness).toBe(100);
      expect(result.current.hasMqttPassword).toBe(true);
      // Password should be cleared after save
      expect(result.current.mqttPassword).toBe('');
    });
  });

  describe('handleReboot', () => {
    it('should send reboot command', async () => {
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();

      await act(async () => {
        await result.current.handleReboot();
      });

      expect(mockSendCommand).toHaveBeenCalledWith('reboot');
      expect(mockAddLog).toHaveBeenCalledWith('Reboot command sent - device will restart');
    });

    it('should not reboot when not connected', async () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      await act(async () => {
        await result.current.handleReboot();
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(mockAddLog).toHaveBeenCalledWith('Cannot reboot - display not connected');
    });

    it('should handle reboot failure', async () => {
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();
      mockSendCommand.mockRejectedValueOnce(new Error('Connection lost'));

      await act(async () => {
        await result.current.handleReboot();
      });

      expect(mockAddLog).toHaveBeenCalledWith('Reboot failed: Connection lost');
    });

    it('should set isRebooting during reboot operation', async () => {
      let resolvePromise: (value: CommandResponse) => void = () => {};
      const pendingPromise = new Promise<CommandResponse>((resolve) => {
        resolvePromise = resolve;
      });
      mockSendCommand.mockResolvedValue({ success: true, data: {} });

      const { result } = renderHook(() => useDeviceConfig(defaultOptions));

      await waitFor(() => expect(mockSendCommand).toHaveBeenCalled());
      mockSendCommand.mockClear();
      mockSendCommand.mockReturnValueOnce(pendingPromise);

      // Start reboot
      let rebootPromise: Promise<void>;
      act(() => {
        rebootPromise = result.current.handleReboot();
      });

      await waitFor(() => {
        expect(result.current.isRebooting).toBe(true);
      });

      // Complete reboot
      await act(async () => {
        resolvePromise({ success: true, data: {} });
        await rebootPromise;
      });

      expect(result.current.isRebooting).toBe(false);
    });
  });

  describe('form state setters', () => {
    it('should update all form fields correctly', () => {
      const options = { ...defaultOptions, isPeerConnected: false };
      const { result } = renderHook(() => useDeviceConfig(options));

      act(() => {
        result.current.setBrightness(50);
        result.current.setScrollSpeedMs(500);
        result.current.setPageIntervalMs(15000);
        result.current.setDisplayPages('sensors');
        result.current.setStatusLayout('name');
        result.current.setDeviceName('custom-device');
        result.current.setManualDisplayName('Custom Name');
        result.current.setDateColor('#111111');
        result.current.setTimeColor('#222222');
        result.current.setNameColor('#333333');
        result.current.setMetricColor('#444444');
        result.current.setMqttBroker('broker.test.com');
        result.current.setMqttPort(1884);
        result.current.setMqttUsername('testuser');
        result.current.setMqttPassword('testpass');
        result.current.setMqttTopic('test/topic/#');
        result.current.setDisplaySensorMac('11:22:33:44:55:66');
        result.current.setDisplayMetric('pm2_5');
      });

      expect(result.current.brightness).toBe(50);
      expect(result.current.scrollSpeedMs).toBe(500);
      expect(result.current.pageIntervalMs).toBe(15000);
      expect(result.current.displayPages).toBe('sensors');
      expect(result.current.statusLayout).toBe('name');
      expect(result.current.deviceName).toBe('custom-device');
      expect(result.current.manualDisplayName).toBe('Custom Name');
      expect(result.current.dateColor).toBe('#111111');
      expect(result.current.timeColor).toBe('#222222');
      expect(result.current.nameColor).toBe('#333333');
      expect(result.current.metricColor).toBe('#444444');
      expect(result.current.mqttBroker).toBe('broker.test.com');
      expect(result.current.mqttPort).toBe(1884);
      expect(result.current.mqttUsername).toBe('testuser');
      expect(result.current.mqttPassword).toBe('testpass');
      expect(result.current.mqttTopic).toBe('test/topic/#');
      expect(result.current.displaySensorMac).toBe('11:22:33:44:55:66');
      expect(result.current.displayMetric).toBe('pm2_5');
    });
  });
});
