'use client';

interface SupportLandingProps {
  onConnect: () => void;
  isConnecting: boolean;
  error: string | null;
}

/**
 * Landing state for the user support page.
 * Prompts user to connect their device via USB.
 */
export function SupportLanding({ onConnect, isConnecting, error }: SupportLandingProps) {
  return (
    <div className="max-w-lg mx-auto mt-12">
      <div className="text-center mb-8">
        <div className="text-5xl mb-4">🛠️</div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Remote Support
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Connect your device via USB for remote technical support.
          A technician will be able to view your device output and perform diagnostics.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p className="font-medium text-gray-900 dark:text-white">Before you begin:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Connect your ESP32 device to this computer via USB</li>
            <li>Make sure no other program is using the serial port</li>
            <li>Click the button below and select your device</li>
          </ol>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <button
          onClick={onConnect}
          disabled={isConnecting}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isConnecting ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            'Connect Device'
          )}
        </button>
      </div>
    </div>
  );
}
