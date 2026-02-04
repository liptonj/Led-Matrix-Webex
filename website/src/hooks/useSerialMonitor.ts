'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export type AutoApproveStatus = 'idle' | 'monitoring' | 'approving' | 'success' | 'error';

interface UseSerialMonitorOptions {
  onPairingCodeFound?: (code: string) => void;
  timeoutMs?: number;
}

interface UseSerialMonitorReturn {
  serialOutput: string[];
  autoApproveStatus: AutoApproveStatus;
  approveMessage: string;
  extractedPairingCode: string | null;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => void;
  isMonitoring: boolean;
}

/**
 * Extract pairing code from Serial output text.
 * Pattern: "PAIRING CODE: XXXXXX" or "[SUPABASE] Pairing code: XXXXXX"
 * Returns 6-character uppercase code or null if not found.
 */
export function extractPairingCode(text: string): string | null {
  // Match patterns like:
  // - "PAIRING CODE: ABC123"
  // - "[SUPABASE] Pairing code: ABC123"
  // - "Pairing code: ABC123"
  const patterns = [
    /PAIRING CODE:\s*([A-HJ-NP-Z2-9]{6})/i,
    /\[SUPABASE\]\s*Pairing code:\s*([A-HJ-NP-Z2-9]{6})/i,
    /Pairing code:\s*([A-HJ-NP-Z2-9]{6})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

/**
 * Hook for monitoring Serial port output and extracting pairing codes.
 */
export function useSerialMonitor({
  onPairingCodeFound,
  timeoutMs = 60000, // 60 seconds default timeout
}: UseSerialMonitorOptions = {}): UseSerialMonitorReturn {
  const [serialOutput, setSerialOutput] = useState<string[]>([]);
  const [autoApproveStatus, setAutoApproveStatus] = useState<AutoApproveStatus>('idle');
  const [approveMessage, setApproveMessage] = useState('');
  const [extractedPairingCode, setExtractedPairingCode] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setAutoApproveStatus('idle');

    // Clear timeout
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Cancel reader
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Close reader
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {
        // Ignore cancellation errors
      });
      readerRef.current = null;
    }

    // Close port
    if (portRef.current) {
      portRef.current.close().catch(() => {
        // Ignore close errors
      });
      portRef.current = null;
    }
  }, []);

  const startMonitoring = useCallback(async () => {
    // Check if Web Serial API is available
    if (!('serial' in navigator)) {
      setAutoApproveStatus('error');
      setApproveMessage('Web Serial API is not available in this browser. Please use Chrome or Edge.');
      return;
    }

    try {
      setIsMonitoring(true);
      setAutoApproveStatus('monitoring');
      setApproveMessage('Requesting Serial port access...');
      setSerialOutput([]);
      setExtractedPairingCode(null);

      // Request Serial port
      const port = await navigator.serial.requestPort();
      portRef.current = port;

      setApproveMessage('Opening Serial port...');

      // Open port with 115200 baud (standard ESP32 speed)
      await port.open({ baudRate: 115200 });
      setApproveMessage('Monitoring Serial output for pairing code...');

      // Set up timeout
      timeoutRef.current = window.setTimeout(() => {
        stopMonitoring();
        setAutoApproveStatus('error');
        setApproveMessage('Timeout: No pairing code found after 60 seconds. Please check the device Serial output manually.');
      }, timeoutMs);

      // Set up reader
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      if (!port.readable) {
        throw new Error('Serial port is not readable');
      }

      const reader = port.readable.getReader();
      readerRef.current = reader;

      // Text decoder for converting bytes to text
      const decoder = new TextDecoder();
      let buffer = '';

      // Read loop
      while (!abortController.signal.aborted) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        if (value) {
          // Decode bytes to text
          const text = decoder.decode(value, { stream: true });
          buffer += text;

          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine) {
              setSerialOutput((prev) => [...prev, trimmedLine]);

              // Try to extract pairing code
              const pairingCode = extractPairingCode(trimmedLine);
              if (pairingCode) {
                setExtractedPairingCode(pairingCode);
                setApproveMessage(`Pairing code found: ${pairingCode}`);
                
                // Clear timeout
                if (timeoutRef.current !== null) {
                  clearTimeout(timeoutRef.current);
                  timeoutRef.current = null;
                }

                // Notify callback
                if (onPairingCodeFound) {
                  onPairingCodeFound(pairingCode);
                }

                // Stop monitoring (but keep port open for now)
                setIsMonitoring(false);
                setAutoApproveStatus('idle');
                break;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Serial monitoring error:', error);
      stopMonitoring();
      
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        setAutoApproveStatus('error');
        setApproveMessage('No Serial port selected. Please select your device when prompted.');
      } else if (error instanceof DOMException && error.name === 'SecurityError') {
        setAutoApproveStatus('error');
        setApproveMessage('Permission denied. Please allow Serial port access.');
      } else {
        setAutoApproveStatus('error');
        setApproveMessage(
          error instanceof Error
            ? `Serial monitoring failed: ${error.message}`
            : 'Serial monitoring failed. Please check the device Serial output manually.'
        );
      }
    }
  }, [onPairingCodeFound, timeoutMs, stopMonitoring]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  return {
    serialOutput,
    autoApproveStatus,
    approveMessage,
    extractedPairingCode,
    startMonitoring,
    stopMonitoring,
    isMonitoring,
  };
}
