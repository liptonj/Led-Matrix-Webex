'use client';

import React, { useEffect, useRef } from 'react';

interface EspWebInstallButtonProps {
  manifest: string;
  children?: React.ReactNode;
}

/**
 * Wrapper for ESP Web Tools install button.
 * 
 * This component simply renders the esp-web-install-button custom element.
 * ESP Web Tools handles the flashing dialog internally.
 * 
 * NOTE: ESP Web Tools does NOT reliably fire completion events that we can
 * intercept, so we don't try to detect completion - we just let the user
 * manually confirm when they're done.
 */
export function EspWebInstallButton({ 
  manifest, 
  children,
}: EspWebInstallButtonProps) {
  const buttonRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;

    button.setAttribute('manifest', manifest);
  }, [manifest]);

  return React.createElement(
    'esp-web-install-button',
    { ref: buttonRef, manifest },
    children
  );
}
