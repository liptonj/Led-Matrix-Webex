/**
 * Unit tests for useSerialMonitor hook
 *
 * Tests serial port monitoring, command sending, pairing code extraction,
 * and ACK detection functionality.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'util';
import { useSerialMonitor, extractPairingCode } from '../useSerialMonitor';

// Mock Web Serial API types
interface MockSerialPort {
  readable: MockReadableStream | null;
  writable: MockWritableStream | null;
  open: jest.Mock;
  close: jest.Mock;
}

interface MockReadableStreamReader {
  read: jest.Mock;
  cancel: jest.Mock;
  releaseLock: jest.Mock;
}

interface MockWritableStreamWriter {
  write: jest.Mock;
  releaseLock: jest.Mock;
}

// Mock ReadableStream
class MockReadableStream {
  private reader: MockReadableStreamReader | null = null;

  getReader(): MockReadableStreamReader {
    if (!this.reader) {
      this.reader = {
        read: jest.fn(),
        cancel: jest.fn().mockResolvedValue(undefined),
        releaseLock: jest.fn(),
      };
    }
    return this.reader;
  }

  getMockReader(): MockReadableStreamReader | null {
    return this.reader;
  }
}

// Mock WritableStream
class MockWritableStream {
  private writer: MockWritableStreamWriter | null = null;

  getWriter(): MockWritableStreamWriter {
    if (!this.writer) {
      this.writer = {
        write: jest.fn().mockResolvedValue(undefined),
        releaseLock: jest.fn(),
      };
    }
    return this.writer;
  }

  getMockWriter(): MockWritableStreamWriter | null {
    return this.writer;
  }
}

// Mock Serial Port
class MockSerialPort implements MockSerialPort {
  readable: MockReadableStream | null = null;
  writable: MockWritableStream | null = null;
  open = jest.fn().mockResolvedValue(undefined);
  close = jest.fn().mockResolvedValue(undefined);

  // Test helpers
  simulateRead(data: Uint8Array, done = false): void {
    if (this.readable) {
      const reader = this.readable.getMockReader();
      if (reader) {
        reader.read.mockResolvedValueOnce({ value: data, done });
      }
    }
  }

  simulateReadDone(): void {
    if (this.readable) {
      const reader = this.readable.getMockReader();
      if (reader) {
        reader.read.mockResolvedValueOnce({ value: undefined, done: true });
      }
    }
  }

  getLastWrite(): Uint8Array | null {
    if (this.writable) {
      const writer = this.writable.getMockWriter();
      if (writer && writer.write.mock.calls.length > 0) {
        return writer.write.mock.calls[writer.write.mock.calls.length - 1][0] as Uint8Array;
      }
    }
    return null;
  }

  getAllWrites(): Uint8Array[] {
    if (this.writable) {
      const writer = this.writable.getMockWriter();
      if (writer) {
        return writer.write.mock.calls.map((call) => call[0] as Uint8Array);
      }
    }
    return [];
  }
}

// Mock navigator.serial
const mockSerial = {
  requestPort: jest.fn(),
};

// Store original navigator
const originalNavigator = global.navigator;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  
  // Mock navigator.serial
  (global.navigator as any) = {
    ...originalNavigator,
    serial: mockSerial,
  };

  // Mock TextEncoder/TextDecoder
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  global.navigator = originalNavigator;
});

describe('useSerialMonitor', () => {
  describe('extractPairingCode', () => {
    it('should extract pairing code from "PAIRING CODE: ABC123"', () => {
      const code = extractPairingCode('PAIRING CODE: ABC123');
      expect(code).toBe('ABC123');
    });

    it('should extract pairing code from "[SUPABASE] Pairing code: XYZ789"', () => {
      const code = extractPairingCode('[SUPABASE] Pairing code: XYZ789');
      expect(code).toBe('XYZ789');
    });

    it('should extract pairing code from "Pairing code: DEF456"', () => {
      const code = extractPairingCode('Pairing code: DEF456');
      expect(code).toBe('DEF456');
    });

    it('should return null when no pairing code found', () => {
      const code = extractPairingCode('Some random text without pairing code');
      expect(code).toBeNull();
    });

    it('should convert lowercase codes to uppercase', () => {
      const code = extractPairingCode('PAIRING CODE: abc123');
      expect(code).toBe('ABC123');
    });
  });

  describe('initial state', () => {
    it('should return initial state correctly', () => {
      const { result } = renderHook(() => useSerialMonitor());

      expect(result.current.serialOutput).toEqual([]);
      expect(result.current.autoApproveStatus).toBe('idle');
      expect(result.current.approveMessage).toBe('');
      expect(result.current.extractedPairingCode).toBeNull();
      expect(result.current.isMonitoring).toBe(false);
      expect(typeof result.current.startMonitoring).toBe('function');
      expect(typeof result.current.stopMonitoring).toBe('function');
      expect(typeof result.current.sendCommand).toBe('function');
    });
  });

  describe('sendCommand', () => {
    it('should return false when port is not open', async () => {
      const { result } = renderHook(() => useSerialMonitor());

      let sendResult: boolean;
      await act(async () => {
        sendResult = await result.current.sendCommand('test_command');
      });

      expect(sendResult!).toBe(false);
    });

    it('should return false when port.writable is null', async () => {
      const mockPort = new MockSerialPort();
      mockPort.writable = null;
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      reader!.read.mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialMonitor());

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(mockPort.open).toHaveBeenCalled();
      });

      let sendResult: boolean;
      await act(async () => {
        sendResult = await result.current.sendCommand('test_command');
      });

      expect(sendResult!).toBe(false);
    });

    it('should write command + newline to serial port', async () => {
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      reader!.read.mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialMonitor());

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(mockPort.open).toHaveBeenCalled();
      });

      let sendResult: boolean;
      await act(async () => {
        sendResult = await result.current.sendCommand('test_command');
      });

      expect(sendResult!).toBe(true);
      
      const writer = mockPort.writable.getMockWriter();
      expect(writer!.write).toHaveBeenCalledTimes(1);
      
      const writtenData = writer!.write.mock.calls[0][0] as Uint8Array;
      const writtenText = new TextDecoder().decode(writtenData);
      expect(writtenText).toBe('test_command\n');
    });

    it('should return true on successful write', async () => {
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      reader!.read.mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialMonitor());

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(mockPort.open).toHaveBeenCalled();
      });

      let sendResult: boolean;
      await act(async () => {
        sendResult = await result.current.sendCommand('get_status');
      });

      expect(sendResult!).toBe(true);
    });

    it('should handle write errors gracefully', async () => {
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      reader!.read.mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialMonitor());

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(mockPort.open).toHaveBeenCalled();
      });

      // Make writer.write throw an error
      const writer = mockPort.writable.getMockWriter();
      writer!.write.mockRejectedValueOnce(new Error('Write failed'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      let sendResult: boolean;
      await act(async () => {
        sendResult = await result.current.sendCommand('test_command');
      });

      expect(sendResult!).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Serial] Write error:'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('ACK detection', () => {
    it('should trigger callback with (true) for ACK:PROVISION_TOKEN:success', async () => {
      const onProvisionTokenAck = jest.fn();
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      // Simulate reading ACK line
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('ACK:PROVISION_TOKEN:success\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() =>
        useSerialMonitor({ onProvisionTokenAck })
      );

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(onProvisionTokenAck).toHaveBeenCalledWith(true, undefined);
      });
    });

    it('should trigger callback with (false, "invalid_length") for ACK:PROVISION_TOKEN:error:invalid_length', async () => {
      const onProvisionTokenAck = jest.fn();
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('ACK:PROVISION_TOKEN:error:invalid_length\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() =>
        useSerialMonitor({ onProvisionTokenAck })
      );

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(onProvisionTokenAck).toHaveBeenCalledWith(false, 'invalid_length');
      });
    });

    it('should trigger callback with (false, "invalid_format") for ACK:PROVISION_TOKEN:error:invalid_format', async () => {
      const onProvisionTokenAck = jest.fn();
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('ACK:PROVISION_TOKEN:error:invalid_format\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() =>
        useSerialMonitor({ onProvisionTokenAck })
      );

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(onProvisionTokenAck).toHaveBeenCalledWith(false, 'invalid_format');
      });
    });

    it('should not trigger callback for non-ACK lines', async () => {
      const onProvisionTokenAck = jest.fn();
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('Some regular log line\n'),
          done: false,
        })
        .mockResolvedValueOnce({
          value: encoder.encode('Another log line\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() =>
        useSerialMonitor({ onProvisionTokenAck })
      );

      await act(async () => {
        await result.current.startMonitoring();
      });

      // Wait a bit to ensure processing completes
      await act(async () => {
        jest.advanceTimersByTime(100);
      });

      // Callback should not have been called
      expect(onProvisionTokenAck).not.toHaveBeenCalled();
    });

    it('should handle ACK without error reason', async () => {
      const onProvisionTokenAck = jest.fn();
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('ACK:PROVISION_TOKEN:error\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() =>
        useSerialMonitor({ onProvisionTokenAck })
      );

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(onProvisionTokenAck).toHaveBeenCalledWith(false, undefined);
      });
    });
  });

  describe('integration with existing functionality', () => {
    it('should work alongside read monitoring', async () => {
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('Log line 1\n'),
          done: false,
        })
        .mockResolvedValueOnce({
          value: encoder.encode('Log line 2\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialMonitor());

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(result.current.serialOutput.length).toBeGreaterThan(0);
      });

      // Should be able to send command while monitoring
      let sendResult: boolean;
      await act(async () => {
        sendResult = await result.current.sendCommand('test');
      });

      expect(sendResult!).toBe(true);
      expect(result.current.serialOutput).toContain('Log line 1');
      expect(result.current.serialOutput).toContain('Log line 2');
    });

    it('should detect pairing code while sendCommand is available', async () => {
      const onPairingCodeFound = jest.fn();
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('PAIRING CODE: ABC123\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() =>
        useSerialMonitor({ onPairingCodeFound })
      );

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(onPairingCodeFound).toHaveBeenCalledWith('ABC123');
      });

      expect(result.current.extractedPairingCode).toBe('ABC123');
      
      // sendCommand should still be available
      expect(typeof result.current.sendCommand).toBe('function');
    });

    it('should handle multiple ACK messages', async () => {
      const onProvisionTokenAck = jest.fn();
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('ACK:PROVISION_TOKEN:success\n'),
          done: false,
        })
        .mockResolvedValueOnce({
          value: encoder.encode('ACK:PROVISION_TOKEN:error:invalid_length\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() =>
        useSerialMonitor({ onProvisionTokenAck })
      );

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(onProvisionTokenAck).toHaveBeenCalledTimes(2);
      });

      expect(onProvisionTokenAck).toHaveBeenNthCalledWith(1, true, undefined);
      expect(onProvisionTokenAck).toHaveBeenNthCalledWith(2, false, 'invalid_length');
    });

    it('should handle partial lines correctly', async () => {
      const onProvisionTokenAck = jest.fn();
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      const encoder = new TextEncoder();
      
      // Simulate partial line split across multiple reads
      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('ACK:PROVISION_TOKEN:'),
          done: false,
        })
        .mockResolvedValueOnce({
          value: encoder.encode('success\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() =>
        useSerialMonitor({ onProvisionTokenAck })
      );

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(onProvisionTokenAck).toHaveBeenCalledWith(true, undefined);
      });
    });
  });

  describe('error handling', () => {
    it('should handle Web Serial API not available', async () => {
      (global.navigator as any).serial = undefined;

      const { result } = renderHook(() => useSerialMonitor());

      await act(async () => {
        await result.current.startMonitoring();
      });

      expect(result.current.autoApproveStatus).toBe('error');
      expect(result.current.approveMessage).toContain('Web Serial API is not available');
    });

    it('should handle port request cancellation', async () => {
      const notFoundError = new DOMException('No port selected', 'NotFoundError');
      mockSerial.requestPort.mockRejectedValueOnce(notFoundError);

      const { result } = renderHook(() => useSerialMonitor());

      await act(async () => {
        await result.current.startMonitoring();
      });

      expect(result.current.autoApproveStatus).toBe('error');
      expect(result.current.approveMessage).toContain('No Serial port selected');
    });
  });

  describe('cleanup', () => {
    it('should cleanup on unmount', async () => {
      const mockPort = new MockSerialPort();
      mockPort.writable = new MockWritableStream();
      mockPort.readable = new MockReadableStream();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const reader = mockPort.readable.getMockReader();
      reader!.read.mockResolvedValueOnce({ value: undefined, done: true });

      const { result, unmount } = renderHook(() => useSerialMonitor());

      await act(async () => {
        await result.current.startMonitoring();
      });

      await waitFor(() => {
        expect(mockPort.open).toHaveBeenCalled();
      });

      unmount();

      await waitFor(() => {
        expect(mockPort.close).toHaveBeenCalled();
      });
    });
  });
});
