'use client';

import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { getReleases, Release, setLatestRelease, setReleaseRollout } from '@/lib/supabase';
import { useEffect, useState } from 'react';

export default function ReleasesPage() {
    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);

    useEffect(() => {
        loadReleases();
    }, []);

    async function loadReleases() {
        try {
            const data = await getReleases();
            setReleases(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load releases');
        }
        setLoading(false);
    }

    async function handleRolloutChange(version: string, percentage: number) {
        setUpdating(version);
        try {
            await setReleaseRollout(version, percentage);
            await loadReleases();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update rollout');
        }
        setUpdating(null);
    }

    async function handleSetLatest(version: string) {
        setUpdating(version);
        try {
            await setLatestRelease(version);
            await loadReleases();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to set latest release');
        }
        setUpdating(null);
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="space-y-4 lg:space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">
                    Releases
                </h1>
                <button
                    onClick={loadReleases}
                    className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md"
                >
                    Refresh
                </button>
            </div>

            {error && (
                <Alert variant="danger">
                    {error}
                </Alert>
            )}

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-3">
                {releases.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center text-gray-500 dark:text-gray-400">
                        No releases found. Upload firmware via CI/CD.
                    </div>
                ) : (
                    releases.map((release) => (
                        <div
                            key={release.id}
                            className="bg-white dark:bg-gray-800 rounded-lg shadow p-4"
                        >
                            <div className="flex items-start justify-between gap-2 mb-3">
                                <div>
                                    <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                                        {release.version}
                                    </span>
                                    {release.name && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {release.name}
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {release.is_latest && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                                            Latest
                                        </span>
                                    )}
                                    {release.is_prerelease && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">
                                            Pre-release
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                                <span>Tag: {release.tag}</span>
                                <span className="mx-2">•</span>
                                <span>{new Date(release.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                                <div className="flex items-center gap-2 flex-1">
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={release.rollout_percentage}
                                        onChange={(e) =>
                                            handleRolloutChange(release.version, parseInt(e.target.value))
                                        }
                                        disabled={updating === release.version}
                                        className="flex-1 max-w-[120px]"
                                    />
                                    <span className="text-xs text-gray-600 dark:text-gray-400">
                                        {release.rollout_percentage}%
                                    </span>
                                </div>
                                {!release.is_latest && (
                                    <button
                                        onClick={() => handleSetLatest(release.version)}
                                        disabled={updating === release.version}
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                    >
                                        {updating === release.version ? 'Updating...' : 'Set Latest'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Version
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Tag
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Rollout
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Created
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {releases.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={6}
                                        className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                                    >
                                        No releases found. Upload firmware via CI/CD.
                                    </td>
                                </tr>
                            ) : (
                                releases.map((release) => (
                                    <tr key={release.id}>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                                                {release.version}
                                            </span>
                                            {release.name && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    {release.name}
                                                </p>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm font-mono text-gray-600 dark:text-gray-400">
                                                {release.tag}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex flex-wrap gap-1">
                                                {release.is_latest && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                                                        Latest
                                                    </span>
                                                )}
                                                {release.is_prerelease && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">
                                                        Pre-release
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={release.rollout_percentage}
                                                    onChange={(e) =>
                                                        handleRolloutChange(release.version, parseInt(e.target.value))
                                                    }
                                                    disabled={updating === release.version}
                                                    className="w-24"
                                                />
                                                <span className="text-sm text-gray-600 dark:text-gray-400 w-12">
                                                    {release.rollout_percentage}%
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                                {new Date(release.created_at).toLocaleDateString()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {!release.is_latest && (
                                                <button
                                                    onClick={() => handleSetLatest(release.version)}
                                                    disabled={updating === release.version}
                                                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                                >
                                                    {updating === release.version ? 'Updating...' : 'Set Latest'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Info Card */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                    How Releases Work
                </h3>
                <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
                    <li>Releases are uploaded automatically via GitHub Actions when you create a new release</li>
                    <li>The &ldquo;Latest&rdquo; release is what devices will update to by default</li>
                    <li>Rollout percentage controls what fraction of devices will see the update</li>
                    <li>Set a device&apos;s target version to force it to a specific release</li>
                </ul>
            </div>
        </div>
    );
}
