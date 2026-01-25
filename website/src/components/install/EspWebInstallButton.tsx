'use client';

import { useEffect, useRef } from 'react';

interface EspWebInstallButtonProps {
  manifest: string;
  children?: React.ReactNode;
}

export function EspWebInstallButton({ manifest, children }: EspWebInstallButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create the custom element using DOM API
    const button = document.createElement('esp-web-install-button');
    button.setAttribute('manifest', manifest);

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
      button.remove();
    };
  }, [manifest]);

  return (
    <div ref={containerRef}>
      <div data-slot-content style={{ display: 'none' }}>
        {children}
      </div>
    </div>
  );
}
