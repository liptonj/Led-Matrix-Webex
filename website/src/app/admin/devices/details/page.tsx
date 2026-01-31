'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import DeviceDetailPanel from '../DeviceDetailPanel';

export default function DeviceDetailPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const rawSerial = searchParams.get('serial') || '';
    const serialNumber = rawSerial ? decodeURIComponent(rawSerial) : '';

    return (
        <div className="space-y-4">
            <nav className="text-sm text-gray-500 dark:text-gray-400">
                <Link href="/admin/devices" className="hover:underline text-blue-600 dark:text-blue-400">
                    Devices
                </Link>
                <span className="mx-2">/</span>
                <span className="font-mono text-gray-700 dark:text-gray-200">
                    {serialNumber || 'Device'}
                </span>
            </nav>
            <DeviceDetailPanel
                serialNumber={serialNumber}
                onClose={() => router.push('/admin/devices')}
            />
        </div>
    );
}
