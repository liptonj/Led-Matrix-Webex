'use client';

import { useState, useEffect, useCallback } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { Button, Alert } from '@/components/ui';
import { useSerial } from '@/hooks/useSerial';
import { EspWebInstallButton } from './EspWebInstallButton';

type WizardStep = 1 | 2 | 3;
type InstallType = 'fresh' | 'update';

const MANIFEST_FRESH = '/updates/manifest-firmware-esp32s3.json';
const MANIFEST_UPDATE = '/updates/manifest-firmware-update.json';

export function InstallWizard() {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [installType, setInstallType] = useState<InstallType>('fresh');
  const [flashStatus, setFlashStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [wifiStatus, setWifiStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    
    const connected = isConnected || await connect();
    if (!connected) {
      setWifiStatus({ message: 'Could not connect to device. Enter WiFi manually.', type: 'info' });
      setIsScanning(false);
      setUseManualEntry(true);
      return;
    }
    
    const sent = await writeLine('SCAN_WIFI');
    if (!sent) {
      setWifiStatus({ message: 'Scan failed. Enter WiFi manually.', type: 'info' });
      setIsScanning(false);
      setUseManualEntry(true);
      return;
    }
    
    setTimeout(() => {
      const networks = parseNetworksFromOutput(serialOutput);
      if (networks.length > 0) {
        setAvailableNetworks(networks);
        setWifiStatus({ message: `Found ${networks.length} network(s)`, type: 'success' });
      } else {
        setWifiStatus(null);
        setUseManualEntry(true);
      }
      setIsScanning(false);
    }, 5000);
  }, [isSupported, isScanning, isConnected, connect, writeLine, serialOutput]);

  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
    if (step === 2) {
      scanWifiNetworks();
    }
  }, [scanWifiNetworks]);

  const handleFlashComplete = useCallback(() => {
    setFlashComplete(true);
    setFlashStatus({ message: 'Firmware installed successfully!', type: 'success' });
    setTimeout(() => goToStep(2), 2000);
  }, [goToStep]);

  const handleFlashError = useCallback((error: string) => {
    setFlashStatus({ message: `Installation failed: ${error}`, type: 'error' });
  }, []);

  useEffect(() => {
    const onComplete = () => handleFlashComplete();
    window.addEventListener('esp-web-install-complete', onComplete);
    return () => window.removeEventListener('esp-web-install-complete', onComplete);
  }, [handleFlashComplete]);

  const handleSendWifi = async () => {
    const trimmedSsid = ssid.trim();
    if (!trimmedSsid) {
      setWifiStatus({ message: 'Please enter a WiFi network name.', type: 'error' });
      return;
    }

    setIsSending(true);
    setWifiStatus({ message: 'Sending credentials...', type: 'info' });

    const connected = isConnected || await connect();
    if (!connected) {
      setWifiStatus({ message: 'Failed to connect to device.', type: 'error' });
      setIsSending(false);
      return;
    }

    const command = `WIFI:${trimmedSsid}:${password}`;
    const sent = await writeLine(command);

    if (!sent) {
      setWifiStatus({ message: 'Failed to send credentials.', type: 'error' });
      setIsSending(false);
      return;
    }

    setWifiStatus({ message: 'WiFi configured! Device will connect shortly.', type: 'success' });
    setIsSending(false);
    setTimeout(() => goToStep(3), 2000);
  };

  const stepLabels = ['Install', 'WiFi', 'Done'];

  return (
    <>
      <Script 
        src="https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module"
        type="module"
        strategy="lazyOnload"
      />

      <div className="max-w-2xl mx-auto">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {stepLabels.map((label, index) => (
              <span 
                key={label}
                className={`text-sm font-medium ${
                  currentStep > index + 1 ? 'text-success' : 
                  currentStep === index + 1 ? 'text-[var(--color-text)]' : 
                  'text-[var(--color-text-muted)]'
                }`}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
            <div 
              className="h-full bg-success transition-all duration-500 ease-out"
              style={{ width: `${((currentStep - 1) / 2) * 100}%` }}
            />
          </div>
        </div>

        {/* Step 1: Install Firmware */}
        {currentStep === 1 && (
          <div className="card animate-fade-in">
            <h2 className="text-2xl font-semibold mb-2">Install Firmware</h2>
            <p className="text-[var(--color-text-muted)] mb-6">
              Connect your ESP32-S3 via USB and choose an installation option.
            </p>

            {/* Install Type Selection */}
            <div className="grid gap-3 mb-6">
              <label 
                className={`flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  installType === 'fresh' 
                    ? 'border-success bg-success/5' 
                    : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                }`}
              >
                <input
                  type="radio"
                  name="installType"
                  value="fresh"
                  checked={installType === 'fresh'}
                  onChange={() => setInstallType('fresh')}
                  className="mt-1 accent-success"
                />
                <div className="flex-1">
                  <div className="font-semibold">New Installation</div>
                  <div className="text-sm text-[var(--color-text-muted)]">
                    For new devices. Installs complete firmware with bootloader.
                  </div>
                </div>
              </label>

              <label 
                className={`flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  installType === 'update' 
                    ? 'border-success bg-success/5' 
                    : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                }`}
              >
                <input
                  type="radio"
                  name="installType"
                  value="update"
                  checked={installType === 'update'}
                  onChange={() => setInstallType('update')}
                  className="mt-1 accent-success"
                />
                <div className="flex-1">
                  <div className="font-semibold">Update Firmware</div>
                  <div className="text-sm text-[var(--color-text-muted)]">
                    For existing devices. Preserves WiFi and settings.
                  </div>
                </div>
              </label>
            </div>

            {/* Install Button */}
            <div className="flex justify-center mb-6">
              <EspWebInstallButton 
                manifest={installType === 'fresh' ? MANIFEST_FRESH : MANIFEST_UPDATE}
                onInstallComplete={handleFlashComplete}
                onInstallError={handleFlashError}
              >
                <button 
                  slot="activate"
                  className="bg-success text-white px-8 py-4 text-lg font-semibold border-none rounded-xl cursor-pointer transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                >
                  {installType === 'fresh' ? 'Install Firmware' : 'Update Firmware'}
                </button>
                <span slot="unsupported" className="text-red-600 text-sm">
                  Your browser doesn&apos;t support Web Serial. Please use Chrome or Edge.
                </span>
                <span slot="not-allowed" className="text-yellow-600 text-sm">
                  Serial access denied. Please allow access and try again.
                </span>
              </EspWebInstallButton>
            </div>

            {/* Status */}
            {flashStatus && (
              <Alert 
                variant={flashStatus.type === 'error' ? 'danger' : flashStatus.type === 'success' ? 'success' : 'info'}
                className="mb-4"
              >
                {flashStatus.message}
              </Alert>
            )}

            {/* Browser Support - Compact */}
            <div className="flex items-center justify-center gap-4 text-sm text-[var(--color-text-muted)] mb-4">
              <span className="flex items-center gap-1">
                <span className="text-green-600">✓</span> Chrome
              </span>
              <span className="flex items-center gap-1">
                <span className="text-green-600">✓</span> Edge
              </span>
              <span className="flex items-center gap-1">
                <span className="text-red-500">✗</span> Firefox
              </span>
              <span className="flex items-center gap-1">
                <span className="text-red-500">✗</span> Safari
              </span>
            </div>

            {/* Advanced Options */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-transparent border-none cursor-pointer py-2"
            >
              {showAdvanced ? '▼' : '▶'} Advanced Options
            </button>

            {showAdvanced && (
              <div className="mt-4 p-4 bg-[var(--color-surface-alt)] rounded-lg text-sm">
                <h4 className="font-medium mb-2">Troubleshooting</h4>
                <ul className="list-disc list-inside text-[var(--color-text-muted)] space-y-1">
                  <li>Use a USB data cable (not charge-only)</li>
                  <li>Hold BOOT button while connecting if device isn&apos;t detected</li>
                  <li>Try a different USB port or cable</li>
                </ul>
                
                <h4 className="font-medium mt-4 mb-2">Serial Console</h4>
                <div className="h-32 overflow-y-auto bg-[var(--color-code-bg)] text-green-400 font-mono text-xs p-2 rounded">
                  {(serialOutput.length > 0 ? serialOutput : ['Waiting for device...']).map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
                <button 
                  onClick={clearOutput}
                  className="mt-2 px-3 py-1 text-xs bg-[var(--color-border)] border-none rounded cursor-pointer hover:brightness-90"
                >
                  Clear Console
                </button>
              </div>
            )}

            {/* Skip to WiFi (for update installs) */}
            {flashComplete && (
              <div className="flex justify-end mt-6 pt-4 border-t border-[var(--color-border)]">
                <Button variant="success" onClick={() => goToStep(2)}>
                  Continue to WiFi Setup →
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Configure WiFi */}
        {currentStep === 2 && (
          <div className="card animate-fade-in">
            <h2 className="text-2xl font-semibold mb-2">Configure WiFi</h2>
            <p className="text-[var(--color-text-muted)] mb-6">
              {installType === 'update' 
                ? 'Skip this if your device is already connected to WiFi.'
                : 'Connect your device to your home network.'}
            </p>

            {isSupported ? (
              <div className="space-y-4">
                {/* Network Selection */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="font-medium">Network Name</label>
                    {availableNetworks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setUseManualEntry(!useManualEntry);
                          if (!useManualEntry) setSsid('');
                        }}
                        className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none"
                      >
                        {useManualEntry ? 'Select from list' : 'Enter manually'}
                      </button>
                    )}
                  </div>
                  
                  {isScanning ? (
                    <div className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface-alt)] text-center text-sm">
                      <span className="animate-pulse">Scanning for networks...</span>
                    </div>
                  ) : !useManualEntry && availableNetworks.length > 0 ? (
                    <select
                      value={ssid}
                      onChange={(e) => setSsid(e.target.value)}
                      className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                    >
                      <option value="">Select a network...</option>
                      {availableNetworks.map((network) => (
                        <option key={network} value={network}>{network}</option>
                      ))}
                    </select>
                  ) : (
                    <input 
                      type="text" 
                      placeholder="Enter WiFi network name"
                      value={ssid}
                      onChange={(e) => setSsid(e.target.value)}
                      className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                    />
                  )}
                </div>

                {/* Password */}
                <div>
                  <label className="block mb-2 font-medium">Password</label>
                  <input 
                    type="password" 
                    placeholder="Enter WiFi password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]"
                  />
                </div>

                {/* Send Button */}
                <Button variant="primary" block onClick={handleSendWifi} disabled={isSending}>
                  {isSending ? 'Sending...' : 'Configure WiFi'}
                </Button>

                {/* Status */}
                {wifiStatus && (
                  <Alert variant={wifiStatus.type === 'error' ? 'danger' : wifiStatus.type === 'success' ? 'success' : 'info'}>
                    {wifiStatus.message}
                  </Alert>
                )}

                {/* Connection Status */}
                <p className="text-xs text-center text-[var(--color-text-muted)]">
                  Device: {serialStatus === 'connected' ? '✓ Connected' : 'Not connected'}
                </p>
              </div>
            ) : (
              <Alert variant="info">
                <strong>Web Serial not supported</strong><br />
                Connect to the device&apos;s &quot;Webex-Display-XXXX&quot; WiFi network to configure.
              </Alert>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-6 pt-4 border-t border-[var(--color-border)]">
              <Button onClick={() => goToStep(1)}>← Back</Button>
              <Button variant="success" onClick={() => goToStep(3)}>
                {installType === 'update' ? 'Skip →' : 'Finish →'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Complete */}
        {currentStep === 3 && (
          <div className="card text-center animate-fade-in">
            <div className="text-5xl mb-4">✓</div>
            <h2 className="text-2xl font-semibold text-success mb-2">All Done!</h2>
            <p className="text-[var(--color-text-muted)] mb-6">
              Your LED Matrix Display is ready to use.
            </p>

            <div className="bg-[var(--color-surface-alt)] rounded-lg p-6 text-left mb-6">
              <h3 className="font-semibold mb-3">Next Steps</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-[var(--color-text-muted)]">
                <li>Wait for the display to show a pairing code</li>
                <li>Open the <Link href="/embedded/" className="text-primary hover:underline">Webex Embedded App</Link></li>
                <li>Enter the pairing code to connect</li>
              </ol>
            </div>

            <Alert variant="info" className="text-left">
              <strong>Automatic Updates</strong><br />
              Future firmware updates will install automatically over WiFi.
            </Alert>

            <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
              <Link href="/">
                <Button variant="success">Return to Home</Button>
              </Link>
            </div>
          </div>
        )}

        {/* Help */}
        <div className="text-center mt-6 text-sm">
          <Link href="/troubleshooting/" className="text-[var(--color-text-muted)] hover:text-primary">
            Having trouble? View troubleshooting guide
          </Link>
        </div>
      </div>
    </>
  );
}
