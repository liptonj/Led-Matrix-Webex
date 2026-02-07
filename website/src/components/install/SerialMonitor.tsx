'use client';

import type { AutoApproveStatus } from '@/hooks/useSerialMonitor';
import { TerminalDisplay } from '@/components/ui/TerminalDisplay';

interface SerialMonitorProps {
  serialOutput: string[];
  autoApproveStatus: AutoApproveStatus;
  approveMessage: string;
  extractedPairingCode: string | null;
  isMonitoring: boolean;
}

/**
 * Terminal-like display component for Serial output during device installation.
 * Wraps TerminalDisplay with pairing code extraction UI.
 */
export function SerialMonitor({
  serialOutput,
  autoApproveStatus,
  approveMessage,
  extractedPairingCode,
  isMonitoring,
}: SerialMonitorProps) {
  const getStatusColor = () => {
    switch (autoApproveStatus) {
      case 'monitoring':
        return 'text-blue-600 dark:text-blue-400';
      case 'approving':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'success':
        return 'text-green-600 dark:text-green-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getStatusIcon = () => {
    switch (autoApproveStatus) {
      case 'monitoring':
        return '🔍';
      case 'approving':
        return '⏳';
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      default:
        return '';
    }
  };

  const monitoringIndicator = isMonitoring ? (
    <span className="text-xs text-blue-400 flex items-center gap-1">
      <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
      Monitoring...
    </span>
  ) : undefined;

  return (
    <div className="space-y-4">
      {/* Status Message */}
      {approveMessage && (
        <div className={`flex items-center gap-2 text-sm font-medium ${getStatusColor()}`}>
          <span>{getStatusIcon()}</span>
          <span>{approveMessage}</span>
          {isMonitoring && (
            <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse ml-2" />
          )}
        </div>
      )}

      {/* Pairing Code Display */}
      {extractedPairingCode && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-900 dark:text-green-200">
                Pairing Code Found:
              </p>
              <p className="text-2xl font-mono font-bold text-green-700 dark:text-green-300 mt-1">
                {extractedPairingCode}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Terminal Display */}
      <TerminalDisplay
        lines={serialOutput}
        title="Serial Monitor"
        statusSlot={monitoringIndicator}
        emptyText="Waiting for Serial output..."
      />

      {/* Instructions */}
      {autoApproveStatus === 'error' && extractedPairingCode && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-sm text-yellow-900 dark:text-yellow-200 mb-2">
            <strong>Auto-approval failed.</strong> Please manually approve your device:
          </p>
          <ol className="text-sm text-yellow-800 dark:text-yellow-300 list-decimal list-inside space-y-1">
            <li>Go to the <a href="/user/approve-device" className="underline font-medium">approve device page</a></li>
            <li>Enter the pairing code: <strong className="font-mono">{extractedPairingCode}</strong></li>
            <li>Click &quot;Approve Device&quot;</li>
          </ol>
        </div>
      )}
    </div>
  );
}
