/**
 * Unit tests for useRemoteConsole hook
 *
 * Tests admin-side session ending behavior, including:
 * - session_end event handling from user broadcast
 * - endSession closing and notifying user
 * - onSessionEnded callback invocation
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useRemoteConsole } from '../useRemoteConsole';

// Mock Supabase support session functions
const mockJoinSupportSession = jest.fn();
const mockCloseSupportSession = jest.fn();
const mockRevertSessionToWaiting = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/lib/supabase/supportSessions', () => ({
  joinSupportSession: (...args: unknown[]) => mockJoinSupportSession(...args),
  closeSupportSession: (...args: unknown[]) => mockCloseSupportSession(...args),
  revertSessionToWaiting: (...args: unknown[]) => mockRevertSessionToWaiting(...args),
}));

jest.mock('@/lib/supabase/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

// Capture event handlers registered with useSupportChannel
let capturedEventHandlers: Record<string, (payload: Record<string, unknown>) => void> = {};
const mockChannelSend = jest.fn();
const mockUseSupportChannel = jest.fn();

jest.mock('../useSupportChannel', () => ({
  useSupportChannel: (opts: { sessionId: string | null; eventHandlers: Record<string, (payload: Record<string, unknown>) => void> }) => {
    capturedEventHandlers = opts.eventHandlers || {};
    mockUseSupportChannel(opts);
    return {
      isConnected: !!opts.sessionId,
      send: mockChannelSend,
      channelError: null,
    };
  },
}));

const mockAuthSession = {
  data: {
    session: {
      user: {
        id: 'admin-789',
      },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  capturedEventHandlers = {};

  mockJoinSupportSession.mockResolvedValue({
    id: 'session-123',
    status: 'active',
    admin_id: 'admin-789',
  });
  mockCloseSupportSession.mockResolvedValue(undefined);
  mockRevertSessionToWaiting.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValue(mockAuthSession);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useRemoteConsole', () => {
  describe('session_end event from user', () => {
    it('handles session_end broadcast by setting isJoined to false', async () => {
      const onSessionEnded = jest.fn();
      const { result } = renderHook(() =>
        useRemoteConsole({
          sessionId: 'session-123',
          onSessionEnded,
        }),
      );

      // Join session first
      await act(async () => {
        await result.current.join();
      });
      expect(result.current.isJoined).toBe(true);

      // Simulate session_end broadcast from user
      act(() => {
        capturedEventHandlers.session_end?.({ reason: 'user_ended' });
      });

      expect(result.current.isJoined).toBe(false);
    });

    it('invokes onSessionEnded callback when user ends session', async () => {
      const onSessionEnded = jest.fn();
      const { result } = renderHook(() =>
        useRemoteConsole({
          sessionId: 'session-123',
          onSessionEnded,
        }),
      );

      await act(async () => {
        await result.current.join();
      });

      act(() => {
        capturedEventHandlers.session_end?.({ reason: 'user_ended' });
      });

      expect(onSessionEnded).toHaveBeenCalledTimes(1);
    });

    it('adds terminal line when user ends session', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });

      act(() => {
        capturedEventHandlers.session_end?.({ reason: 'user_ended' });
      });

      const endLine = result.current.terminalLines.find(
        (line) => line.text.includes('Session ended by user'),
      );
      expect(endLine).toBeDefined();
      expect(endLine?.source).toBe('system');
    });

    it('resets bridge health when user ends session', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });

      act(() => {
        capturedEventHandlers.session_end?.({ reason: 'user_ended' });
      });

      expect(result.current.bridgeHealth).toBe('unknown');
    });
  });

  describe('endSession', () => {
    it('sends session_end broadcast to user', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });

      await act(async () => {
        await result.current.endSession('admin_ended');
      });

      expect(mockChannelSend).toHaveBeenCalledWith('session_end', { reason: 'admin_ended' });
    });

    it('closes the session in the database', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });

      await act(async () => {
        await result.current.endSession('admin_ended');
      });

      expect(mockCloseSupportSession).toHaveBeenCalledWith('session-123', 'admin_ended');
    });

    it('sets isJoined to false after ending', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });
      expect(result.current.isJoined).toBe(true);

      await act(async () => {
        await result.current.endSession('admin_ended');
      });

      expect(result.current.isJoined).toBe(false);
    });

    it('does nothing when no sessionId', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: null }),
      );

      await act(async () => {
        await result.current.endSession('admin_ended');
      });

      expect(mockCloseSupportSession).not.toHaveBeenCalled();
      expect(mockChannelSend).not.toHaveBeenCalled();
    });

    it('handles close errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockCloseSupportSession.mockRejectedValueOnce(new Error('Close failed'));

      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });

      await act(async () => {
        await result.current.endSession('admin_ended');
      });

      // Should still set isJoined to false even if DB close fails
      expect(result.current.isJoined).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('leaveSession', () => {
    it('reverts session to waiting status', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });

      await act(async () => {
        await result.current.leaveSession();
      });

      expect(mockRevertSessionToWaiting).toHaveBeenCalledWith('session-123');
    });

    it('sets isJoined to false after leaving', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });
      expect(result.current.isJoined).toBe(true);

      await act(async () => {
        await result.current.leaveSession();
      });

      expect(result.current.isJoined).toBe(false);
    });
  });

  describe('join', () => {
    it('joins session and sets isJoined to true', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      let success: boolean;
      await act(async () => {
        success = await result.current.join();
      });

      expect(success!).toBe(true);
      expect(result.current.isJoined).toBe(true);
      expect(mockJoinSupportSession).toHaveBeenCalledWith('session-123', 'admin-789');
    });

    it('returns false when no sessionId', async () => {
      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: null }),
      );

      let success: boolean;
      await act(async () => {
        success = await result.current.join();
      });

      expect(success!).toBe(false);
      expect(result.current.isJoined).toBe(false);
    });

    it('handles join errors', async () => {
      mockJoinSupportSession.mockRejectedValueOnce(new Error('Join failed'));

      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      let success: boolean;
      await act(async () => {
        success = await result.current.join();
      });

      expect(success!).toBe(false);
      expect(result.current.isJoined).toBe(false);
      expect(result.current.joinError).toBe('Join failed');
    });
  });

  describe('beforeunload cleanup', () => {
    it('reverts session to waiting on beforeunload when joined', async () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

      const { result } = renderHook(() =>
        useRemoteConsole({ sessionId: 'session-123' }),
      );

      await act(async () => {
        await result.current.join();
      });

      // Find the latest beforeunload handler (registered after isJoined became true)
      const beforeUnloadCalls = addEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'beforeunload',
      );
      const handler = beforeUnloadCalls[beforeUnloadCalls.length - 1]?.[1] as () => void;

      expect(handler).toBeDefined();

      act(() => {
        handler();
      });

      await waitFor(() => {
        expect(mockRevertSessionToWaiting).toHaveBeenCalledWith('session-123');
      });

      addEventListenerSpy.mockRestore();
    });
  });
});
