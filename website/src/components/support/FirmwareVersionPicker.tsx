'use client';

import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase/core';

interface FirmwareVersion {
  version: string;
  created_at: string;
  release_notes: string | null;
  is_beta: boolean;
  manifest_url: string | null;
}

interface FirmwareVersionPickerProps {
  onSelect: (manifestUrl: string) => void;
  onCancel: () => void;
}

/**
 * Modal-style firmware version picker.
 * Reads available firmware versions from display.releases table.
 */
export function FirmwareVersionPicker({ onSelect, onCancel }: FirmwareVersionPickerProps) {
  const [versions, setVersions] = useState<FirmwareVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchVersions() {
      try {
        const supabase = await getSupabase();
        const { data, error: fetchError } = await supabase
          .schema('display')
          .from('releases')
          .select('version, created_at, release_notes, is_beta, manifest_url')
          .eq('is_deprecated', false)
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

  const handleFlash = () => {
    if (selected) {
      onSelect(selected);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Select Firmware Version
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Choose a firmware version to flash to the device.
          </p>
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
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

          {versions.map((version) => (
            <button
              key={version.version}
              onClick={() => setSelected(version.manifest_url)}
              disabled={!version.manifest_url}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selected === version.manifest_url
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              } ${!version.manifest_url ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium text-gray-900 dark:text-white">
                  {version.version}
                </span>
                <div className="flex items-center gap-2">
                  {version.is_beta && (
                    <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded">
                      Beta
                    </span>
                  )}
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(version.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              {version.release_notes && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                  {version.release_notes}
                </p>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleFlash}
            disabled={!selected}
            className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
          >
            Flash Selected Version
          </button>
        </div>
      </div>
    </div>
  );
}
