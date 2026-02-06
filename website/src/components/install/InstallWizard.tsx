'use client';

import { Alert, Button } from '@/components/ui';
import { useSerialMonitor } from '@/hooks/useSerialMonitor';
import { autoApproveDevice } from '@/lib/device/autoApprove';
import { createProvisionToken, waitForDeviceApproval } from '@/lib/device/provisionToken';
import { getSession } from '@/lib/supabase/auth';
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

  // Provision token state
  const [provisionToken, setProvisionToken] = useState<string | null>(null);
  const [tokenSent, setTokenSent] = useState(false);
  const approvalPollingRef = useRef<AbortController | null>(null);
  const approvalSucceededRef = useRef(false);

  // Handle pairing code found callback
  const handlePairingCodeFound = useCallback(async (code: string) => {
    // If already approved, ignore pairing code
    if (approvalSucceededRef.current) {
      return;
    }

    setApprovalState({ status: 'approving', message: `Approving device with pairing code: ${code}...` });
    
    try {
      const result = await autoApproveDevice(code);
      
      if (result.success) {
        approvalSucceededRef.current = true;
        setApprovalState({ status: 'success', message: result.message });
        // Stop token polling if active
        if (approvalPollingRef.current) {
          approvalPollingRef.current.abort();
          approvalPollingRef.current = null;
        }
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

  // Handle provision token ACK callback
  const handleProvisionTokenAck = useCallback(async (success: boolean, error?: string) => {
    if (!success) {
      console.warn('[InstallWizard] Provision token ACK error:', error);
      // Continue with pairing code fallback - don't update state, just log
      return;
    }

    // If already approved, don't start polling
    if (approvalSucceededRef.current) {
      return;
    }

    console.log('[InstallWizard] Provision token ACK received, starting approval polling...');
    
    // Get user ID for polling
    try {
      const { data: { session }, error: sessionError } = await getSession();
      if (sessionError || !session?.user?.id) {
        console.error('[InstallWizard] Failed to get user session for approval polling:', sessionError);
        return;
      }

      const userId = session.user.id;

      // Start polling for device approval
      const abortController = new AbortController();
      approvalPollingRef.current = abortController;

      // Poll in background (non-blocking)
      waitForDeviceApproval(userId, 60_000)
        .then((device) => {
          // Check if polling was aborted or already succeeded
          if (abortController.signal.aborted || approvalSucceededRef.current) {
            return;
          }

          if (device) {
            approvalSucceededRef.current = true;
            console.log('[InstallWizard] Device approved via provision token:', device.id);
            setApprovalState({ 
              status: 'success', 
              message: 'Device approved successfully via provision token!' 
            });
            // Stop monitoring
            stopMonitoringRef.current();
            // Move to success step after a delay
            setTimeout(() => {
              setCurrentStep(3);
            }, 2000);
          } else {
            console.log('[InstallWizard] Provision token approval polling timed out, continuing with pairing code fallback');
          }
        })
        .catch((error) => {
          if (!abortController.signal.aborted && !approvalSucceededRef.current) {
            console.error('[InstallWizard] Error during approval polling:', error);
          }
        });
    } catch (error) {
      console.error('[InstallWizard] Failed to start approval polling:', error);
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
    sendCommand,
    isMonitoring,
  } = useSerialMonitor({
    onPairingCodeFound: handlePairingCodeFound,
    onProvisionTokenAck: handleProvisionTokenAck,
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
    // Reset approval state and token state
    setApprovalState({ status: 'idle', message: '' });
    setProvisionToken(null);
    setTokenSent(false);
    approvalSucceededRef.current = false;
    
    // Abort any existing polling
    if (approvalPollingRef.current) {
      approvalPollingRef.current.abort();
      approvalPollingRef.current = null;
    }

    // Start Serial monitoring after a short delay to allow UI to update
    setTimeout(async () => {
      try {
        await startMonitoring();
        
        // Generate and send provision token
        const token = await createProvisionToken();
        if (token) {
          setProvisionToken(token);
          
          // Send token via serial with retry
          const sendTokenWithRetry = async (retries = 3): Promise<boolean> => {
            for (let i = 0; i < retries; i++) {
              const success = await sendCommand(`PROVISION_TOKEN:${token}`);
              if (success) {
                setTokenSent(true);
                console.log('[InstallWizard] Provision token sent successfully');
                return true;
              }
              if (i < retries - 1) {
                // Wait 1 second before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
            console.warn('[InstallWizard] Failed to send provision token after retries, continuing with pairing code fallback');
            return false;
          };

          // Send token (non-blocking, will wait for ACK via callback)
          sendTokenWithRetry().catch((error) => {
            console.error('[InstallWizard] Error sending provision token:', error);
          });
        } else {
          console.warn('[InstallWizard] Failed to create provision token, continuing with pairing code fallback');
        }
      } catch (error) {
        console.error('Failed to start Serial monitoring:', error);
      }
    }, 500);
  }, [startMonitoring, sendCommand]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring();
      // Abort approval polling if active
      if (approvalPollingRef.current) {
        approvalPollingRef.current.abort();
        approvalPollingRef.current = null;
      }
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
          {tokenSent && provisionToken && (
            <Alert variant="info" className="mb-4">
              <strong>Provision token sent.</strong> Waiting for device approval via token...
            </Alert>
          )}

          {approvalState.status === 'approving' && (
            <Alert variant="info" className="mb-4">
              <strong>Approving device...</strong>{' '}
              {extractedPairingCode ? (
                <>Using pairing code: <strong className="font-mono">{extractedPairingCode}</strong></>
              ) : (
                <>Using provision token...</>
              )}
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
