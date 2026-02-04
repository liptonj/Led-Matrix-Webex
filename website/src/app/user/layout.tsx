'use client';

import { Suspense, lazy } from 'react';

// Lazy load UserShell as it contains heavy auth logic
const UserShell = lazy(() => import('./UserShell'));

function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent" />
        <p className="mt-2 text-gray-600">Loading...</p>
      </div>
    </div>
  );
}

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <UserShell>{children}</UserShell>
    </Suspense>
  );
}
