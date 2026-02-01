'use client';

import { getManifestUrl } from '@/lib/firmware/manifest';
import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import type { FirmwareManifest, FirmwareVersion } from '@/types';
import { useCallback, useEffect, useState } from 'react';

const MANIFEST_TIMEOUT_MS = 10000;

interface UseManifestResult {
  manifest: FirmwareManifest | null;
  versions: FirmwareVersion[];
  latestVersion: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useManifest(): UseManifestResult {
  const [manifest, setManifest] = useState<FirmwareManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchManifest = useCallback(async () => {
    setLoading(true);
    setError(null);

    const manifestUrl = getManifestUrl();
    
    if (!manifestUrl) {
      setError(
        'Supabase configuration missing. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.'
      );
      setLoading(false);
      return;
    }

    try {
      const response = await fetchWithTimeout(manifestUrl, {}, MANIFEST_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data: FirmwareManifest = await response.json();
      setManifest(data);
    } catch {
      setError(
        'Failed to load firmware versions. Please try again later or visit GitHub Releases.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchManifest();
  }, [fetchManifest]);

  return {
    manifest,
    versions: manifest?.versions ?? [],
    latestVersion: manifest?.latest ?? null,
    loading,
    error,
    refetch: fetchManifest,
  };
}
