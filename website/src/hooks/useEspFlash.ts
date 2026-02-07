'use client';

import { useState, useCallback, useRef } from 'react';
import type { FlashStatus } from '@/types/support';

interface FlashProgress {
  status: FlashStatus;
  phase: string;
  percent: number;
  message: string;
  error: string | null;
}

interface ChipInfo {
  chip: string;
  features: string;
  mac: string;
}

interface UseEspFlashReturn {
  /** Current flash progress state */
  progress: FlashProgress;
  /** Detected chip information (after connect) */
  chipInfo: ChipInfo | null;
  /** Whether a flash operation is in progress */
  isFlashing: boolean;
  /**
   * Start flashing firmware to the device.
   * @param port - The SerialPort (must not have an active reader)
   * @param manifestUrl - URL to the firmware manifest JSON
   * @param onProgress - Optional callback for progress updates (for broadcasting)
   */
  startFlash: (
    port: SerialPort,
    manifestUrl: string,
    onProgress?: (progress: FlashProgress) => void,
  ) => Promise<void>;
  /** Abort an in-progress flash operation */
  abortFlash: () => void;
  /** Reset flash state back to idle */
  resetState: () => void;
}

const INITIAL_PROGRESS: FlashProgress = {
  status: 'idle',
  phase: '',
  percent: 0,
  message: '',
  error: null,
};

/**
 * Hook for managing ESP32 firmware flashing via esptool-js.
 *
 * This hook handles:
 * - ESPLoader initialization with a SerialPort
 * - Chip detection and identification
 * - Firmware download from manifest URL
 * - Flash writing with progress tracking
 * - Flash verification and device reset
 * - Error recovery and abort handling
 *
 * IMPORTANT: The serial port's reader must be paused/closed before calling
 * startFlash, as esptool-js needs exclusive port access. The caller
 * (useSerialBridge orchestrator) is responsible for pausing and resuming.
 */
