'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import DeviceDetailPanel from '../DeviceDetailPanel';

export default function DeviceDetailPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const rawSerial = searchParams.get('serial') || '';
    const serialNumber = rawSerial ? decodeURIComponent(rawSerial) : '';
    const currentLabel = serialNumber || 'Device';

    return (
        <div className="space-y-4 min-w-0 w-full">
            <nav
                aria-label="Breadcrumb"
                className="text-sm text-[var(--color-text-muted)]"
            >
                <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" role="list">
                    <li>
                        <Link
                            href="/admin/devices"
                            className="hover:underline text-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)] rounded px-1 -mx-1"
                            aria-label="Back to devices list"
                        >
                            Devices
                        </Link>
                    </li>
                    <li
                        className="flex items-center gap-x-2 text-[var(--color-text-muted)]"
                        aria-hidden="true"
                    >
                        <span>/</span>
                    </li>
                    <li aria-current="page" className="min-w-0">
                        <span
                            className="font-mono text-[var(--color-text)] break-all sm:break-normal"
                            title={currentLabel}
                        >
                            {currentLabel}
                        </span>
                    </li>
                </ol>
            </nav>
            <DeviceDetailPanel
                serialNumber={serialNumber}
                onClose={() => router.push('/admin/devices')}
            />
        </div>
    );
}
