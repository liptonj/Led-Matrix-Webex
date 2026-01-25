'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to console (or an error reporting service)
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center p-4">
      <div className="max-w-md text-center">
        <div className="text-8xl mb-6">⚠️</div>
        <h1 className="text-3xl font-bold mb-4">Something went wrong</h1>
        <p className="text-[var(--color-text-muted)] mb-8">
          An unexpected error occurred. Please try again.
        </p>

        <div className="flex flex-col gap-4 items-center">
          <Button variant="primary" size="lg" onClick={reset}>
            Try Again
          </Button>
          
          <Link href="/">
            <Button variant="default">
              ← Return to Home
            </Button>
          </Link>
        </div>

        {process.env.NODE_ENV === 'development' && error.message && (
          <div className="mt-8 p-4 bg-danger/10 border border-danger rounded-lg text-left">
            <p className="text-sm font-mono text-danger break-all">
              {error.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
