'use client';

import { useState, useEffect } from 'react';
import { FirmwareInstallStep } from './FirmwareInstallStep';
import { SuccessStep } from './SuccessStep';

type WizardStep = 1 | 2;

export function InstallWizard() {
  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Firmware installation state
  const [flashStatus, setFlashStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);

  // Verify ESP Web Tools custom element is registered
  useEffect(() => {
    let isMounted = true;
    
    if (customElements.get('esp-web-install-button')) {
      return;
    }

    customElements.whenDefined('esp-web-install-button')
      .then(() => {
        if (!isMounted) return;
        setFlashStatus((prev) => (prev?.type === 'error' ? null : prev));
      })
      .catch(() => {
        if (!isMounted) return;
        setFlashStatus({
          message: 'ESP Web Tools failed to load. Please refresh the page.',
          type: 'error',
        });
      });

    const timeoutId = window.setTimeout(() => {
      if (!isMounted) return;
      if (!customElements.get('esp-web-install-button')) {
        setFlashStatus({
          message: 'ESP Web Tools is loading...',
          type: 'info',
        });
      }
    }, 2000);

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
    };
  }, []);

  // Navigation handler
  const handleContinueToSuccess = () => {
    setCurrentStep(2);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress Indicator */}
      <div className="flex justify-center mb-8">
        <div className="flex items-center gap-2">
          {[1, 2].map((step) => (
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
              {step < 2 && (
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
        <FirmwareInstallStep
          flashStatus={flashStatus}
          showAdvanced={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
          onContinue={handleContinueToSuccess}
        />
      )}

      {/* Step 2: Success */}
      {currentStep === 2 && (
        <SuccessStep wifiConfigured={true} />
      )}
    </div>
  );
}
