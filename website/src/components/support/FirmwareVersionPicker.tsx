'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getSupabase } from '@/lib/supabase/core';
import { formatBytes } from '@/lib/utils';

type Tab = 'releases' | 'upload';

/** Firmware flash offset presets */
type FlashOffset = 'merged' | 'ota';
const OFFSET_VALUES: Record<FlashOffset, number> = {
  merged: 0x0,
  ota: 0x10000,
};

interface FirmwareVersion {
  version: string;
  created_at: string;
  notes: string | null;
  is_prerelease: boolean;
  is_latest: boolean;
  release_channel: string;
}

interface FirmwareVersionPickerProps {
  onSelect: (manifestUrl: string) => void;
  onCancel: () => void;
}

/**
 * Build the manifest URL for a specific published release.
 * Uses the get-manifest edge function with version + format params.
 */
function buildManifestUrl(version: string): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/functions/v1/get-manifest?format=esp-web-tools&version=${encodeURIComponent(version)}`;
}

/**
 * Create in-memory blob URLs that form a valid ESP Web Tools manifest
 * so that useEspFlash.startFlash can consume an uploaded binary file
 * with no server round-trip.
 *
 * Returns the manifest blob URL. Caller must revoke both URLs when done.
 */
function buildBlobManifest(
  file: File,
  offset: number,
): { manifestUrl: string; binaryUrl: string } {
  const binaryUrl = URL.createObjectURL(file);

  const manifest = {
    name: file.name,
    version: 'local',
    new_install_prompt_erase: false,
    builds: [
      {
        chipFamily: 'ESP32-S3',
        parts: [{ path: binaryUrl, offset }],
      },
    ],
  };

  const manifestBlob = new Blob([JSON.stringify(manifest)], {
    type: 'application/json',
  });
  const manifestUrl = URL.createObjectURL(manifestBlob);

  return { manifestUrl, binaryUrl };
}

/**
 * Modal-style firmware version picker with two tabs:
 * 1. Published Releases — fetched from display.releases
 * 2. Upload File — pick a local .bin to flash directly
 */
export function FirmwareVersionPicker({ onSelect, onCancel }: FirmwareVersionPickerProps) {
  const [tab, setTab] = useState<Tab>('releases');

  // --- Release tab state ---
  const [versions, setVersions] = useState<FirmwareVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  // --- Upload tab state ---
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [flashOffset, setFlashOffset] = useState<FlashOffset>('merged');
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Track blob URLs so we can revoke them on cancel / unmount */
  const blobUrlsRef = useRef<{ manifestUrl: string; binaryUrl: string } | null>(null);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      if (blobUrlsRef.current) {
        URL.revokeObjectURL(blobUrlsRef.current.manifestUrl);
        URL.revokeObjectURL(blobUrlsRef.current.binaryUrl);
      }
    };
  }, []);

  // Fetch published releases
  useEffect(() => {
    let mounted = true;

    async function fetchVersions() {
      try {
        const supabase = await getSupabase();
        const { data, error: fetchError } = await supabase
          .schema('display')
          .from('releases')
          .select('version, created_at, notes, is_prerelease, is_latest, release_channel')
          .order('created_at', { ascending: false })
          .limit(20);

        if (fetchError) throw fetchError;
        if (mounted) {
          setVersions(data || []);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load firmware versions');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchVersions();
    return () => { mounted = false; };
  }, []);

  const selectedManifestUrl = useMemo(
    () => selectedVersion ? buildManifestUrl(selectedVersion) : null,
    [selectedVersion],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setUploadedFile(file);
    },
    [],
  );

  const handleFlash = useCallback(() => {
    if (tab === 'releases') {
      if (selectedManifestUrl) {
        onSelect(selectedManifestUrl);
      }
    } else if (tab === 'upload' && uploadedFile) {
      // Revoke any previous blob URLs
      if (blobUrlsRef.current) {
        URL.revokeObjectURL(blobUrlsRef.current.manifestUrl);
        URL.revokeObjectURL(blobUrlsRef.current.binaryUrl);
      }

      const urls = buildBlobManifest(uploadedFile, OFFSET_VALUES[flashOffset]);
      blobUrlsRef.current = urls;
      onSelect(urls.manifestUrl);
    }
  }, [tab, selectedManifestUrl, uploadedFile, flashOffset, onSelect]);

  const handleCancel = useCallback(() => {
    if (blobUrlsRef.current) {
      URL.revokeObjectURL(blobUrlsRef.current.manifestUrl);
      URL.revokeObjectURL(blobUrlsRef.current.binaryUrl);
      blobUrlsRef.current = null;
    }
    onCancel();
  }, [onCancel]);

  const isFlashDisabled =
    tab === 'releases' ? !selectedManifestUrl : !uploadedFile;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Select Firmware Version
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Choose a published release or upload a local binary.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 shrink-0">
          <button
            onClick={() => setTab('releases')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'releases'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Published Releases
          </button>
          <button
            onClick={() => setTab('upload')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'upload'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Upload File
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === 'releases' && (
            <>
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <span className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}

              {!loading && !error && versions.length === 0 && (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">
                  No firmware versions available.
                </p>
              )}

              {versions.map((v) => (
                <button
                  key={v.version}
                  onClick={() => setSelectedVersion(v.version)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedVersion === v.version
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-gray-900 dark:text-white">
                      {v.version}
                    </span>
                    <div className="flex items-center gap-2">
                      {v.is_latest && (
                        <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                          Latest
                        </span>
                      )}
                      {v.is_prerelease && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded">
                          Beta
                        </span>
                      )}
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {v.release_channel}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(v.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {v.notes && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {v.notes}
                    </p>
                  )}
                </button>
              ))}
            </>
          )}

          {tab === 'upload' && (
            <div className="space-y-4">
              {/* Drop zone / file input */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:border-blue-400 dark:hover:border-blue-500 transition-colors cursor-pointer"
              >
                {uploadedFile ? (
                  <div>
                    <p className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                      {uploadedFile.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {formatBytes(uploadedFile.size)}
                    </p>
                    <p className="text-xs text-blue-500 mt-2">Click to change file</p>
                  </div>
                ) : (
                  <div>
                    <svg
                      className="mx-auto h-8 w-8 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16"
                      />
                    </svg>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      Click to select a <span className="font-mono">.bin</span> firmware file
                    </p>
                  </div>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".bin"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Upload firmware binary"
              />

              {/* Flash offset selector */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Binary type
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFlashOffset('merged')}
                    className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                      flashOffset === 'merged'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span className="font-medium">Merged</span>
                    <span className="block text-[10px] opacity-70 mt-0.5">
                      Full flash @ 0x0
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlashOffset('ota')}
                    className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                      flashOffset === 'ota'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span className="font-medium">OTA / App</span>
                    <span className="block text-[10px] opacity-70 mt-0.5">
                      App partition @ 0x10000
                    </span>
                  </button>
                </div>
              </div>

              {/* Info callout */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  <strong>Tip:</strong> Use <em>Merged</em> for{' '}
                  <span className="font-mono">firmware-merged-*.bin</span> files (includes
                  bootloader). Use <em>OTA / App</em> for{' '}
                  <span className="font-mono">firmware-*.bin</span> OTA builds.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 shrink-0">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleFlash}
            disabled={isFlashDisabled}
            className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
          >
            {tab === 'upload' ? 'Flash Uploaded File' : 'Flash Selected Version'}
          </button>
        </div>
      </div>
    </div>
  );
}
