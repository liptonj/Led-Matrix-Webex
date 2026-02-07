/**
 * Serial Signal Utilities Tests
 *
 * Tests for DTR/RTS signal utilities used for ESP32 hardware control.
 */

import { resetDevice, enterBootloader } from '../signals';

describe('Serial Signal Utilities', () => {
  let mockPort: {
    setSignals: jest.Mock;
  };

  beforeEach(() => {
    mockPort = {
      setSignals: jest.fn().mockResolvedValue(undefined),
    };
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('resetDevice', () => {
    it('sends correct DTR/RTS sequence for reset', async () => {
      const promise = resetDevice(mockPort as unknown as SerialPort);

      // Advance timers for the sleep(100) call
      await jest.advanceTimersByTimeAsync(100);
      await promise;

      expect(mockPort.setSignals).toHaveBeenCalledTimes(2);
      expect(mockPort.setSignals).toHaveBeenNthCalledWith(1, {
        dataTerminalReady: false,
        requestToSend: true,
      });
      expect(mockPort.setSignals).toHaveBeenNthCalledWith(2, {
        dataTerminalReady: false,
        requestToSend: false,
      });
    });

    it('throws descriptive error on setSignals failure', async () => {
      mockPort.setSignals.mockRejectedValueOnce(new Error('Port closed'));

      await expect(resetDevice(mockPort as unknown as SerialPort)).rejects.toThrow(
        'Failed to reset device: Port closed'
      );
    });

    it('handles non-Error exceptions', async () => {
      mockPort.setSignals.mockRejectedValueOnce('String error');

      await expect(resetDevice(mockPort as unknown as SerialPort)).rejects.toThrow(
        'Failed to reset device: Unknown error'
      );
    });
  });

  describe('enterBootloader', () => {
    it('sends correct DTR/RTS sequence for bootloader', async () => {
      const promise = enterBootloader(mockPort as unknown as SerialPort);

      await jest.advanceTimersByTimeAsync(100);
      await jest.advanceTimersByTimeAsync(50);
      await promise;

      expect(mockPort.setSignals).toHaveBeenCalledTimes(3);
      expect(mockPort.setSignals).toHaveBeenNthCalledWith(1, {
        dataTerminalReady: false,
        requestToSend: true,
      });
      expect(mockPort.setSignals).toHaveBeenNthCalledWith(2, {
        dataTerminalReady: true,
        requestToSend: false,
      });
      expect(mockPort.setSignals).toHaveBeenNthCalledWith(3, {
        dataTerminalReady: false,
        requestToSend: false,
      });
    });

    it('throws descriptive error on setSignals failure', async () => {
      mockPort.setSignals.mockRejectedValueOnce(new Error('USB disconnected'));

      await expect(enterBootloader(mockPort as unknown as SerialPort)).rejects.toThrow(
        'Failed to enter bootloader: USB disconnected'
      );
    });

    it('handles errors during first signal', async () => {
      mockPort.setSignals.mockRejectedValueOnce(new Error('Port not open'));

      await expect(enterBootloader(mockPort as unknown as SerialPort)).rejects.toThrow(
        'Failed to enter bootloader: Port not open'
      );
    });

    it('handles errors during second signal', async () => {
      mockPort.setSignals
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(new Error('Connection lost')); // Second call fails

      const promise = enterBootloader(mockPort as unknown as SerialPort);
      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
      const assertion = expect(promise).rejects.toThrow(
        'Failed to enter bootloader: Connection lost'
      );
      await jest.advanceTimersByTimeAsync(100);
      await assertion;
    });

    it('handles errors during third signal', async () => {
      mockPort.setSignals
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockResolvedValueOnce(undefined) // Second call succeeds
        .mockRejectedValueOnce(new Error('Device removed')); // Third call fails

      const promise = enterBootloader(mockPort as unknown as SerialPort);
      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
      const assertion = expect(promise).rejects.toThrow(
        'Failed to enter bootloader: Device removed'
      );
      await jest.advanceTimersByTimeAsync(100);
      await jest.advanceTimersByTimeAsync(50);
      await assertion;
    });
  });
});
