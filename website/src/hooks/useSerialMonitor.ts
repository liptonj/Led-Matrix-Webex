'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSerialPort } from './useSerialPort';

export type AutoApproveStatus = 'idle' | 'monitoring' | 'approving' | 'success' | 'error';

interface UseSerialMonitorOptions {
  onPairingCodeFound?: (code: string) => void;
  onProvisionTokenAck?: (success: boolean, error?: string) => void;
  timeoutMs?: number;
}

interface UseSerialMonitorReturn {
  serialOutput: string[];
  autoApproveStatus: AutoApproveStatus;
  approveMessage: string;
  extractedPairingCode: string | null;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => void;
  sendCommand: (command: string) => Promise<boolean>;
  isMonitoring: boolean;
}

/**
 * Extract pairing code from Serial output text.
 * Pattern: "PAIRING CODE: XXXXXX" or "[SUPABASE] Pairing code: XXXXXX"
 * Returns 6-character uppercase code or null if not found.
 */
export function extractPairingCode(text: string): string | null {
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
 * Thin wrapper around useSerialPort that adds pairing code extraction
 * and provision token ACK detection.
 */
export function useSerialMonitor({
  onPairingCodeFound,
  onProvisionTokenAck,
  timeoutMs = 60000,
}: UseSerialMonitorOptions = {}): UseSerialMonitorReturn {
  const [autoApproveStatus, setAutoApproveStatus] = useState<AutoApproveStatus>('idle');
  const [approveMessage, setApproveMessage] = useState('');
  const [extractedPairingCode, setExtractedPairingCode] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);

  const timeoutRef = useRef<number | null>(null);
  const onPairingCodeFoundRef = useRef(onPairingCodeFound);
  const onProvisionTokenAckRef = useRef(onProvisionTokenAck);

  useEffect(() => { onPairingCodeFoundRef.current = onPairingCodeFound; }, [onPairingCodeFound]);
  useEffect(() => { onProvisionTokenAckRef.current = onProvisionTokenAck; }, [onProvisionTokenAck]);

  const handleLine = useCallback((line: string) => {
    // Try to extract pairing code
    const pairingCode = extractPairingCode(line);
    if (pairingCode) {
      setExtractedPairingCode(pairingCode);
      setApproveMessage(`Pairing code found: ${pairingCode}`);

      // Clear timeout
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Notify callback
      onPairingCodeFoundRef.current?.(pairingCode);

      // Stop monitoring state (port stays open)
      setIsMonitoring(false);
      setAutoApproveStatus('idle');
    }

    // Check for provision token ACK
    const provisionTokenAckMatch = line.match(/^ACK:PROVISION_TOKEN:(success|error)(?::(.+))?$/);
    if (provisionTokenAckMatch) {
      const success = provisionTokenAckMatch[1] === 'success';
      const errorReason = provisionTokenAckMatch[2];
      onProvisionTokenAckRef.current?.(success, errorReason);
    }
  }, []);

  const serialPort = useSerialPort({
    baudRate: 115200,
    onLine: handleLine,
  });

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setAutoApproveStatus('idle');

    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    serialPort.disconnect();
  }, [serialPort]);

  // Watch for connection status changes
  useEffect(() => {
    if (!isMonitoring) return;

    if (serialPort.status === 'connected' && !timeoutRef.current) {
      // Connection succeeded, set up timeout
      setApproveMessage('Monitoring Serial output for pairing code...');
      const timeoutSeconds = Math.round(timeoutMs / 1000);
      timeoutRef.current = window.setTimeout(() => {
        stopMonitoring();
        setAutoApproveStatus('error');
        setApproveMessage(`Timeout: No pairing code found after ${timeoutSeconds} seconds. Please check the device Serial output manually.`);
      }, timeoutMs);
    } else if (serialPort.status === 'error' && serialPort.error) {
      // Connection failed
      setAutoApproveStatus('error');
      setApproveMessage(serialPort.error);
      setIsMonitoring(false);
    } else if (serialPort.status === 'disconnected' && isMonitoring) {
      // Connection was cancelled or disconnected
      setIsMonitoring(false);
      setAutoApproveStatus('idle');
      if (serialPort.error) {
        setApproveMessage(serialPort.error);
      }
    }
  }, [serialPort.status, serialPort.error, isMonitoring, timeoutMs, stopMonitoring]);

  const startMonitoring = useCallback(async () => {
    try {
      setIsMonitoring(true);
      setAutoApproveStatus('monitoring');
      setApproveMessage('Requesting Serial port access...');
      setExtractedPairingCode(null);

      await serialPort.connect();
    } catch (error) {
      console.error('Serial monitoring error:', error);
      stopMonitoring();

      setAutoApproveStatus('error');
      setApproveMessage(
        error instanceof Error
          ? `Serial monitoring failed: ${error.message}`
          : 'Serial monitoring failed. Please check the device Serial output manually.'
      );
    }
  }, [serialPort, stopMonitoring]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    serialOutput: serialPort.lines,
    autoApproveStatus,
    approveMessage,
    extractedPairingCode,
    startMonitoring,
    stopMonitoring,
    sendCommand: serialPort.write,
    isMonitoring,
  };
}
