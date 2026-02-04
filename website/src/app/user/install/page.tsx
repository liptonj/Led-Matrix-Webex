'use client';

import { InstallWizard } from '@/components/install/InstallWizard';
import Link from 'next/link';
import Script from 'next/script';

export default function InstallDevicePage() {
  return (
    <>
      <Script
        src="https://unpkg.com/esp-web-tools@10.2.1/dist/web/install-button.js"
        type="module"
        strategy="afterInteractive"
      />
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            Install Device Firmware
          </h1>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-900 dark:text-blue-200 mb-2">
              <strong>For logged-in users only:</strong> This installation process will automatically 
              approve your device after successful firmware installation. You must be logged in to 
              complete the installation.
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              After installation, your device will appear in your dashboard and start syncing 
              your Webex status automatically.
            </p>
          </div>
        </div>

        {/* Install Wizard */}
        <InstallWizard />

        {/* Post-install Instructions */}
        <div className="mt-8 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-green-900 dark:text-green-200 mb-3">
            ✓ Device Auto-Approval
          </h2>
          <p className="text-sm text-green-800 dark:text-green-300 mb-3">
            Once the firmware is successfully installed and your device connects to WiFi, it will 
            automatically be approved and linked to your account. No manual approval needed!
          </p>
          <ul className="text-sm text-green-800 dark:text-green-300 space-y-2 list-disc list-inside">
            <li>Device will appear in your <Link href="/user" className="underline font-medium">dashboard</Link> within a few minutes</li>
            <li>Status will sync automatically once connected</li>
            <li>You can manage your device from the dashboard</li>
          </ul>
        </div>
      </div>
    </>
  );
}
