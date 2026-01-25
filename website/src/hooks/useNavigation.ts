'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export function useNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const open = useCallback(() => {
    previousActiveElement.current = document.activeElement as HTMLElement;
    setIsOpen(true);
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Restore body scroll
    document.body.style.overflow = '';
    // Return focus to previous element
    previousActiveElement.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Handle escape key
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        close();
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [isOpen, close]);

  // Handle resize - close nav on desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024 && isOpen) {
        close();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen, close]);

  // Focus trap when nav is open
  useEffect(() => {
    if (!isOpen || !navRef.current) return;

    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = navRef.current.querySelectorAll<HTMLElement>(focusableSelector);
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      if (event.shiftKey) {
        if (document.activeElement === firstFocusable) {
          event.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          event.preventDefault();
          firstFocusable?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);
    
    // Focus first element after animation
    const timeout = setTimeout(() => {
      firstFocusable?.focus();
    }, 100);

    return () => {
      document.removeEventListener('keydown', handleTabKey);
      clearTimeout(timeout);
    };
  }, [isOpen]);

  return {
    isOpen,
    open,
    close,
    toggle,
    navRef,
  };
}
