'use client';

import { Alert, Button } from '@/components/ui';
import { useSerialMonitor } from '@/hooks/useSerialMonitor';
import { autoApproveDevice } from '@/lib/device/autoApprove';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FirmwareInstallStep } from './FirmwareInstallStep';
import { SerialMonitor } from './SerialMonitor';
import { SuccessStep } from './SuccessStep';

type WizardStep = 1 | 2 | 3;

export function InstallWizard() {
  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Firmware installation state
  const [flashStatus, setFlashStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  
  // WiFi configuration tracking
  const [wifiConfigured, setWifiConfigured] = useState<boolean | null>(null);
  const [showWifiConfirmation, setShowWifiConfirmation] = useState(false);
  
  // Approval state
  const [approvalState, setApprovalState] = useState<{
    status: 'idle' | 'approving' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });

  // Handle pairing code found callback
  const handlePairingCodeFound = useCallback(async (code: string) => {
    setApprovalState({ status: 'approving', message: `Approving device with pairing code: ${code}...` });
    
    try {
      const result = await autoApproveDevice(code);
      
      if (result.success) {
        setApprovalState({ status: 'success', message: result.message });
        // Move to success step after a delay
        setTimeout(() => {
          setCurrentStep(3);
          stopMonitoringRef.current();
        }, 2000);
      } else {
        setApprovalState({ 
          status: 'error', 
          message: result.error || 'Failed to approve device' 
        });
      }
    } catch (error) {
      setApprovalState({ 
        status: 'error', 
        message: error instanceof Error ? error.message : 'Failed to approve device' 
      });
    }
  }, []);

  // Serial monitoring and auto-approval
  const {
    serialOutput,
    autoApproveStatus,
    approveMessage,
    extractedPairingCode,
    startMonitoring,
    stopMonitoring,
    isMonitoring,
  } = useSerialMonitor({
    onPairingCodeFound: handlePairingCodeFound,
  });

  // Store stopMonitoring in a ref so callback can access it
  const stopMonitoringRef = useRef(stopMonitoring);
  useEffect(() => {
    stopMonitoringRef.current = stopMonitoring;
  }, [stopMonitoring]);

  // Show WiFi confirmation first
  const handleShowWifiConfirmation = useCallback(() => {
    setShowWifiConfirmation(true);
  }, []);

  // Handle WiFi confirmation and proceed to monitoring
  const handleWifiConfirmation = useCallback(async (configured: boolean) => {
    setWifiConfigured(configured);
    setShowWifiConfirmation(false);
    setCurrentStep(2);
    // Reset approval state
    setApprovalState({ status: 'idle', message: '' });
    // Start Serial monitoring after a short delay to allow UI to update
    setTimeout(() => {
      startMonitoring().catch((error) => {
        console.error('Failed to start Serial monitoring:', error);
      });
    }, 500);
  }, [startMonitoring]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  // Determine approval status for display
  const displayApprovalStatus = approvalState.status !== 'idle' ? approvalState.status : 
    (extractedPairingCode && !isMonitoring ? 'approving' : autoApproveStatus);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress Indicator */}
      <div className="flex justify-center mb-8">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
                  currentStep === step
                    ? 'bg-primary text-white scale-110'
                    : currentStep > step
                    ? 'bg-success text-white'
                    : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]'
                }`}
              >
                {currentStep > step ? '✓' : step}
              </div>
              {step < 3 && (
                <div
                  className={`w-12 h-1 mx-2 rounded ${
                    currentStep > step ? 'bg-success' : 'bg-[var(--color-border)]'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Firmware Installation */}
      {currentStep === 1 && (
        <>
          <FirmwareInstallStep
            flashStatus={flashStatus}
            showAdvanced={showAdvanced}
            onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
            onContinue={handleShowWifiConfirmation}
          />
          
          {/* WiFi Configuration Confirmation */}
          {showWifiConfirmation && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 max-w-md mx-4 shadow-2xl">
                <h3 className="text-xl font-bold mb-4">WiFi Configuration</h3>
                <p className="text-[var(--color-text-muted)] mb-6">
                  Did you configure WiFi during the installation dialog?
                </p>
                <div className="flex gap-3">
                  <Button 
                    variant="success" 
                    onClick={() => handleWifiConfirmation(true)}
                    className="flex-1"
                  >
                    Yes, WiFi is set up
                  </Button>
                  <Button 
                    variant="default" 
                    onClick={() => handleWifiConfirmation(false)}
                    className="flex-1"
                  >
                    No, I&apos;ll use AP mode
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Step 2: Serial Monitoring & Auto-Approval */}
      {currentStep === 2 && (
        <div className="card animate-fade-in">
          <h2 className="text-2xl font-semibold mb-2">Device Approval</h2>
          <p className="text-[var(--color-text-muted)] mb-6">
            Monitoring Serial output to automatically approve your device...
          </p>

          {/* Auto-approval status */}
          {approvalState.status === 'approving' && (
            <Alert variant="info" className="mb-4">
              <strong>Approving device...</strong> Using pairing code: <strong className="font-mono">{extractedPairingCode}</strong>
            </Alert>
          )}

          {approvalState.status === 'success' && (
            <Alert variant="success" className="mb-4">
              <strong>Device approved successfully!</strong> {approvalState.message}
            </Alert>
          )}

          {approvalState.status === 'error' && (
            <Alert variant="danger" className="mb-4">
              <strong>Auto-approval failed.</strong> {approvalState.message}
            </Alert>
          )}

          {/* Serial Monitor */}
          <SerialMonitor
            serialOutput={serialOutput}
            autoApproveStatus={displayApprovalStatus}
            approveMessage={approvalState.message || approveMessage}
            extractedPairingCode={extractedPairingCode}
            isMonitoring={isMonitoring}
          />

          {/* Manual Actions */}
          <div className="mt-6 border-t border-[var(--color-border)] pt-6">
            <div className="flex flex-col gap-3">
              {isMonitoring && (
                <Button
                  variant="default"
                  onClick={() => {
                    stopMonitoring();
                    setCurrentStep(3);
                  }}
                >
                  Skip Monitoring →
                </Button>
              )}
              {!isMonitoring && extractedPairingCode && approvalState.status !== 'success' && (
                <div className="space-y-3">
                  <Button
                    variant="primary"
                    onClick={async () => {
                      setApprovalState({ status: 'approving', message: 'Approving device...' });
                      const result = await autoApproveDevice(extractedPairingCode);
                      if (result.success) {
                        setApprovalState({ status: 'success', message: result.message });
                        setTimeout(() => {
                          setCurrentStep(3);
                        }, 2000);
                      } else {
                        setApprovalState({ status: 'error', message: result.error || 'Failed to approve device' });
                      }
                    }}
                    disabled={approvalState.status === 'approving'}
                  >
                    {approvalState.status === 'approving' ? 'Approving...' : 'Approve Device Manually'}
                  </Button>
                  <p className="text-xs text-[var(--color-text-muted)] text-center">
                    Or go to the <a href="/user/approve-device" className="underline">approve device page</a> to enter the code manually
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Success */}
      {currentStep === 3 && (
        <SuccessStep wifiConfigured={wifiConfigured ?? false} />
      )}
    </div>
  );
}
