'use client';

import { Suspense, lazy } from 'react';

// Lazy load the heavy embedded app client for better initial load
const EmbeddedAppClient = lazy(() => 
  import('./EmbeddedAppClient').then(mod => ({ default: mod.EmbeddedAppClient }))
);

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
        <p className="mt-2 text-[var(--color-text-muted)]">Loading...</p>
      </div>
    </div>
  );
}

export function EmbeddedPageClient() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <EmbeddedAppClient />
    </Suspense>
  );
}
