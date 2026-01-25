import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { Alert, AlertTitle, Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Troubleshooting',
  description: 'Troubleshoot and diagnose common issues with your LED Matrix Webex Display',
};

const commonIssues = [
  {
    category: 'WiFi Connection',
    issues: [
      {
        problem: 'Device not connecting to WiFi',
        solutions: [
          'Check that WiFi password is correct (case-sensitive)',
          'Ensure your network uses 2.4GHz (ESP32 doesn\'t support 5GHz)',
          'Move device closer to the router',
          'Check if MAC filtering is enabled on your router',
        ],
      },
      {
        problem: 'Can\'t find "LED-Matrix-Setup" network',
        solutions: [
          'Hold the reset button for 10 seconds to factory reset',
          'Ensure device is powered on (LED matrix should light up)',
          'Wait 30 seconds after powering on for AP to start',
        ],
      },
    ],
  },
  {
    category: 'Display Issues',
    issues: [
      {
        problem: 'Display shows wrong status',
        solutions: [
          'Check Webex connection in the device web UI',
          'Re-authenticate with Webex if token expired',
          'Verify correct user account is linked',
        ],
      },
      {
        problem: 'Display is blank or flickering',
        solutions: [
          'Check power supply (needs 5V/3A minimum)',
          'Verify all HUB75 connections are secure',
          'See Hardware Guide for pin mapping',
        ],
      },
      {
        problem: 'Colors are wrong or garbled',
        solutions: [
          'Check RGB wire connections match pin mapping',
          'Verify FM6126A driver chip compatibility',
          'Re-flash firmware if display was working before',
        ],
      },
    ],
  },
  {
    category: 'Bridge Connection',
    issues: [
      {
        problem: 'Can\'t connect to bridge',
        solutions: [
          'Verify bridge URL is correct (wss:// for cloud, ws:// for local)',
          'Check that bridge server is running',
          'Ensure pairing code matches display code',
          'Check firewall isn\'t blocking WebSocket connections',
        ],
      },
      {
        problem: 'Bridge keeps disconnecting',
        solutions: [
          'Check network stability',
          'Verify bridge server isn\'t overloaded',
          'Try reconnecting after a minute',
        ],
      },
    ],
  },
  {
    category: 'OTA Updates',
    issues: [
      {
        problem: 'Update fails to install',
        solutions: [
          'Ensure device has stable power during update',
          'Check available flash space',
          'Try updating from the device web UI instead of embedded app',
        ],
      },
      {
        problem: 'Device stuck after update',
        solutions: [
          'Wait 2 minutes for device to complete reboot',
          'If still stuck, re-flash via USB (see Install page)',
          'Use factory reset option in recovery section',
        ],
      },
    ],
  },
];

export default function TroubleshootingPage() {
  return (
    <>
      <Header 
        title="🔧 Troubleshooting" 
        tagline="Diagnose and fix common issues"
        showBrand={false}
      />
      
      <main className="container mx-auto px-4 py-8" id="main-content">
        {/* Quick Diagnostics */}
        <section className="section">
          <h2 className="text-primary mb-4">Quick Diagnostics</h2>
          <p className="mb-6">
            Before diving into specific issues, try these quick checks:
          </p>
          
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <h3 className="text-lg font-semibold mb-3">🔌 Power Check</h3>
              <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
                <li>✓ Is the LED matrix receiving power?</li>
                <li>✓ Is the ESP32 LED blinking or lit?</li>
                <li>✓ Are you using a proper 5V power supply (not USB only)?</li>
              </ul>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold mb-3">📶 Network Check</h3>
              <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
                <li>✓ Can you see the device&apos;s WiFi AP?</li>
                <li>✓ Is your phone/computer on the same network?</li>
                <li>✓ Can you access http://led-matrix.local?</li>
              </ul>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold mb-3">🔗 Bridge Check</h3>
              <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
                <li>✓ Is the bridge server running?</li>
                <li>✓ Does the pairing code match?</li>
                <li>✓ Is the embedded app showing &quot;Connected&quot;?</li>
              </ul>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold mb-3">🌐 Webex Check</h3>
              <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
                <li>✓ Are Webex credentials configured?</li>
                <li>✓ Has the OAuth token expired?</li>
                <li>✓ Is your Webex status actually changing?</li>
              </ul>
            </Card>
          </div>
        </section>

        {/* Common Issues */}
        {commonIssues.map((category) => (
          <section key={category.category} className="section">
            <h2 className="text-primary mb-4">{category.category} Issues</h2>
            
            {category.issues.map((issue) => (
              <div key={issue.problem} className="mb-6">
                <h3 className="text-lg font-semibold mb-3">{issue.problem}</h3>
                <ul className="space-y-2">
                  {issue.solutions.map((solution, idx) => (
                    <li 
                      key={idx}
                      className="pl-4 border-l-2 border-primary text-[var(--color-text-muted)]"
                    >
                      {solution}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}

        {/* Reset Options */}
        <section className="section">
          <h2 className="text-primary mb-4">Reset Options</h2>
          
          <div className="space-y-4">
            <Card>
              <h3 className="text-lg font-semibold mb-2">🔄 Soft Reset (Reboot)</h3>
              <p className="text-sm text-[var(--color-text-muted)] mb-3">
                Press the reset button briefly, or use the reboot option in the web UI. 
                This preserves all settings.
              </p>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold mb-2">📡 WiFi Reset</h3>
              <p className="text-sm text-[var(--color-text-muted)] mb-3">
                Hold the reset button for 5 seconds. The device will restart in AP mode, 
                allowing you to reconfigure WiFi while keeping other settings.
              </p>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold mb-2">🗑️ Factory Reset</h3>
              <p className="text-sm text-[var(--color-text-muted)] mb-3">
                Hold the reset button for 10+ seconds. This erases ALL settings including 
                WiFi, Webex credentials, and device name. Use as last resort.
              </p>
            </Card>
          </div>

          <Alert variant="warning" className="mt-6">
            <AlertTitle>Recovery via USB</AlertTitle>
            <p className="mb-0">
              If your device is completely unresponsive, you can always re-flash the firmware 
              using the <Link href="/install/" className="text-primary hover:underline">Web Installer</Link>. 
              This will restore the device to a working state.
            </p>
          </Alert>
        </section>

        {/* Getting Help */}
        <section className="section">
          <h2 className="text-primary mb-4">Still Need Help?</h2>
          <p className="mb-4">
            If you&apos;ve tried the solutions above and still have issues:
          </p>
          
          <div className="grid md:grid-cols-2 gap-4">
            <Link 
              href="https://github.com/liptonj/Led-Matrix-Webex/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="block p-5 rounded-lg border-2 border-[var(--color-border)] no-underline transition-all hover:border-primary hover:shadow-md"
            >
              <h3 className="text-lg font-semibold mb-2">🐛 Report a Bug</h3>
              <p className="text-sm text-[var(--color-text-muted)] mb-0">
                Open an issue on GitHub with your device logs and steps to reproduce.
              </p>
            </Link>

            <Link 
              href="https://github.com/liptonj/Led-Matrix-Webex/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="block p-5 rounded-lg border-2 border-[var(--color-border)] no-underline transition-all hover:border-primary hover:shadow-md"
            >
              <h3 className="text-lg font-semibold mb-2">💬 Ask the Community</h3>
              <p className="text-sm text-[var(--color-text-muted)] mb-0">
                Post in GitHub Discussions for help from other users.
              </p>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
