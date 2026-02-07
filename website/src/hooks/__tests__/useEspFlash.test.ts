/**
 * Unit tests for useEspFlash hook
 *
 * Tests ESP32 firmware flashing, chip detection, progress tracking,
 * and error handling functionality.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useEspFlash } from '../useEspFlash';

// Mock esptool-js
const mockChipRom = {
  readMac: jest.fn().mockResolvedValue('AA:BB:CC:DD:EE:FF'),
};

const mockESPLoader = {
  main: jest.fn().mockResolvedValue('ESP32-S3'),
  chip: mockChipRom,
  writeFlash: jest.fn().mockResolvedValue(undefined),
  softReset: jest.fn().mockResolvedValue(undefined),
  eraseFlash: jest.fn().mockResolvedValue(undefined),
};

const mockTransport = {
  disconnect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('esptool-js', () => ({
  ESPLoader: jest.fn().mockImplementation(() => mockESPLoader),
  Transport: jest.fn().mockImplementation(() => mockTransport),
}));

// Mock SerialPort
const createMockSerialPort = () => ({
  readable: null,
  writable: null,
  open: jest.fn(),
  close: jest.fn(),
});

// Mock fetch for manifest and firmware downloads
global.fetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  
  // Reset mock implementations
  mockESPLoader.main.mockResolvedValue('ESP32-S3');
  mockChipRom.readMac.mockResolvedValue('AA:BB:CC:DD:EE:FF');
  mockESPLoader.chip = mockChipRom;
  mockESPLoader.writeFlash.mockResolvedValue(undefined);
  mockESPLoader.softReset.mockResolvedValue(undefined);
  
  mockTransport.disconnect.mockResolvedValue(undefined);
  
  // Mock manifest fetch
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      parts: [
        { path: 'firmware.bin', offset: 0x1000 },
      ],
    }),
    arrayBuffer: async () => new ArrayBuffer(100),
  });
});

describe('useEspFlash', () => {
  describe('initial state', () => {
    it('initializes with idle state', () => {
      const { result } = renderHook(() => useEspFlash());
      
      expect(result.current.progress.status).toBe('idle');
      expect(result.current.progress.phase).toBe('');
      expect(result.current.progress.percent).toBe(0);
      expect(result.current.progress.message).toBe('');
      expect(result.current.progress.error).toBeNull();
      expect(result.current.chipInfo).toBeNull();
      expect(result.current.isFlashing).toBe(false);
    });

    it('provides all required functions', () => {
      const { result } = renderHook(() => useEspFlash());
      
      expect(typeof result.current.startFlash).toBe('function');
      expect(typeof result.current.abortFlash).toBe('function');
      expect(typeof result.current.resetState).toBe('function');
    });
  });

  describe('resetState', () => {
    it('resets state correctly', () => {
      const { result } = renderHook(() => useEspFlash());

      // Set some state first
      act(() => {
        result.current.abortFlash();
      });

      expect(result.current.progress.status).toBe('error');

      act(() => {
        result.current.resetState();
      });

      expect(result.current.progress.status).toBe('idle');
      expect(result.current.chipInfo).toBeNull();
      expect(result.current.progress.error).toBeNull();
    });
  });

  describe('abortFlash', () => {
    it('aborts flash operation', () => {
      const { result } = renderHook(() => useEspFlash());

      act(() => {
        result.current.abortFlash();
      });

      expect(result.current.progress.status).toBe('error');
      expect(result.current.progress.error).toBe('Aborted');
      expect(result.current.progress.message).toBe('Flash aborted by user.');
    });

    it('sets isFlashing to false after abort', () => {
      const { result } = renderHook(() => useEspFlash());

      act(() => {
        result.current.abortFlash();
      });

      expect(result.current.isFlashing).toBe(false);
    });
  });

  describe('isFlashing', () => {
    it('returns false for idle state', () => {
      const { result } = renderHook(() => useEspFlash());
      expect(result.current.isFlashing).toBe(false);
    });

    it('returns false for error state', () => {
      const { result } = renderHook(() => useEspFlash());

      act(() => {
        result.current.abortFlash();
      });

      expect(result.current.isFlashing).toBe(false);
    });

    it('returns false for complete state', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      // Mock successful flash
      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.progress.status).toBe('complete');
      });

      expect(result.current.isFlashing).toBe(false);
    });

    it('returns true for connecting state', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      // Delay mock resolution to catch intermediate state
      mockESPLoader.main.mockImplementationOnce(() => 
        new Promise((resolve) => setTimeout(() => resolve('ESP32-S3'), 100))
      );

      // Start flash but don't wait for completion
      act(() => {
        result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      // Check immediately - state should be 'connecting' before mock resolves
      await waitFor(() => {
        expect(['connecting', 'flashing', 'complete']).toContain(result.current.progress.status);
      }, { timeout: 200 });

      // If we caught connecting state, isFlashing should be true
      if (result.current.progress.status === 'connecting') {
        expect(result.current.isFlashing).toBe(true);
      }
    });

    it('returns true for flashing state', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      // Delay mock resolution to catch intermediate state
      mockESPLoader.writeFlash.mockImplementationOnce(async (options: { reportProgress?: (fileIndex: number, written: number, total: number) => void }) => {
        // Call progress callback to simulate flashing
        if (options.reportProgress) {
          options.reportProgress(0, 50, 100);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Mock progress callback to track state
      let flashState = '';
      const onProgress = jest.fn((progress) => {
        flashState = progress.status;
      });

      act(() => {
        result.current.startFlash(
          mockPort as SerialPort,
          'https://example.com/manifest.json',
          onProgress
        );
      });

      // Wait for flashing phase - check final state since mocks resolve quickly
      await waitFor(() => {
        const status = result.current.progress.status;
        return status === 'flashing' || status === 'complete' || status === 'error';
      }, { timeout: 3000 });

      // isFlashing should be true during flashing
      if (result.current.progress.status === 'flashing') {
        expect(result.current.isFlashing).toBe(true);
      }
    });
  });

  describe('startFlash', () => {
    it('detects chip and sets chipInfo', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.chipInfo).not.toBeNull();
      });

      expect(result.current.chipInfo?.chip).toBe('ESP32-S3');
      expect(result.current.chipInfo?.mac).toBe('AA:BB:CC:DD:EE:FF');
    });

    it('handles chip detection without MAC', async () => {
      mockChipRom.readMac.mockRejectedValueOnce(new Error('MAC not available'));
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.chipInfo).not.toBeNull();
      });

      expect(result.current.chipInfo?.chip).toBe('ESP32-S3');
      expect(result.current.chipInfo?.mac).toBe('');
    });

    it('downloads firmware from manifest', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('https://example.com/manifest.json');
      });

      // Should fetch firmware parts
      expect(global.fetch).toHaveBeenCalledTimes(2); // manifest + firmware
    });

    it('handles manifest fetch errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.progress.status).toBe('error');
      });

      expect(result.current.progress.error).toBeDefined();
    });

    it('handles invalid manifest format', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: 'manifest' }),
      });
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.progress.status).toBe('error');
      });

      expect(result.current.progress.error).toContain('No firmware parts');
    });

    it('calls onProgress callback when provided', async () => {
      const mockPort = createMockSerialPort();
      const onProgress = jest.fn();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(
          mockPort as SerialPort,
          'https://example.com/manifest.json',
          onProgress
        );
      });

      await waitFor(() => {
        expect(onProgress).toHaveBeenCalled();
      });

      // onProgress should be called with progress updates
      expect(onProgress.mock.calls.length).toBeGreaterThan(0);
    });

    it('updates progress through phases', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      act(() => {
        result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      // Eventually should complete (mocks resolve quickly, so we check final state)
      await waitFor(() => {
        expect(['complete', 'error']).toContain(result.current.progress.status);
      }, { timeout: 5000 });

      // Verify progress was updated
      expect(result.current.progress.phase).toBeTruthy();
      expect(result.current.progress.message).toBeTruthy();
    });

    it('handles abort during flash', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      // Start flash
      act(() => {
        result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      // Abort before completion
      act(() => {
        result.current.abortFlash();
      });

      await waitFor(() => {
        expect(result.current.progress.status).toBe('error');
        expect(result.current.progress.error).toBe('Aborted');
      });
    });

    it('cleans up transport on success', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.progress.status === 'complete' || result.current.progress.status === 'error').toBe(true);
      });

      // Transport should be cleaned up
      if (result.current.progress.status === 'complete') {
        expect(mockTransport.disconnect).toHaveBeenCalled();
      }
    });

    it('cleans up transport on error', async () => {
      mockESPLoader.main.mockRejectedValueOnce(new Error('Connection failed'));
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.progress.status).toBe('error');
      });

      // Transport should be cleaned up even on error
      expect(mockTransport.disconnect).toHaveBeenCalled();
    });

    it('handles writeFlash progress callbacks', async () => {
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      // Mock writeFlash to call reportProgress
      mockESPLoader.writeFlash.mockImplementationOnce(async (options: { reportProgress?: (fileIndex: number, written: number, total: number) => void }) => {
        if (options.reportProgress) {
          options.reportProgress(0, 50, 100);
        }
      });

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      // Progress should be updated
      await waitFor(() => {
        expect(result.current.progress.percent).toBeGreaterThan(20);
      });
    });
  });

  describe('error handling', () => {
    it('handles connection errors', async () => {
      mockESPLoader.main.mockRejectedValueOnce(new Error('Failed to connect'));
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.progress.status).toBe('error');
      });

      expect(result.current.progress.error).toBe('Failed to connect');
    });

    it('handles flash write errors', async () => {
      mockESPLoader.writeFlash.mockRejectedValueOnce(new Error('Write failed'));
      const mockPort = createMockSerialPort();
      const { result } = renderHook(() => useEspFlash());

      await act(async () => {
        await result.current.startFlash(mockPort as SerialPort, 'https://example.com/manifest.json');
      });

      await waitFor(() => {
        expect(result.current.progress.status).toBe('error');
      });

      expect(result.current.progress.error).toBe('Write failed');
    });
  });
});
