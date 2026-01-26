import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer, Breadcrumbs } from '@/components/layout';
import { Alert, AlertTitle, CodeBlock, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Hardware Guide',
  description: 'Complete hardware guide for building an LED Matrix Webex Status Display with ESP32/ESP32-S3',
};

const components = [
  {
    component: 'LED Matrix Panel',
    specification: 'P3 Indoor 64x32 RGB, HUB75 interface',
    notes: 'Must have FM6126A driver chip',
  },
  {
    component: 'Microcontroller',
    specification: 'ESP32-S3-DevKitC-1-N8R2',
    notes: 'ESP32-S3 recommended (ESP32 also supported)',
  },
  {
    component: 'Power Supply',
    specification: '5V DC, 2.5-4A',
    notes: 'Matrix requires dedicated power supply',
  },
  {
    component: 'Wiring',
    specification: 'HUB75 ribbon cable + jumper wires',
    notes: '16-pin 2.54mm pitch IDC connector',
  },
];

const pinMapping = [
  { hub75: 'R1', function: 'Red Upper', gpio: 'GPIO 37', description: 'Red data for upper half of panel' },
  { hub75: 'G1', function: 'Green Upper', gpio: 'GPIO 6', description: 'Green data for upper half' },
  { hub75: 'B1', function: 'Blue Upper', gpio: 'GPIO 36', description: 'Blue data for upper half' },
  { hub75: 'R2', function: 'Red Lower', gpio: 'GPIO 35', description: 'Red data for lower half of panel' },
  { hub75: 'G2', function: 'Green Lower', gpio: 'GPIO 5', description: 'Green data for lower half' },
  { hub75: 'B2', function: 'Blue Lower', gpio: 'GPIO 0', description: 'Blue data for lower half' },
  { hub75: 'A', function: 'Row Select A', gpio: 'GPIO 45', description: 'Row address line A' },
  { hub75: 'B', function: 'Row Select B', gpio: 'GPIO 1', description: 'Row address line B' },
  { hub75: 'C', function: 'Row Select C', gpio: 'GPIO 48', description: 'Row address line C' },
  { hub75: 'D', function: 'Row Select D', gpio: 'GPIO 2', description: 'Row address line D' },
  { hub75: 'E', function: 'Row Select E', gpio: 'GPIO 4', description: 'Row address line E (for 1/32 scan)' },
  { hub75: 'CLK', function: 'Clock', gpio: 'GPIO 47', description: 'Shift register clock' },
  { hub75: 'LAT', function: 'Latch', gpio: 'GPIO 38', description: 'Latch/strobe signal' },
  { hub75: 'OE', function: 'Output Enable', gpio: 'GPIO 21', description: 'Output enable (active low)' },
  { hub75: 'GND', function: 'Ground', gpio: 'GND', description: 'Connect all GND pins' },
];

const troubleshooting = [
  { problem: 'Blank display', cause: 'Power not connected or FM6126A init failed', solution: 'Check 5V supply to matrix. Verify firmware has FM6126A driver enabled' },
  { problem: 'Display flickers', cause: 'Poor ground connection or refresh rate issue', solution: 'Connect all GND pins. Verify clkphase = false in code' },
  { problem: 'Wrong colors', cause: 'Swapped RGB data pins', solution: 'Verify R1/G1/B1/R2/G2/B2 wiring matches pinout table' },
  { problem: 'Garbled image', cause: 'Clock or latch timing issues', solution: 'Check CLK (GPIO 47) and LAT (GPIO 38) connections' },
  { problem: 'Dim display', cause: 'Insufficient power or brightness setting', solution: 'Use 4A power supply. Check brightness setting in web UI' },
];

