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

// Use Supabase Edge Function for dynamic manifest generation
// Returns null if Supabase is not configured (caller must handle this)
function getManifestUrl(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl}/functions/v1/get-manifest`;
  }
  // Supabase URL is required - no fallback available
  return null;
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
      const response = await fetch(manifestUrl);
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
