'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRemoteConsole } from '@/hooks/useRemoteConsole';
import {
  BrowserGate,
  isWebSerialSupported,
  RemoteTerminal,
  FirmwareVersionPicker,
} from '@/components/support';
import {
  getActiveSessions,
  subscribeToSessionChanges,
} from '@/lib/supabase/supportSessions';
import type { SupportSession, ActionType } from '@/types/support';

/**
 * Admin support console page.
 * Two views: session list (default) and active console (after joining).
 */
export default function AdminSupportPage() {
  const [sessions, setSessions] = useState<SupportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showFirmwarePicker, setShowFirmwarePicker] = useState(false);

  const console = useRemoteConsole({ sessionId: selectedSessionId });

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const data = await getActiveSessions();
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and realtime subscription
  useEffect(() => {
    fetchSessions();

    let unsubscribe: (() => void) | null = null;

    subscribeToSessionChanges(
      () => {
        // Refetch on any change
        fetchSessions();
      },
      undefined,
      (err) => {
        console.channelError; // just reference to suppress lint
        setError(err);
      },
    ).then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      unsubscribe?.();
    };
  }, [fetchSessions]);

  // Handle join
  const handleJoin = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    // The useRemoteConsole hook will handle the actual join
  };

  // After selecting session, join it
  useEffect(() => {
    if (selectedSessionId && !console.isJoined) {
      console.join();
    }
  }, [selectedSessionId, console.isJoined, console]);

  // Handle action (with firmware picker for flash)
  const handleAction = useCallback((type: ActionType, manifestUrl?: string) => {
    if (type === 'flash' && !manifestUrl) {
      setShowFirmwarePicker(true);
      return;
    }
    console.sendAction(type, manifestUrl);
  }, [console]);

  // Handle firmware version selection
  const handleFirmwareSelect = useCallback((manifestUrl: string) => {
    setShowFirmwarePicker(false);
    console.sendAction('flash', manifestUrl);
  }, [console]);

  // Back to session list
  const handleBack = useCallback(async () => {
    if (console.isJoined) {
      await console.leaveSession();
    }
    setSelectedSessionId(null);
  }, [console]);

  // Active console view
  if (selectedSessionId && console.isJoined) {
    return (
      <div className="h-[calc(100vh-120px)] flex flex-col">
        {/* Back button */}
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={handleBack}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Sessions
          </button>
          <span className="text-sm text-gray-400">
            Session: <code className="font-mono">{selectedSessionId.slice(0, 8)}</code>
          </span>
        </div>

        {/* Remote Terminal */}
        <div className="flex-1 min-h-0">
          <RemoteTerminal
            lines={console.terminalLines}
            bridgeHealth={console.bridgeHealth}
            flashProgress={console.flashProgress}
            commandHistory={console.commandHistory}
            onCommand={console.sendCommand}
            onAction={handleAction}
            onEndSession={() => console.endSession('admin_ended')}
            onClear={console.clearTerminal}
          />
        </div>

        {/* Firmware Version Picker Modal */}
        {showFirmwarePicker && (
          <FirmwareVersionPicker
            onSelect={handleFirmwareSelect}
            onCancel={() => setShowFirmwarePicker(false)}
          />
        )}
      </div>
    );
  }

  // Session list view
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Support Sessions
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Remote support sessions from users needing device assistance.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-500 dark:text-gray-400">No active support sessions.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Sessions will appear here when users request support.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${
                        session.status === 'waiting'
                          ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          session.status === 'waiting'
                            ? 'bg-yellow-500 animate-pulse'
                            : 'bg-green-500'
                        }`}
                      />
                      {session.status === 'waiting' ? 'Waiting' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-gray-600 dark:text-gray-400">
                      {session.id.slice(0, 8)}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {session.device_serial || session.device_chip || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {new Date(session.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleJoin(session.id)}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      {session.status === 'waiting' ? 'Join' : 'Rejoin'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