export default function HardwarePage() {
  return (
    <>
      <Header 
        title="📦 Hardware Guide" 
        tagline="Build your LED Matrix Webex Display"
        showBrand={false}
      />
      
      <main className="container mx-auto px-4 py-8" id="main-content">
        <Breadcrumbs />
        {/* Required Components */}
        <section className="section">
          <h2 className="text-primary mb-4">Required Components</h2>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Component</TableHeader>
                <TableHeader>Specification</TableHeader>
                <TableHeader>Notes</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {components.map((item) => (
                <TableRow key={item.component}>
                  <TableCell>{item.component}</TableCell>
                  <TableCell>{item.specification}</TableCell>
                  <TableCell><strong>{item.notes}</strong></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Alert variant="warning">
            <AlertTitle>Critical: FM6126A Driver Required</AlertTitle>
            <p className="mb-0">
              The firmware is configured specifically for LED matrix panels with the <strong>FM6126A driver chip</strong>. 
              Panels with other drivers (ICN2038S, FM6124, etc.) may display incorrectly or not work at all. 
              Always verify your panel has the FM6126A driver before purchasing.
            </p>
          </Alert>
        </section>

        {/* LED Matrix Specifications */}
        <section className="section">
          <h2 className="text-primary mb-4">LED Matrix Specifications</h2>
          <Card>
            <h3 className="text-lg font-semibold mb-4">P3 Indoor RGB LED Matrix Panel</h3>
            <ul className="space-y-2 list-disc list-inside text-[var(--color-text-muted)]">
              <li><strong>Resolution:</strong> 64x32 pixels (2,048 individual RGB LEDs)</li>
              <li><strong>Physical Size:</strong> 192mm x 96mm (7.6&quot; x 3.8&quot;)</li>
              <li><strong>Pixel Pitch:</strong> 3mm (P3)</li>
              <li><strong>Interface:</strong> HUB75 (16-pin IDC)</li>
              <li><strong>Driver Chip:</strong> FM6126A (REQUIRED)</li>
              <li><strong>Scan Mode:</strong> 1/16 scan</li>
              <li><strong>Power:</strong> 5V DC, ~2.5A at full brightness</li>
              <li><strong>Viewing Angle:</strong> 140&deg; horizontal, 140&deg; vertical</li>
            </ul>
          </Card>
        </section>

        {/* ESP32-S3 Pin Mapping */}
        <section className="section">
          <h2 className="text-primary mb-4">ESP32-S3 Pin Mapping</h2>
          <p className="mb-4">The following pin configuration is used in the firmware (verified from <code>matrix_display.cpp</code>):</p>
          
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>HUB75 Pin</TableHeader>
                <TableHeader>Function</TableHeader>
                <TableHeader>ESP32-S3 GPIO</TableHeader>
                <TableHeader>Description</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {pinMapping.map((pin) => (
                <TableRow key={pin.hub75}>
                  <TableCell>{pin.hub75}</TableCell>
                  <TableCell>{pin.function}</TableCell>
                  <TableCell>{pin.gpio}</TableCell>
                  <TableCell>{pin.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            <strong>Note:</strong> ESP32 (non-S3) uses different GPIO pins. See the <code>matrix_display.cpp</code> file for ESP32 pin mappings.
          </p>
        </section>

        {/* HUB75 Connector Pinout */}
        <section className="section">
          <h2 className="text-primary mb-4">HUB75 Connector Pinout</h2>
          <p className="mb-4">Looking at the matrix from the <strong>back</strong> (connector side), the HUB75 socket is arranged as:</p>
          
          <CodeBlock code={`┌───┬───┬───┬───┬───┬───┬───┬───┐
│R1 │G1 │B1 │GND│R2 │G2 │B2 │GND│  ← Top row (odd pins: 1,3,5,7,9,11,13,15)
├───┼───┼───┼───┼───┼───┼───┼───┤
│ A │ B │ C │ D │CLK│LAT│OE │ E │  ← Bottom row (even pins: 2,4,6,8,10,12,14,16)
└───┴───┴───┴───┴───┴───┴───┴───┘
  1   3   5   7   9  11  13  15
  2   4   6   8  10  12  14  16`} />

          <Alert variant="warning">
            <p className="mb-0"><strong>Warning:</strong> The HUB75 connector is NOT keyed. Double-check pin 1 alignment before connecting power!</p>
          </Alert>
        </section>

        {/* Critical Firmware Configuration */}
        <section className="section">
          <h2 className="text-primary mb-4">Critical Firmware Configuration</h2>
          <p className="mb-4">The firmware uses the following driver settings (from <code>matrix_display.cpp</code>):</p>

          <CodeBlock code={`// Panel driver configuration
mxconfig.driver = HUB75_I2S_CFG::FM6126A;  // REQUIRED for P3 panels
mxconfig.clkphase = false;                 // CRITICAL: Must be false
mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_20M; // 20MHz for stability
mxconfig.min_refresh_rate = 120;           // Reduce visible flicker
mxconfig.latch_blanking = 1;               // Stable latch timing`} />

          <Alert variant="info">
            <AlertTitle>Why these settings matter:</AlertTitle>
            <ul className="space-y-1 mb-0 list-disc list-inside">
              <li><strong>FM6126A driver:</strong> Enables proper initialization sequence for this chip</li>
              <li><strong>clkphase = false:</strong> Critical timing for FM6126A. <code>true</code> causes display corruption</li>
              <li><strong>HZ_20M:</strong> 20MHz I2S speed balances refresh rate and stability</li>
              <li><strong>min_refresh_rate = 120:</strong> Reduces visible flickering</li>
            </ul>
          </Alert>
        </section>

        {/* Power Requirements */}
        <section className="section">
          <h2 className="text-primary mb-4">Power Requirements</h2>
          <Card>
            <h3 className="text-lg font-semibold mb-4">Power Supply Guidelines</h3>
            <ul className="space-y-2 list-disc list-inside text-[var(--color-text-muted)]">
              <li><strong>Minimum:</strong> 5V @ 2.5A (for testing at reduced brightness)</li>
              <li><strong>Recommended:</strong> 5V @ 4A (for full brightness white display)</li>
              <li><strong>Maximum Draw:</strong> ~15-20W at 100% brightness, all LEDs white</li>
              <li><strong>Typical Usage:</strong> ~8-12W with status displays</li>
            </ul>
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
              <strong>Important:</strong> The ESP32 USB port cannot power the matrix. Use a dedicated 5V power supply 
              connected directly to the matrix power input (red/black wires or barrel jack).
            </p>
          </Card>
        </section>

        {/* Troubleshooting */}
        <section className="section">
          <h2 className="text-primary mb-4">Troubleshooting</h2>
          <h3 className="text-lg font-semibold mb-4">🔍 Display Issues</h3>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Problem</TableHeader>
                <TableHeader>Possible Cause</TableHeader>
                <TableHeader>Solution</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {troubleshooting.map((item) => (
                <TableRow key={item.problem}>
                  <TableCell>{item.problem}</TableCell>
                  <TableCell>{item.cause}</TableCell>
                  <TableCell>{item.solution}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        {/* Need More Help */}
        <section className="section">
          <h2 className="text-primary mb-4">Need More Help?</h2>
          <p className="mb-4">Check out the additional documentation:</p>
          <ul className="space-y-2 list-disc list-inside">
            <li><Link href="https://github.com/liptonj/Led-Matrix-Webex/tree/main/docs" target="_blank" rel="noopener">Full Documentation</Link> - Complete setup guides</li>
            <li><Link href="https://github.com/liptonj/Led-Matrix-Webex/issues" target="_blank" rel="noopener">GitHub Issues</Link> - Report bugs or ask questions</li>
            <li><Link href="https://github.com/liptonj/Led-Matrix-Webex/discussions" target="_blank" rel="noopener">Discussions</Link> - Community support</li>
            <li><Link href="/versions/">Download Firmware</Link> - Get the latest release</li>
          </ul>
        </section>
      </main>

      <Footer />
    </>
  );
}
