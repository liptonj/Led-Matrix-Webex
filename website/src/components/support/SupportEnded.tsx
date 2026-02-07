'use client';

interface SupportEndedProps {
  reason?: string;
  onNewSession?: () => void;
}

/**
 * Session ended state.
 */
export function SupportEnded({ reason, onNewSession }: SupportEndedProps) {
  return (
    <div className="max-w-lg mx-auto mt-12 text-center">
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8">
        <div className="text-4xl mb-4">✅</div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Support Session Complete
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {reason === 'admin_ended'
            ? 'The technician ended the session.'
            : 'You can safely disconnect your device now.'}
        </p>
        {onNewSession && (
          <button
            onClick={onNewSession}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Start New Session
          </button>
        )}
      </div>
    </div>
  );
}
