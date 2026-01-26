'use client';

import { useEffect, useRef, useCallback } from 'react';

interface EspWebInstallButtonProps {
  manifest: string;
  children?: React.ReactNode;
  onInstallComplete?: () => void;
  onInstallError?: (error: string) => void;
}

export function EspWebInstallButton({ 
  manifest, 
  children, 
  onInstallComplete,
  onInstallError 
}: EspWebInstallButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLElement | null>(null);

  const handleStateChange = useCallback((event: Event) => {
    const customEvent = event as CustomEvent;
    const state = customEvent.detail?.state;
    
    if (state === 'finished') {
      // Dispatch global event for backward compatibility
      window.dispatchEvent(new CustomEvent('esp-web-install-complete'));
      onInstallComplete?.();
    } else if (state === 'error') {
      const error = customEvent.detail?.message || 'Installation failed';
      onInstallError?.(error);
    }
  }, [onInstallComplete, onInstallError]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create the custom element using DOM API
    const button = document.createElement('esp-web-install-button');
    button.setAttribute('manifest', manifest);
    buttonRef.current = button;

    // Listen for state changes from ESP Web Tools
    button.addEventListener('state-changed', handleStateChange);

    // Move children into the custom element
    if (containerRef.current.children.length > 0) {
      const template = containerRef.current.querySelector('[data-slot-content]');
      if (template) {
        while (template.firstChild) {
          button.appendChild(template.firstChild);
        }
        template.remove();
      }
    }

    containerRef.current.appendChild(button);

    return () => {
      button.removeEventListener('state-changed', handleStateChange);
      button.remove();
      buttonRef.current = null;
    };
  }, [manifest, handleStateChange]);

  return (
    <div ref={containerRef}>
      <div data-slot-content style={{ display: 'none' }}>
        {children}
      </div>
    </div>
  );
}
