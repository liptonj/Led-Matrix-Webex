'use client';

import { useState, useEffect, useCallback } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { Button, Alert } from '@/components/ui';
import { useSerial } from '@/hooks/useSerial';
import { EspWebInstallButton } from './EspWebInstallButton';

type WizardStep = 1 | 2 | 3;

export function InstallWizard() {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [flashStatus, setFlashStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [wifiStatus, setWifiStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [flashComplete, setFlashComplete] = useState(false);
  const [availableNetworks, setAvailableNetworks] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [useManualEntry, setUseManualEntry] = useState(false);

  const {
    status: serialStatus,
    isConnected,
    isSupported,
    error: serialError,
    output: serialOutput,
    connect,
    writeLine,
    clearOutput,
  } = useSerial();

  useEffect(() => {
    if (serialError) {
      setWifiStatus({ message: serialError, type: 'error' });
    }
  }, [serialError]);

  const parseNetworksFromOutput = (output: string[]): string[] => {
    const networks: string[] = [];
    const seenNetworks = new Set<string>();
    
    // Look for lines that contain SSID information
    // Format expected: "SSID: NetworkName" or "WIFI_SCAN: NetworkName"
    for (const line of output) {
      const ssidMatch = line.match(/(?:SSID|WIFI_SCAN):\s*(.+?)(?:\s|$)/i);
      if (ssidMatch && ssidMatch[1]) {
        const network = ssidMatch[1].trim();
        if (network && !seenNetworks.has(network)) {
          seenNetworks.add(network);
          networks.push(network);
        }
      }
    }
    
    return networks;
  };

  const scanWifiNetworks = useCallback(async () => {
    if (!isSupported || isScanning) return;
    
    setIsScanning(true);
    setWifiStatus({ message: 'Scanning for WiFi networks...', type: 'info' });
    
    // Connect if not already connected
    const connected = isConnected || await connect();
    if (!connected) {
      setWifiStatus({ message: 'Failed to connect. You can enter WiFi manually below.', type: 'error' });
      setIsScanning(false);
      setUseManualEntry(true);
      return;
    }
    
    // Send WiFi scan command
    const sent = await writeLine('SCAN_WIFI');
    if (!sent) {
      setWifiStatus({ message: 'Failed to start scan. You can enter WiFi manually below.', type: 'error' });
      setIsScanning(false);
      setUseManualEntry(true);
      return;
    }
    
    // Wait for scan results (device will output them to serial)
    // Parse from serial output in the next few seconds
    setTimeout(() => {
      // Parse networks from serial output
      const networks = parseNetworksFromOutput(serialOutput);
      if (networks.length > 0) {
        setAvailableNetworks(networks);
        setWifiStatus({ message: `Found ${networks.length} network(s)`, type: 'success' });
      } else {
        setWifiStatus({ message: 'No networks found. You can enter WiFi manually below.', type: 'info' });
        setUseManualEntry(true);
      }
      setIsScanning(false);
    }, 5000);
  }, [isSupported, isScanning, isConnected, connect, writeLine, serialOutput]);

  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
    
    // Auto-start WiFi scan when entering step 2
    if (step === 2) {
      scanWifiNetworks();
    }
  }, [scanWifiNetworks]);

  // Listen for ESP Web Tools flash complete event
  useEffect(() => {
    const handleFlashComplete = () => {
      setFlashComplete(true);
      setFlashStatus({ message: 'Firmware flashed successfully!', type: 'success' });
      // Auto-advance to WiFi step after 2 seconds
      setTimeout(() => {
        goToStep(2);
      }, 2000);
    };

    window.addEventListener('esp-web-install-complete', handleFlashComplete);
    return () => window.removeEventListener('esp-web-install-complete', handleFlashComplete);
  }, [goToStep]);

  const handleSendWifi = async () => {
    const trimmedSsid = ssid.trim();
    if (!trimmedSsid) {
      setWifiStatus({ message: 'Please enter a WiFi network name (SSID).', type: 'error' });
      return;
    }

    setIsSending(true);
    setWifiStatus({
      message: isConnected ? 'Sending WiFi credentials...' : 'Connecting to device...',
      type: 'info',
    });

    const connected = isConnected || await connect();
    if (!connected) {
      setWifiStatus({ message: 'Failed to connect to the device. Please try again.', type: 'error' });
      setIsSending(false);
      return;
    }

    const command = `WIFI:${trimmedSsid}:${password}`;
    const sent = await writeLine(command);

    if (!sent) {
      setWifiStatus({ message: 'Failed to send WiFi credentials.', type: 'error' });
      setIsSending(false);
      return;
    }

    setWifiStatus({
      message: `WiFi credentials sent. The device should connect to "${trimmedSsid}".`,
      type: 'success',
    });
    setIsSending(false);
    
    // Auto-advance to complete after successful WiFi config
    setTimeout(() => {
      goToStep(3);
    }, 2000);
  };

  return (
    <>
      {/* Load ESP Web Tools */}
      <Script 
        src="https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module"
        type="module"
        strategy="lazyOnload"
      />

      <div className="max-w-3xl mx-auto">
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
          <p className="text-[var(--color-text-muted)] mb-6">Connect your ESP32 via USB and click Install to begin.</p>
          
          {/* Browser Support */}
          <div className="flex gap-2 justify-center mb-6 flex-wrap">
            <span className="px-3 py-1.5 rounded-md text-sm bg-green-100 text-green-700">✓ Chrome</span>
            <span className="px-3 py-1.5 rounded-md text-sm bg-green-100 text-green-700">✓ Edge</span>
            <span className="px-3 py-1.5 rounded-md text-sm bg-red-100 text-red-700">✗ Firefox</span>
            <span className="px-3 py-1.5 rounded-md text-sm bg-red-100 text-red-700">✗ Safari</span>
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
            <EspWebInstallButton manifest="/updates/manifest-firmware-esp32s3.json">
              <button 
                slot="activate"
                className="bg-success text-white px-8 py-3.5 text-lg font-semibold border-none rounded-lg cursor-pointer transition-colors hover:brightness-90"
                onClick={() => setShowConsole(true)}
              >
                Install Firmware
              </button>
              <span slot="unsupported" className="text-red-600">Your browser doesn&apos;t support Web Serial. Use Chrome or Edge.</span>
              <span slot="not-allowed" className="text-yellow-600">Serial access denied. Please allow access and try again.</span>
            </EspWebInstallButton>
          </div>

          {/* Console Output Toggle */}
          {showConsole && (
            <div className="mt-6 border border-[var(--color-border)] rounded-lg overflow-hidden text-left">
              <div className="flex justify-between items-center px-4 py-2 bg-[var(--color-code-bg)] text-[var(--color-code-text)] text-sm">
                <span>Installation Console</span>
                <button 
                  onClick={clearOutput}
                  className="px-3 py-1 bg-[var(--color-surface-alt)] border-none rounded text-xs cursor-pointer hover:brightness-90"
                >
                  Clear
                </button>
              </div>
              <div className="h-64 overflow-y-auto bg-[var(--color-code-bg)] text-green-400 font-mono text-xs p-3 whitespace-pre-wrap">
                {(serialOutput.length > 0 ? serialOutput : ['Waiting for device output...']).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}

          {/* Requirements */}
          <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 my-4 text-left">
            <h4 className="text-yellow-700 font-medium mb-2">Requirements</h4>
            <ul className="list-disc list-inside text-yellow-700 text-sm">
              <li>USB data cable (not charge-only)</li>
              <li>ESP32 may need BOOT button held during flash</li>
            </ul>
          </div>

          {flashStatus && (
            <Alert variant={flashStatus.type === 'error' ? 'danger' : flashStatus.type === 'success' ? 'success' : 'info'}>
              {flashStatus.message}
            </Alert>
          )}

          {flashComplete && (
            <div className="flex justify-end mt-8 pt-6 border-t border-[var(--color-border)]">
              <Button variant="success" onClick={() => goToStep(2)}>
                Continue to WiFi Setup →
              </Button>
            </div>
          )}
        </div>

        {/* Step 2: Configure WiFi */}
        <div className={`card text-center animate-fade-in ${currentStep === 2 ? 'block' : 'hidden'}`}>
          <h2 className="text-xl font-semibold mb-4">Configure WiFi</h2>
          <p className="text-[var(--color-text-muted)] mb-6">
            {isSupported 
              ? 'Send WiFi credentials directly to your device - no reconnection needed!'
              : 'Your browser doesn\'t support Web Serial.'}
          </p>

          {isSupported ? (
            <>
              <div className="max-w-md mx-auto text-left">
                {/* WiFi Network Selection */}
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block font-medium">Network Name (SSID)</label>
                    {availableNetworks.length > 0 && !useManualEntry && (
                      <button
                        type="button"
                        onClick={() => setUseManualEntry(true)}
                        className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none"
                      >
                        Enter manually
                      </button>
                    )}
                    {useManualEntry && (
                      <button
                        type="button"
                        onClick={() => {
                          setUseManualEntry(false);
                          setSsid('');
                        }}
                        className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none"
                      >
                        Select from list
                      </button>
                    )}
                  </div>
                  
                  {isScanning ? (
                    <div className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] text-center">
                      🔍 Scanning for networks...
                    </div>
                  ) : !useManualEntry && availableNetworks.length > 0 ? (
                    <select
                      value={ssid}
                      onChange={(event) => setSsid(event.target.value)}
                      className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] cursor-pointer"
                    >
                      <option value="">Select a network...</option>
                      {availableNetworks.map((network) => (
                        <option key={network} value={network}>
                          📶 {network}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input 
                      type="text" 
                      placeholder="Enter your WiFi network name"
                      value={ssid}
                      onChange={(event) => setSsid(event.target.value)}
                      className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                    />
                  )}
                  
                  {!isScanning && availableNetworks.length === 0 && !useManualEntry && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={scanWifiNetworks}
                        className="text-sm text-primary hover:underline cursor-pointer bg-transparent border-none flex items-center gap-1"
                      >
                        🔄 Scan again
                      </button>
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <label className="block mb-2 font-medium">WiFi Password</label>
                  <input 
                    type="password" 
                    placeholder="Enter your WiFi password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                  />
                </div>
                <Button variant="primary" block onClick={handleSendWifi} disabled={isSending}>
                  {isSending ? 'Sending...' : isConnected ? 'Send WiFi Configuration' : 'Connect & Send WiFi'}
                </Button>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                  Serial status: {serialStatus === 'connected' ? '✓ Connected' : serialStatus}
                </p>
              </div>

              {wifiStatus && (
                <Alert variant={wifiStatus.type === 'error' ? 'danger' : wifiStatus.type === 'success' ? 'success' : 'info'} className="mt-4">
                  {wifiStatus.message}
                </Alert>
              )}

              {/* Serial Console */}
              <div className="mt-6 border border-[var(--color-border)] rounded-lg overflow-hidden text-left">
                <div className="flex justify-between items-center px-4 py-2 bg-[var(--color-code-bg)] text-[var(--color-code-text)] text-sm">
                  <span>Device Console</span>
                  <button 
                    onClick={clearOutput}
                    className="px-3 py-1 bg-[var(--color-surface-alt)] border-none rounded text-xs cursor-pointer hover:brightness-90"
                  >
                    Clear
                  </button>
                </div>
                <div className="h-40 overflow-y-auto bg-[var(--color-code-bg)] text-green-400 font-mono text-xs p-3 whitespace-pre-wrap">
                  {(serialOutput.length > 0 ? serialOutput : ['No serial output yet.']).map((line, i) => (
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
            The device will connect to your WiFi network and display your Webex status.
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
                <EspWebInstallButton manifest="/updates/manifest-firmware-esp32s3.json">
                  <button 
                    slot="activate"
                    className="bg-success text-white px-6 py-2.5 font-medium border-none rounded-lg cursor-pointer"
                  >
                    Flash Firmware (ESP32-S3)
                  </button>
                </EspWebInstallButton>
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
