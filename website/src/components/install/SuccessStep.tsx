'use client';

import { Button } from '@/components/ui';
import Link from 'next/link';

interface SuccessStepProps {
  wifiConfigured: boolean;
}

export function SuccessStep({ wifiConfigured }: SuccessStepProps) {
  return (
    <div className="card animate-fade-in text-center">
      {/* Success Animation */}
      <div className="text-6xl mb-4 animate-bounce">✓</div>
      
      <h2 className="text-3xl font-bold text-success mb-4">
        Setup Complete!
      </h2>

      <p className="text-lg text-[var(--color-text-muted)] mb-8 max-w-md mx-auto">
        {wifiConfigured ? (
          <>
            Your LED Matrix display is now configured and connected to WiFi.
            It should start showing your Webex status shortly.
          </>
        ) : (
          <>
            Your LED Matrix firmware has been installed successfully.
            Follow the steps below to complete setup.
          </>
        )}
      </p>

      {/* Next Steps */}
      <div className="bg-[var(--color-surface-alt)] p-6 rounded-lg mb-8 text-left max-w-md mx-auto">
        <h3 className="font-semibold mb-3">Next Steps:</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-[var(--color-text-muted)]">
          {wifiConfigured ? (
            <>
              <li>Your device will reboot and connect to WiFi</li>
              <li>Look for the IP address on the LED matrix display</li>
              <li>Access the device&apos;s web interface at that IP</li>
              <li>Configure your Webex API credentials</li>
              <li>Your status will appear on the LED matrix!</li>
            </>
          ) : (
            <>
              <li>
                <strong>Option A:</strong> If you configured WiFi during installation, 
                the device will show its IP address on the LED matrix
              </li>
              <li>
                <strong>Option B:</strong> If WiFi wasn&apos;t configured, connect to the 
                device&apos;s AP: <code className="bg-[var(--color-surface)] px-1 rounded">Webex-Display-Setup</code>
              </li>
              <li>Navigate to <code className="bg-[var(--color-surface)] px-1 rounded">192.168.4.1</code> in your browser</li>
              <li>Complete WiFi and Webex configuration</li>
              <li>Your status will appear on the LED matrix!</li>
            </>
          )}
        </ol>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4 justify-center flex-wrap">
        <Link href="/">
          <Button variant="default">
            ← Back to Home
          </Button>
        </Link>
        
        <Link href="/troubleshooting">
          <Button variant="default">
            Troubleshooting Guide
          </Button>
        </Link>

        <button 
          onClick={() => window.location.reload()}
          className="btn btn-primary"
        >
          Install Another Device
        </button>
      </div>
    </div>
  );
}
