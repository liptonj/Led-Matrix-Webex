import type { Metadata } from 'next';
import { Header, Footer } from '@/components/layout';
import { VersionList } from './VersionList';

export const metadata: Metadata = {
  title: 'Firmware Downloads',
  description: 'Download the latest LED Matrix Webex Display firmware releases',
};

export default function VersionsPage() {
  return (
    <>
      <Header 
        title="⬇️ Firmware Downloads" 
        tagline="Get the latest firmware releases"
        showBrand={false}
      />
      
      <main className="container mx-auto px-4 py-8" id="main-content">
        {/* Latest Release */}
        <section className="section">
          <h2 className="text-primary mb-4">Latest Release</h2>
          <p className="mb-4">
            Download the latest stable firmware for your LED Matrix Webex Display. 
            The firmware list is automatically updated from GitHub releases.
          </p>
          <VersionList />
        </section>

        {/* Installation Instructions */}
        <section className="section">
          <h2 className="text-primary mb-4">Installation Instructions</h2>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">First Time Setup (Bootstrap Firmware)</h3>
          <ol className="list-decimal list-inside space-y-2 text-[var(--color-text-muted)]">
            <li>Download the appropriate bootstrap firmware for your device (ESP32 or ESP32-S3)</li>
            <li>Flash using esptool or PlatformIO (see <a href="/hardware/" className="text-primary hover:underline">Hardware Guide</a>)</li>
            <li>Connect to the &quot;LED-Matrix-Setup&quot; WiFi network</li>
            <li>Follow the web-based setup wizard</li>
          </ol>

          <h3 className="text-lg font-semibold mt-6 mb-3">OTA Updates (After Initial Setup)</h3>
          <ol className="list-decimal list-inside space-y-2 text-[var(--color-text-muted)]">
            <li>Download the OTA firmware file for your device</li>
            <li>Go to your device&apos;s web interface (usually http://led-matrix.local)</li>
            <li>Navigate to Settings → Firmware Update</li>
            <li>Upload the OTA firmware file</li>
            <li>Wait for the update to complete and device to restart</li>
          </ol>
        </section>

        {/* File Descriptions */}
        <section className="section">
          <h2 className="text-primary mb-4">File Descriptions</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="p-3 text-left border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] font-semibold text-sm">File Type</th>
                  <th className="p-3 text-left border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] font-semibold text-sm">Description</th>
                  <th className="p-3 text-left border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] font-semibold text-sm">Use Case</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">bootstrap-*.bin</td>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">Bootstrap firmware (full flash image)</td>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">Initial setup via USB/serial</td>
                </tr>
                <tr>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">firmware-*.bin</td>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">Main firmware (full flash image)</td>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">Initial setup via USB/serial</td>
                </tr>
                <tr>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">*-ota-*.bin</td>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">OTA update package</td>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">Over-the-air updates via web interface</td>
                </tr>
                <tr>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">*.zip</td>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">Complete release package</td>
                  <td className="p-3 border-b border-[var(--color-border)] text-sm">All binaries and documentation</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Automatic Updates */}
        <section className="section">
          <h2 className="text-primary mb-4">Automatic Updates</h2>
          <p className="mb-4">
            Your LED Matrix Display can automatically check for new firmware versions. 
            Enable this in Settings → Firmware Update → Auto-check for updates.
          </p>
          <p className="text-[var(--color-text-muted)]">
            The device will notify you when a new version is available, but will not install automatically without your confirmation.
          </p>
        </section>
      </main>

      <Footer />
    </>
  );
}
