/**
 * useEspWebTools Hook
 *
 * Manages ESP Web Tools custom element integration and readiness state.
 * Handles loading, error states, and ensures the custom element is defined.
 */

'use client';

import { getEspWebToolsManifestUrl } from '@/lib/firmware/manifest';
import { useEffect, useState } from 'react';

export interface EspWebToolsStatus {
  /**
   * Whether ESP Web Tools is ready to use
   */
  ready: boolean;

  /**
   * Loading state during initial custom element registration
   */
  loading: boolean;

  /**
   * Error message if ESP Web Tools failed to load
   */
  error: string | null;

  /**
   * The manifest URL for ESP Web Tools, or null if not configured
   */
  manifestUrl: string | null;

  /**
   * Whether Supabase is configured for firmware downloads
   */
  configured: boolean;
}

/**
 * Hook to manage ESP Web Tools integration.
 *
 * Monitors custom element registration and provides status information.
 * Returns manifest URL and configuration state for UI rendering.
 *
 * @returns ESP Web Tools status and configuration
 *
 * @example
 * ```tsx
 * function InstallComponent() {
 *   const { ready, loading, error, manifestUrl, configured } = useEspWebTools();
 *
 *   if (!configured) {
 *     return <Alert>Supabase not configured</Alert>;
 *   }
 *
 *   if (loading) {
 *     return <Spinner />;
 *   }
 *
 *   if (error) {
 *     return <Alert>{error}</Alert>;
 *   }
 *
 *   return <EspWebInstallButton manifest={manifestUrl} />;
 * }
 * ```
 */
export function useEspWebTools(): EspWebToolsStatus {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const manifestUrl = getEspWebToolsManifestUrl();
  const configured = manifestUrl !== null;

  useEffect(() => {
    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Check if already defined
    if (customElements.get('esp-web-install-button')) {
      setReady(true);
      setLoading(false);
      return;
    }

    // Wait for custom element to be defined
    customElements
      .whenDefined('esp-web-install-button')
      .then(() => {
        if (!isMounted) return;
        setReady(true);
        setLoading(false);
        setError(null);
      })
      .catch(() => {
        if (!isMounted) return;
        setError('ESP Web Tools failed to load. Please refresh the page.');
        setLoading(false);
      });

    // Set a timeout to show loading message after 2 seconds
    timeoutId = setTimeout(() => {
      if (!isMounted) return;
      if (!customElements.get('esp-web-install-button')) {
        setLoading(true);
      }
    }, 2000);

    return () => {
      isMounted = false;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  return {
    ready,
    loading,
    error,
    manifestUrl,
    configured,
  };
}