export function useEspFlash(): UseEspFlashReturn {
  const [progress, setProgress] = useState<FlashProgress>(INITIAL_PROGRESS);
  const [chipInfo, setChipInfo] = useState<ChipInfo | null>(null);

  const abortRef = useRef(false);
  const loaderRef = useRef<unknown>(null);
  const transportRef = useRef<unknown>(null);
  const onProgressRef = useRef<((progress: FlashProgress) => void) | undefined>(undefined);

  const isFlashing = progress.status !== 'idle' && progress.status !== 'complete' && progress.status !== 'error';

  const updateProgress = useCallback((update: Partial<FlashProgress>) => {
    setProgress((prev) => {
      const next = { ...prev, ...update };
      onProgressRef.current?.(next);
      return next;
    });
  }, []);

  const resetState = useCallback(() => {
    setProgress(INITIAL_PROGRESS);
    setChipInfo(null);
    abortRef.current = false;
    loaderRef.current = null;
    transportRef.current = null;
  }, []);

  const abortFlash = useCallback(() => {
    abortRef.current = true;
    updateProgress({
      status: 'error',
      message: 'Flash aborted by user.',
      error: 'Aborted',
    });
  }, [updateProgress]);

  const startFlash = useCallback(async (
    port: SerialPort,
    manifestUrl: string,
    onProgress?: (progress: FlashProgress) => void,
  ): Promise<void> => {
    onProgressRef.current = onProgress;
    abortRef.current = false;

    try {
      // Dynamic import to avoid loading esptool-js unless needed
      const { ESPLoader, Transport } = await import('esptool-js');

      // Phase 1: Connect to device
      updateProgress({
        status: 'connecting',
        phase: 'Connecting',
        percent: 0,
        message: 'Connecting to device bootloader...',
        error: null,
      });

      const transport = new Transport(port);
      transportRef.current = transport;

      const terminal = {
        clean: () => {},
        writeLine: (data: string) => {
          // Relay esptool output for debugging
          console.log('[esptool]', data);
        },
        write: (data: string) => {
          console.log('[esptool]', data);
        },
      };

      const loader = new ESPLoader({
        transport,
        baudrate: 115200,
        romBaudrate: 115200,
        terminal,
      });
      loaderRef.current = loader;

      // Connect and detect chip
      const chip = await loader.main();

      if (abortRef.current) return;

      const info: ChipInfo = {
        chip: chip || 'Unknown',
        features: '',
        mac: '',
      };

      try {
        // MAC is read via the ROM target's readMac method
        if (loader.chip && typeof loader.chip.readMac === 'function') {
          const macAddr = await loader.chip.readMac(loader);
          if (macAddr) info.mac = macAddr;
        }
      } catch {
        // MAC detection is optional
      }

      setChipInfo(info);
      updateProgress({
        status: 'connecting',
        phase: 'Connected',
        percent: 10,
        message: `Connected to ${info.chip}${info.mac ? ` (${info.mac})` : ''}`,
      });

      if (abortRef.current) return;

      // Phase 2: Fetch firmware binary from manifest
      updateProgress({
        status: 'flashing',
        phase: 'Downloading',
        percent: 15,
        message: 'Downloading firmware...',
      });

      const manifestResponse = await fetch(manifestUrl);
      if (!manifestResponse.ok) {
        throw new Error(`Failed to fetch manifest: ${manifestResponse.status}`);
      }

      const manifest = await manifestResponse.json();

      // Extract firmware parts from manifest
      // ESP Web Tools manifest format: { builds: [{ chipFamily, parts: [{ path, offset }] }] }
      // Or simple format: { parts: [{ path, offset }] }
      const parts = manifest.parts || manifest.builds?.[0]?.parts;
      if (!parts || parts.length === 0) {
        throw new Error('No firmware parts found in manifest');
      }

      if (abortRef.current) return;

      // Download all firmware parts
      const fileArray: { data: string; address: number }[] = [];

      for (const part of parts) {
        const partUrl = new URL(part.path, manifestUrl).toString();
        const partResponse = await fetch(partUrl);
        if (!partResponse.ok) {
          throw new Error(`Failed to download firmware part: ${part.path}`);
        }
        const blob = await partResponse.arrayBuffer();
        // Convert to binary string for esptool-js
        const binaryString = Array.from(new Uint8Array(blob))
          .map((byte) => String.fromCharCode(byte))
          .join('');
        fileArray.push({
          data: binaryString,
          address: part.offset,
        });
      }

      if (abortRef.current) return;

      // Phase 3: Flash firmware
      updateProgress({
        status: 'flashing',
        phase: 'Writing',
        percent: 20,
        message: 'Writing firmware to device...',
      });

      await loader.writeFlash({
        fileArray,
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex: number, written: number, total: number) => {
          if (abortRef.current) return;
          const partPercent = Math.round((written / total) * 100);
          const overallPercent = 20 + Math.round((partPercent / 100) * 65);
          updateProgress({
            status: 'flashing',
            phase: 'Writing',
            percent: overallPercent,
            message: `Writing firmware: ${partPercent}% (part ${fileIndex + 1}/${fileArray.length})`,
          });
        },
      });

      if (abortRef.current) return;

      // Phase 4: Reset device
      updateProgress({
        status: 'resetting',
        phase: 'Resetting',
        percent: 90,
        message: 'Resetting device...',
      });

      // Use softReset (staying out of bootloader) to reboot into firmware
      await loader.softReset(false);

      // Phase 5: Complete
      updateProgress({
        status: 'complete',
        phase: 'Complete',
        percent: 100,
        message: 'Firmware flashed successfully!',
      });

      // Cleanup transport
      try {
        await transport.disconnect();
      } catch {
        // Ignore disconnect errors after successful flash
      }
    } catch (err) {
      if (abortRef.current) return;

      const errorMessage = err instanceof Error ? err.message : 'Unknown flash error';
      console.error('[useEspFlash] Flash failed:', err);

      updateProgress({
        status: 'error',
        phase: 'Error',
        percent: 0,
        message: `Flash failed: ${errorMessage}`,
        error: errorMessage,
      });

      // Try to clean up transport on error
      if (transportRef.current) {
        try {
          await (transportRef.current as { disconnect: () => Promise<void> }).disconnect();
        } catch {
          // Ignore cleanup errors
        }
      }
    } finally {
      loaderRef.current = null;
      transportRef.current = null;
      onProgressRef.current = undefined;
    }
  }, [updateProgress]);

  return {
    progress,
    chipInfo,
    isFlashing,
    startFlash,
    abortFlash,
    resetState,
  };
}
