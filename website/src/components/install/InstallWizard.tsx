'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { Button, Alert, AlertTitle } from '@/components/ui';
import { isWebSerialSupported } from '@/lib/utils';

type WizardStep = 1 | 2 | 3;

export function InstallWizard() {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [flashStatus, setFlashStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [wifiStatus, setWifiStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [serialSupported, setSerialSupported] = useState(true);
  const [consoleOutput, setConsoleOutput] = useState<string[]>(['Initializing...']);
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    setSerialSupported(isWebSerialSupported());
  }, []);

  const goToStep = (step: WizardStep) => {
    setCurrentStep(step);
  };

  const addConsoleLog = (message: string) => {
    setConsoleOutput(prev => [...prev.slice(-29), message]);
  };

  const clearConsole = () => {
    setConsoleOutput([]);
  };

  return (
    <>
      {/* Load ESP Web Tools */}
      <Script 
        src="https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module"
        type="module"
        strategy="lazyOnload"
      />

      <div className="max-w-2xl mx-auto">
        {/* Progress Steps */}
        <div className="flex justify-center mb-8 gap-0">
          {[1, 2, 3].map((step, index) => (
            <div key={step} className="flex items-center">
              <div className="relative flex flex-col items-center">
                <div 
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-base z-10 transition-all ${
                    currentStep === step 
                      ? 'bg-success text-white' 
                      : currentStep > step 
                        ? 'bg-success text-white'
                        : 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {currentStep > step ? '✓' : step}
                </div>
                <span className={`absolute top-12 text-xs whitespace-nowrap ${
                  currentStep >= step ? 'text-[var(--color-text)] font-medium' : 'text-[var(--color-text-muted)]'
                }`}>
                  {step === 1 ? 'Flash Device' : step === 2 ? 'Configure WiFi' : 'Complete'}
                </span>
              </div>
              {index < 2 && (
                <div className={`w-20 h-0.5 transition-colors ${
                  currentStep > step ? 'bg-success' : 'bg-[var(--color-border)]'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Flash Device */}
        <div className={`card text-center animate-fade-in ${currentStep === 1 ? 'block' : 'hidden'}`}>
          <h2 className="text-xl font-semibold mb-4">Flash Your Device</h2>
          <p className="text-[var(--color-text-muted)] mb-6">Connect your ESP32 via USB and select your board type below.</p>
          
          {/* Browser Support */}
          <div className="flex gap-2 justify-center mb-6 flex-wrap">
            <span className="px-3 py-1.5 rounded-md text-sm bg-success/20 text-success">✓ Chrome</span>
            <span className="px-3 py-1.5 rounded-md text-sm bg-success/20 text-success">✓ Edge</span>
            <span className="px-3 py-1.5 rounded-md text-sm bg-danger/20 text-danger">✗ Firefox</span>
            <span className="px-3 py-1.5 rounded-md text-sm bg-danger/20 text-danger">✗ Safari</span>
          </div>

          {/* Device Card */}
          <div className="flex justify-center my-6">
            <div className="bg-[var(--color-surface-alt)] border-2 border-success rounded-xl p-6 max-w-xs text-center">
              <h3 className="mb-2 text-lg font-semibold">ESP32-S3</h3>
              <p className="text-sm text-[var(--color-text-muted)] mb-0">8MB Flash required</p>
              <span className="inline-block bg-[var(--color-border)] px-3 py-1 rounded-full text-xs mt-3">Recommended</span>
            </div>
          </div>

          {/* ESP Install Button */}
          <div className="my-6">
            <esp-web-install-button manifest="/updates/manifest-firmware-esp32s3.json">
              <button 
                slot="activate"
                className="bg-success text-white px-8 py-3.5 text-lg font-semibold border-none rounded-lg cursor-pointer transition-colors hover:brightness-90"
              >
                Install Firmware
              </button>
              <span slot="unsupported" className="text-danger">Your browser doesn&apos;t support Web Serial. Use Chrome or Edge.</span>
              <span slot="not-allowed" className="text-warning">Serial access denied. Please allow access and try again.</span>
            </esp-web-install-button>
          </div>

          {/* Requirements */}
          <div className="bg-warning/10 border border-warning rounded-lg p-4 my-4 text-left">
            <h4 className="text-warning font-medium mb-2">Requirements</h4>
            <ul className="list-disc list-inside text-warning text-sm">
              <li>USB data cable (not charge-only)</li>
              <li>ESP32 may need BOOT button held during flash</li>
            </ul>
          </div>

          {flashStatus && (
            <Alert variant={flashStatus.type === 'error' ? 'danger' : flashStatus.type === 'success' ? 'success' : 'info'}>
              {flashStatus.message}
            </Alert>
          )}

          <div className="flex justify-end mt-8 pt-6 border-t border-[var(--color-border)]">
            <Button variant="success" onClick={() => goToStep(2)}>
              Continue to WiFi Setup →
            </Button>
          </div>
        </div>

        {/* Step 2: Configure WiFi */}
        <div className={`card text-center animate-fade-in ${currentStep === 2 ? 'block' : 'hidden'}`}>
          <h2 className="text-xl font-semibold mb-4">Configure WiFi</h2>
          <p className="text-[var(--color-text-muted)] mb-6">
            {serialSupported 
              ? 'Send WiFi credentials to your device via USB serial connection.'
              : 'Your browser doesn\'t support Web Serial.'}
          </p>

          {serialSupported ? (
            <>
              <div className="max-w-md mx-auto text-left">
                <div className="mb-4">
                  <label className="block mb-2 font-medium">Network Name (SSID)</label>
                  <input 
                    type="text" 
                    placeholder="Enter your WiFi network name"
                    className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                  />
                </div>
                <div className="mb-4">
                  <label className="block mb-2 font-medium">WiFi Password</label>
                  <input 
                    type="password" 
                    placeholder="Enter your WiFi password"
                    className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                  />
                </div>
                <Button variant="primary" block>
                  Send WiFi Configuration
                </Button>
              </div>

              {wifiStatus && (
                <Alert variant={wifiStatus.type === 'error' ? 'danger' : wifiStatus.type === 'success' ? 'success' : 'info'} className="mt-4">
                  {wifiStatus.message}
                </Alert>
              )}

              {/* Serial Console */}
              <div className="mt-6 border border-[var(--color-border)] rounded-lg overflow-hidden text-left">
                <div className="flex justify-between items-center px-4 py-2 bg-gray-800 text-white text-sm">
                  <span>Device Console</span>
                  <button 
                    onClick={clearConsole}
                    className="px-3 py-1 bg-gray-600 text-white border-none rounded text-xs cursor-pointer hover:bg-gray-500"
                  >
                    Clear
                  </button>
                </div>
                <div className="h-40 overflow-y-auto bg-[#1a1a1a] text-green-400 font-mono text-xs p-3 whitespace-pre-wrap">
                  {consoleOutput.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <Alert variant="danger">
              <strong>Web Serial not supported</strong><br />
              Your browser doesn&apos;t support Web Serial. Use Chrome or Edge, 
              or configure WiFi by connecting to the device&apos;s &quot;Webex-Display-XXXX&quot; WiFi network.
            </Alert>
          )}

          <div className="flex justify-between mt-8 pt-6 border-t border-[var(--color-border)]">
            <Button onClick={() => goToStep(1)}>← Back</Button>
            <Button variant="success" onClick={() => goToStep(3)}>
              Finish Setup →
            </Button>
          </div>
        </div>

        {/* Step 3: Complete */}
        <div className={`card text-center animate-fade-in ${currentStep === 3 ? 'block' : 'hidden'}`}>
          <div className="text-6xl mb-4">🎉</div>
          <div className="text-2xl font-semibold text-success mb-4">Setup Complete!</div>
          <p className="text-[var(--color-text-muted)] mb-6">Your LED Matrix Display is now connected and ready to use!</p>

          <Alert variant="success" className="my-6">
            <strong>What happens next:</strong><br />
            The device will connect to your WiFi network and display will show your Webex status.
            Future firmware updates will be installed automatically over WiFi.
          </Alert>

          <p className="mt-8">
            Your display will show a pairing code.<br />
            Use the <Link href="/embedded/" className="text-primary hover:underline">Webex Embedded App</Link> to connect.
          </p>

          <div className="flex justify-center mt-8 pt-6 border-t border-[var(--color-border)]">
            <Link href="/">
              <Button variant="success">Return to Home</Button>
            </Link>
          </div>
        </div>

        {/* Recovery Section Toggle */}
        <div className="text-center my-8">
          <button 
            onClick={() => setShowRecovery(!showRecovery)}
            className="bg-transparent border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] px-6 py-3 rounded-lg cursor-pointer transition-colors hover:border-primary hover:text-primary"
          >
            🔧 Having trouble? Need to recover a device?
          </button>
        </div>

        {/* Recovery Section */}
        {showRecovery && (
          <div className="card animate-fade-in">
            <h2 className="text-xl font-semibold mb-2">Device Recovery</h2>
            <p className="text-[var(--color-text-muted)] mb-6">
              Use these options if your device is stuck, OTA update failed, or you need to start fresh.
            </p>

            <div className="grid gap-6">
              {/* Re-flash Firmware */}
              <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-2">🔄 Re-flash Firmware</h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">
                  Use this if the device is unresponsive or stuck in a boot loop. This will reset the device to factory state.
                </p>
                <esp-web-install-button manifest="/updates/manifest-firmware-esp32s3.json">
                  <button 
                    slot="activate"
                    className="bg-success text-white px-6 py-2.5 font-medium border-none rounded-lg cursor-pointer"
                  >
                    Flash Firmware (ESP32-S3)
                  </button>
                </esp-web-install-button>
              </div>

              {/* Factory Reset */}
              <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-2">🗑️ Factory Reset via Serial</h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">
                  Send a factory reset command to clear all saved settings (WiFi, Webex credentials, etc.).
                </p>
                <Button variant="danger">Send Factory Reset Command</Button>
              </div>
            </div>

            {/* Recovery Help */}
            <div className="mt-6 p-4 bg-[var(--color-surface-alt)] rounded-lg">
              <h4 className="font-medium mb-3">Common Recovery Scenarios:</h4>
              <ul className="list-disc list-inside space-y-2 text-sm text-[var(--color-text-muted)]">
                <li><strong>Device won&apos;t boot / stuck on logo:</strong> Re-flash the firmware</li>
                <li><strong>WiFi won&apos;t connect / wrong network:</strong> Re-flash firmware or use Factory Reset</li>
                <li><strong>Want to start completely fresh:</strong> Re-flash firmware (erases everything)</li>
              </ul>
            </div>
          </div>
        )}

        {/* Help Link */}
        <div className="text-center mt-8">
          <p className="text-[var(--color-text-muted)]">
            Need help? Check the <Link href="/hardware/" className="text-primary hover:underline">Hardware Guide</Link> or{' '}
            <Link href="https://github.com/liptonj/Led-Matrix-Webex/issues" target="_blank" rel="noopener" className="text-primary hover:underline">GitHub Issues</Link>
          </p>
        </div>
      </div>
    </>
  );
}
