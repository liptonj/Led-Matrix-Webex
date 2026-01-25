'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FirmwareManifest, FirmwareVersion } from '@/types';

interface UseManifestResult {
  manifest: FirmwareManifest | null;
  versions: FirmwareVersion[];
  latestVersion: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const MANIFEST_URL = '/updates/manifest.json';

export function useManifest(): UseManifestResult {
  const [manifest, setManifest] = useState<FirmwareManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchManifest = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(MANIFEST_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data: FirmwareManifest = await response.json();
      setManifest(data);
    } catch (err) {
      console.error('Failed to load manifest:', err);
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
