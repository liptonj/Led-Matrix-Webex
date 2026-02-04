'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function InstallRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Always redirect to user install page (login required)
    router.replace('/user/install');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-600 dark:text-gray-400">Redirecting to install page...</p>
      </div>
    </div>
  );
}
