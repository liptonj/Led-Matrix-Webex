'use client';

import { useEffect, useRef } from 'react';
import { AutoApproveStatus } from '@/hooks/useSerialMonitor';

interface SerialMonitorProps {
  serialOutput: string[];
  autoApproveStatus: AutoApproveStatus;
  approveMessage: string;
  extractedPairingCode: string | null;
  isMonitoring: boolean;
}

/**
 * Terminal-like display component for Serial output.
 */
export function SerialMonitor({
  serialOutput,
  autoApproveStatus,
  approveMessage,
  extractedPairingCode,
  isMonitoring,
}: SerialMonitorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [serialOutput]);

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

      {/* Serial Output Terminal */}
      <div className="bg-gray-900 dark:bg-black rounded-lg border border-gray-700 dark:border-gray-800 overflow-hidden">
        {/* Terminal Header */}
        <div className="bg-gray-800 dark:bg-gray-900 px-4 py-2 flex items-center gap-2 border-b border-gray-700 dark:border-gray-800">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-xs text-gray-400 ml-2">Serial Monitor</span>
          {isMonitoring && (
            <span className="ml-auto text-xs text-blue-400 flex items-center gap-1">
              <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              Monitoring...
            </span>
          )}
        </div>

        {/* Terminal Content */}
        <div
          ref={scrollRef}
          className="p-4 font-mono text-sm text-green-400 dark:text-green-300 h-64 overflow-y-auto"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          }}
        >
          {serialOutput.length === 0 ? (
            <div className="text-gray-500 dark:text-gray-600">
              Waiting for Serial output...
            </div>
          ) : (
            serialOutput.map((line, index) => (
              <div key={index} className="mb-1">
                <span className="text-gray-500 dark:text-gray-600 mr-2">
                  {String(index + 1).padStart(4, '0')}
                </span>
                <span>{line}</span>
              </div>
            ))
          )}
        </div>
      </div>

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
