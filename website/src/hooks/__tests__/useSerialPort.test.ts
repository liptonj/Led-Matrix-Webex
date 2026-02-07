/**
 * Unit tests for useSerialPort hook
 *
 * Tests serial port connection, reading, writing, signal control,
 * and error handling functionality.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'util';
import { useSerialPort } from '../useSerialPort';

// Mock Web Serial API types
interface MockReadableStreamReader {
  read: jest.Mock;
  cancel: jest.Mock;
  releaseLock: jest.Mock;
}

interface MockWritableStreamWriter {
  write: jest.Mock;
  releaseLock: jest.Mock;
}

interface MockReadableStream {
  getReader: jest.Mock;
}

interface MockWritableStream {
  getWriter: jest.Mock;
}

interface MockSerialPort {
  readable: MockReadableStream | null;
  writable: MockWritableStream | null;
  open: jest.Mock;
  close: jest.Mock;
  setSignals: jest.Mock;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
}

// Create mock port with test helpers
function createMockPort(): MockSerialPort {
  const reader: MockReadableStreamReader = {
    read: jest.fn().mockResolvedValue({ value: null, done: true }),
    cancel: jest.fn().mockResolvedValue(undefined),
    releaseLock: jest.fn(),
  };

  const writer: MockWritableStreamWriter = {
    write: jest.fn().mockResolvedValue(undefined),
    releaseLock: jest.fn(),
  };

  const readable: MockReadableStream = {
    getReader: jest.fn().mockReturnValue(reader),
  };

  const writable: MockWritableStream = {
    getWriter: jest.fn().mockReturnValue(writer),
  };

  const port: MockSerialPort = {
    readable,
    writable,
    open: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    setSignals: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };

  return port;
}

// Mock navigator.serial
const mockSerial = {
  requestPort: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  
  // Mock navigator.serial using Object.defineProperty
  Object.defineProperty(navigator, 'serial', {
    value: mockSerial,
    writable: true,
    configurable: true,
  });

  // Mock TextEncoder/TextDecoder
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
});

afterEach(() => {
  jest.clearAllMocks();
  // Clean up navigator.serial
  Object.defineProperty(navigator, 'serial', {
    value: undefined,
    writable: true,
    configurable: true,
  });
});

describe('useSerialPort', () => {
  describe('initial state', () => {
    it('initializes with disconnected status', () => {
      const { result } = renderHook(() => useSerialPort());
      
      expect(result.current.status).toBe('disconnected');
      expect(result.current.lines).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.port).toBeNull();
    });

    it('provides all required functions', () => {
      const { result } = renderHook(() => useSerialPort());
      
      expect(typeof result.current.connect).toBe('function');
      expect(typeof result.current.disconnect).toBe('function');
      expect(typeof result.current.write).toBe('function');
      expect(typeof result.current.writeRaw).toBe('function');
      expect(typeof result.current.pauseReader).toBe('function');
      expect(typeof result.current.resumeReader).toBe('function');
      expect(typeof result.current.setSignals).toBe('function');
      expect(typeof result.current.clearLines).toBe('function');
    });
  });

  describe('connect', () => {
    it('connects to serial port successfully', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      expect(navigator.serial.requestPort).toHaveBeenCalled();
      expect(mockPort.open).toHaveBeenCalledWith({ baudRate: 115200 });
      expect(result.current.status).toBe('connected');
      expect(result.current.error).toBeNull();
    });

    it('uses custom baud rate', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result } = renderHook(() => useSerialPort({ baudRate: 9600 }));

      await act(async () => {
        await result.current.connect();
      });

      expect(mockPort.open).toHaveBeenCalledWith({ baudRate: 9600 });
    });

    it('handles port not found error', async () => {
      const notFoundError = new DOMException('No port selected', 'NotFoundError');
      mockSerial.requestPort.mockRejectedValueOnce(notFoundError);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.status).toBe('disconnected');
      expect(result.current.error).toBe('No serial port selected.');
    });

    it('handles security error', async () => {
      const securityError = new DOMException('Permission denied', 'SecurityError');
      mockSerial.requestPort.mockRejectedValueOnce(securityError);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('Serial port access denied.');
    });

    it('handles generic connection errors', async () => {
      const genericError = new Error('Connection failed');
      mockSerial.requestPort.mockRejectedValueOnce(genericError);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('Connection failed');
    });

    it('reports error when serial API not available', async () => {
      // Remove serial API entirely so 'serial' in navigator is false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (navigator as any).serial;

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toContain('Web Serial API');
    });

    it('calls onDisconnect callback when port disconnects', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);
      const onDisconnect = jest.fn();

      const { result } = renderHook(() => useSerialPort({ onDisconnect }));

      await act(async () => {
        await result.current.connect();
      });

      // Simulate disconnect event
      const disconnectHandler = mockPort.addEventListener.mock.calls.find(
        (call) => call[0] === 'disconnect'
      )?.[1];

      act(() => {
        disconnectHandler?.();
      });

      expect(onDisconnect).toHaveBeenCalled();
      expect(result.current.status).toBe('disconnected');
    });

    it('starts reading after connection', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      await waitFor(() => {
        expect(mockPort.readable?.getReader).toHaveBeenCalled();
      });
    });
  });

  describe('write', () => {
    it('writes data to port with newline', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      await waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      let writeResult: boolean;
      await act(async () => {
        writeResult = await result.current.write('test command');
      });

      expect(writeResult!).toBe(true);
      
      const writer = mockPort.writable?.getWriter();
      expect(writer?.write).toHaveBeenCalled();
      
      const writtenData = writer?.write.mock.calls[0]?.[0] as Uint8Array;
      const writtenText = new TextDecoder().decode(writtenData);
      expect(writtenText).toBe('test command\n');
    });

    it('returns false when port is not writable', async () => {
      const mockPort = createMockPort();
      mockPort.writable = null;
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      let writeResult: boolean;
      await act(async () => {
        writeResult = await result.current.write('test');
      });

      expect(writeResult!).toBe(false);
    });

    it('handles write errors gracefully', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);
      const writer = mockPort.writable?.getWriter();
      writer!.write.mockRejectedValueOnce(new Error('Write failed'));

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      let writeResult: boolean;
      await act(async () => {
        writeResult = await result.current.write('test');
      });

      expect(writeResult!).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('writeRaw', () => {
    it('writes raw data without newline', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      let writeResult: boolean;
      await act(async () => {
        writeResult = await result.current.writeRaw('raw data');
      });

      expect(writeResult!).toBe(true);
      
      const writer = mockPort.writable?.getWriter();
      const writtenData = writer?.write.mock.calls[0]?.[0] as Uint8Array;
      const writtenText = new TextDecoder().decode(writtenData);
      expect(writtenText).toBe('raw data');
    });
  });

  describe('setSignals', () => {
    it('sets signals on port', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      await act(async () => {
        await result.current.setSignals({ dataTerminalReady: true, requestToSend: false });
      });

      expect(mockPort.setSignals).toHaveBeenCalledWith({
        dataTerminalReady: true,
        requestToSend: false,
      });
    });

    it('throws error when port is not connected', async () => {
      const { result } = renderHook(() => useSerialPort());

      await expect(
        act(async () => {
          await result.current.setSignals({ dataTerminalReady: true });
        })
      ).rejects.toThrow('Serial port is not connected');
    });
  });

  describe('reading', () => {
    it('processes received lines', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);
      const encoder = new TextEncoder();
      const reader = mockPort.readable?.getReader();

      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('Line 1\nLine 2\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      await waitFor(() => {
        expect(result.current.lines.length).toBeGreaterThan(0);
      });

      expect(result.current.lines).toContain('Line 1');
      expect(result.current.lines).toContain('Line 2');
    });

    it('calls onLine callback for each line', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);
      const onLine = jest.fn();
      const encoder = new TextEncoder();
      const reader = mockPort.readable?.getReader();

      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('Test line\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialPort({ onLine }));

      await act(async () => {
        await result.current.connect();
      });

      await waitFor(() => {
        expect(onLine).toHaveBeenCalledWith('Test line');
      });
    });

    it('handles partial lines across multiple reads', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);
      const encoder = new TextEncoder();
      const reader = mockPort.readable?.getReader();

      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('Partial'),
          done: false,
        })
        .mockResolvedValueOnce({
          value: encoder.encode(' line\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      await waitFor(() => {
        expect(result.current.lines).toContain('Partial line');
      });
    });
  });

  describe('pauseReader and resumeReader', () => {
    it('pauses and resumes reading', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      // Configure the reader to hang (via the mock's return value)
      // Access the reader via the mock's internal return value, not by calling getReader
      const readerMock = mockPort.readable!.getReader.mock.results[0]?.value
        ?? mockPort.readable!.getReader();
      readerMock.read.mockReturnValue(new Promise(() => {}));

      // Reset the call count after setup
      mockPort.readable!.getReader.mockClear();

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      // getReader should be called once during startReadLoop
      expect(mockPort.readable!.getReader).toHaveBeenCalledTimes(1);

      // Pause should cancel the active reader
      await act(async () => {
        await result.current.pauseReader();
      });

      expect(readerMock.cancel).toHaveBeenCalled();

      // Set up a new reader for resume
      const newReader = {
        read: jest.fn().mockReturnValue(new Promise(() => {})),
        cancel: jest.fn().mockResolvedValue(undefined),
        releaseLock: jest.fn(),
      };
      mockPort.readable!.getReader.mockReturnValue(newReader);

      act(() => {
        result.current.resumeReader();
      });

      await waitFor(() => {
        expect(mockPort.readable?.getReader).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('clearLines', () => {
    it('clears all captured lines', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);
      const encoder = new TextEncoder();
      const reader = mockPort.readable?.getReader();

      reader!.read
        .mockResolvedValueOnce({
          value: encoder.encode('Line 1\nLine 2\n'),
          done: false,
        })
        .mockResolvedValueOnce({ value: undefined, done: true });

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      await waitFor(() => {
        expect(result.current.lines.length).toBeGreaterThan(0);
      });

      act(() => {
        result.current.clearLines();
      });

      expect(result.current.lines).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('disconnects cleanly', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.status).toBe('disconnected');
      expect(mockPort.close).toHaveBeenCalled();
    });

    it('cancels reader on disconnect', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);
      const reader = mockPort.readable?.getReader();

      // Make the read loop hang so reader stays active
      reader!.read.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      act(() => {
        result.current.disconnect();
      });

      expect(reader!.cancel).toHaveBeenCalled();
    });
  });

  describe('cleanup on unmount', () => {
    it('disconnects on unmount', async () => {
      const mockPort = createMockPort();
      mockSerial.requestPort.mockResolvedValueOnce(mockPort);

      const { result, unmount } = renderHook(() => useSerialPort());

      await act(async () => {
        await result.current.connect();
      });

      unmount();

      await waitFor(() => {
        expect(mockPort.close).toHaveBeenCalled();
      });
    });
  });
});
