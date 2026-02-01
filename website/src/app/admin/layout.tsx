'use client';

import { Suspense, lazy } from 'react';

// Lazy load AdminShell as it contains heavy auth logic
const AdminShell = lazy(() => import('./AdminShell'));

function LoadingFallback() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
                <p className="mt-2 text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
        </div>
    );
}

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <Suspense fallback={<LoadingFallback />}>
            <AdminShell>{children}</AdminShell>
        </Suspense>
    );
}
