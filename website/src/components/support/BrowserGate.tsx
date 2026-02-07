'use client';

/**
 * Browser compatibility gate for Web Serial API.
 * Shows a message when the browser doesn't support the required API.
 */
export function BrowserGate() {
  return (
    <div className="max-w-lg mx-auto mt-16 text-center">
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-8">
        <div className="text-4xl mb-4">🔌</div>
        <h2 className="text-xl font-semibold text-yellow-900 dark:text-yellow-200 mb-3">
          Browser Not Supported
        </h2>
        <p className="text-yellow-800 dark:text-yellow-300 mb-4">
          The remote support console requires the Web Serial API, which is only available in:
        </p>
        <ul className="text-sm text-yellow-700 dark:text-yellow-400 space-y-1 mb-4">
          <li><strong>Google Chrome</strong> version 89 or later</li>
          <li><strong>Microsoft Edge</strong> version 89 or later</li>
        </ul>
        <p className="text-sm text-yellow-600 dark:text-yellow-500">
          Firefox, Safari, and iOS browsers are not supported.
        </p>
      </div>
    </div>
  );
}

/** Check if Web Serial API is available in the current browser */
export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}
