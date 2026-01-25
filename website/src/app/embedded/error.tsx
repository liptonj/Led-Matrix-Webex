'use client';

import { useEffect } from 'react';
import { Button, Alert, AlertTitle } from '@/components/ui';

export default function EmbeddedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Embedded app error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center p-4">
      <div className="max-w-md">
        <Alert variant="danger">
          <AlertTitle>Connection Error</AlertTitle>
          <p className="mb-4">
            The embedded app encountered an error. This may be due to a network issue or 
            the Webex SDK not loading properly.
          </p>
          <div className="flex gap-3">
            <Button variant="primary" onClick={reset}>
              Try Again
            </Button>
            <Button onClick={() => window.location.reload()}>
              Reload Page
            </Button>
          </div>
        </Alert>

        <div className="mt-6 p-4 bg-[var(--color-surface-alt)] rounded-lg">
          <h4 className="font-medium mb-2">Troubleshooting Tips:</h4>
          <ul className="text-sm text-[var(--color-text-muted)] space-y-1 list-disc list-inside">
            <li>Check your internet connection</li>
            <li>Try opening this page in a new tab</li>
            <li>Clear browser cache and reload</li>
            <li>Make sure you&apos;re running inside Webex</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
