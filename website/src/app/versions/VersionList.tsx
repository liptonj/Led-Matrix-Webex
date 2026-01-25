'use client';

import Link from 'next/link';
import { useManifest } from '@/hooks/useManifest';
import { Alert } from '@/components/ui';

export function VersionList() {
  const { versions, loading, error } = useManifest();

  if (loading) {
    return (
      <div className="py-8 text-center text-[var(--color-text-muted)]">
        Loading firmware versions...
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="danger">
        <p className="mb-2">{error}</p>
        <Link 
          href="https://github.com/liptonj/Led-Matrix-Webex/releases" 
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Visit GitHub Releases →
        </Link>
      </Alert>
    );
  }

  if (versions.length === 0) {
    return (
      <p className="text-[var(--color-text-muted)]">No firmware versions available yet.</p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {versions.map((version) => (
        <div 
          key={version.tag}
          className="p-5 bg-[var(--color-surface-alt)] rounded-lg border-l-4 border-primary"
        >
          <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
            <div className="text-xl font-bold text-primary">{version.tag}</div>
            <div className="text-sm text-[var(--color-text-muted)]">
              {new Date(version.build_date).toLocaleDateString()}
            </div>
          </div>
          
          {version.notes && (
            <p className="text-[var(--color-text-muted)] mb-4">{version.notes}</p>
          )}

          {version.prerelease && (
            <span className="inline-block px-2 py-1 bg-warning/20 text-warning text-xs rounded mb-4">
              Pre-release
            </span>
          )}

          {version.firmware && version.firmware.length > 0 && (
            <>
              <h4 className="text-sm font-medium text-[var(--color-text-muted)] mb-2 mt-4">Downloads</h4>
              <div className="flex flex-wrap gap-3">
                {version.firmware.map((asset) => (
                  <Link
                    key={asset.url}
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-5 py-2.5 bg-primary text-white no-underline rounded-lg text-sm transition-colors hover:bg-primary-dark"
                  >
                    {asset.name}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
