import type { Metadata } from 'next';
import { Header, Footer } from '@/components/layout';
import { CodeBlock } from '@/components/ui';

export const metadata: Metadata = {
  title: 'API Documentation',
  description: 'API documentation for integrating with the LED Matrix Webex Display',
};

export default function ApiDocsPage() {
  return (
    <>
      <Header 
        title="📚 API Documentation" 
        tagline="Integrate with the LED Matrix Display"
        showBrand={false}
      />
      
      <main className="container mx-auto px-4 py-8" id="main-content">
        {/* Device Web API */}
        <section className="section">
          <h2 className="text-primary mb-4">Device Web API</h2>
          <p className="mb-4">
            The LED Matrix Display exposes a local web API for configuration and status monitoring. 
            All endpoints are accessible at <code>http://&lt;device-ip&gt;/api/</code> or <code>http://led-matrix.local/api/</code>
          </p>
        </section>

        {/* GET /api/status */}
        <section className="section">
          <h3 className="text-lg font-semibold mb-4">GET /api/status</h3>
          <p className="mb-4">Get current device status including presence, WiFi, and system information.</p>
          <CodeBlock code="curl http://led-matrix.local/api/status" />
          <p className="font-medium mt-4 mb-2">Response:</p>
          <CodeBlock code={`{
  "presence": "active",
  "wifi": {
    "ssid": "MyNetwork",
    "rssi": -45,
    "ip": "192.168.1.100"
  },
  "system": {
    "version": "1.0.5",
    "uptime": 3600,
    "free_heap": 123456
  }
}`} />
        </section>

        {/* POST /api/presence */}
        <section className="section">
          <h3 className="text-lg font-semibold mb-4">POST /api/presence</h3>
          <p className="mb-4">Manually set presence status (overrides Webex for 5 minutes).</p>
          <CodeBlock code={`curl -X POST http://led-matrix.local/api/presence \\
  -H "Content-Type: application/json" \\
  -d '{"status": "meeting"}'`} />
          <p className="mt-4 text-[var(--color-text-muted)]">
            <strong>Valid status values:</strong> active, meeting, dnd, away, inactive
          </p>
        </section>

        {/* GET /api/config */}
        <section className="section">
          <h3 className="text-lg font-semibold mb-4">GET /api/config</h3>
          <p className="mb-4">Get device configuration (non-sensitive fields only).</p>
          <CodeBlock code="curl http://led-matrix.local/api/config" />
        </section>

        {/* POST /api/config */}
        <section className="section">
          <h3 className="text-lg font-semibold mb-4">POST /api/config</h3>
          <p className="mb-4">Update device configuration.</p>
          <CodeBlock code={`curl -X POST http://led-matrix.local/api/config \\
  -H "Content-Type: application/json" \\
  -d '{"brightness": 50, "mode": "webex"}'`} />
        </section>

        {/* POST /api/restart */}
        <section className="section">
          <h3 className="text-lg font-semibold mb-4">POST /api/restart</h3>
          <p className="mb-4">Restart the device.</p>
          <CodeBlock code="curl -X POST http://led-matrix.local/api/restart" />
        </section>

        {/* Bridge Server API */}
        <section className="section">
          <h2 className="text-primary mb-4">Bridge Server API</h2>
          <p className="mb-4">
            When using the optional Node.js bridge server, it exposes WebSocket and REST APIs for managing multiple displays.
          </p>

          <h3 className="text-lg font-semibold mt-6 mb-4">WebSocket Connection</h3>
          <p className="mb-4">Displays connect to <code>ws://&lt;bridge-server&gt;:8080</code> for real-time presence updates.</p>
          <CodeBlock code={`// Device registration
{
  "type": "register",
  "deviceId": "led-matrix-001",
  "userId": "user@example.com"
}

// Presence update from server
{
  "type": "presence",
  "status": "active",
  "timestamp": 1234567890
}`} />
        </section>

        {/* Bridge REST API */}
        <section className="section">
          <h3 className="text-lg font-semibold mb-4">Bridge REST API</h3>
          <p className="mb-4">Management API for the bridge server.</p>

          <h4 className="font-medium mt-4 mb-2">GET /api/devices</h4>
          <p className="text-[var(--color-text-muted)] mb-4">List all registered devices.</p>

          <h4 className="font-medium mt-4 mb-2">GET /api/devices/:id</h4>
          <p className="text-[var(--color-text-muted)] mb-4">Get specific device status.</p>

          <h4 className="font-medium mt-4 mb-2">POST /api/devices/:id/presence</h4>
          <p className="text-[var(--color-text-muted)]">Set presence for a specific device.</p>
        </section>

        {/* Home Assistant Integration */}
        <section className="section">
          <h2 className="text-primary mb-4">Home Assistant Integration</h2>
          <p className="mb-4">The Home Assistant add-on provides entity integration:</p>
          <ul className="space-y-2 list-disc list-inside text-[var(--color-text-muted)]">
            <li><code>sensor.led_matrix_presence</code> - Current presence status</li>
            <li><code>sensor.led_matrix_uptime</code> - Device uptime</li>
            <li><code>button.led_matrix_restart</code> - Restart device</li>
            <li><code>number.led_matrix_brightness</code> - Adjust brightness</li>
          </ul>
        </section>

        {/* mDNS Discovery */}
        <section className="section">
          <h2 className="text-primary mb-4">mDNS Discovery</h2>
          <p className="mb-4">
            Devices advertise themselves via mDNS as <code>_ledmatrix._tcp.local</code> with the following properties:
          </p>
          <ul className="space-y-2 list-disc list-inside text-[var(--color-text-muted)]">
            <li><code>version</code> - Firmware version</li>
            <li><code>mode</code> - Operation mode (webex/bridge/meraki)</li>
            <li><code>chip</code> - ESP32 or ESP32-S3</li>
          </ul>
        </section>

        {/* Firmware Version API */}
        <section className="section">
          <h2 className="text-primary mb-4">Firmware Version API</h2>
          <p className="mb-4">Check for firmware updates programmatically:</p>
          <h3 className="text-lg font-semibold mb-4">GET /updates/manifest.json</h3>
          <p className="mb-4">Returns list of available firmware versions.</p>
          <CodeBlock code="curl https://display.5ls.us/updates/manifest.json" />
        </section>
      </main>

      <Footer />
    </>
  );
}
