/**
 * Unit tests for useSupportSession hook
 *
 * Tests support session creation, closing, device info updates,
 * and lifecycle management.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useSupportSession } from '../useSupportSession';
import { spyOnConsole } from '@/test-utils/setup';

// Mock Supabase helpers
const mockCreateSupportSession = jest.fn();
const mockCloseSupportSession = jest.fn();
const mockGetUserSession = jest.fn();
const mockUpdateSessionDeviceInfo = jest.fn();
const mockCleanupStaleSessions = jest.fn();
const mockGetSession = jest.fn();

// Mock channel for the realtime subscription
const mockChannel = {
  on: jest.fn().mockReturnThis(),
  subscribe: jest.fn().mockReturnThis(),
};
const mockRemoveChannel = jest.fn();
const mockSupabaseClient = {
  channel: jest.fn().mockReturnValue(mockChannel),
  removeChannel: mockRemoveChannel,
};
const mockGetSupabase = jest.fn();

jest.mock('@/lib/supabase/supportSessions', () => ({
  createSupportSession: (...args: unknown[]) => mockCreateSupportSession(...args),
  closeSupportSession: (...args: unknown[]) => mockCloseSupportSession(...args),
  getUserSession: (...args: unknown[]) => mockGetUserSession(...args),
  updateSessionDeviceInfo: (...args: unknown[]) => mockUpdateSessionDeviceInfo(...args),
  cleanupStaleSessions: (...args: unknown[]) => mockCleanupStaleSessions(...args),
}));

jest.mock('@/lib/supabase/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

jest.mock('@/lib/supabase/core', () => ({
  getSupabase: (...args: unknown[]) => mockGetSupabase(...args),
}));

const mockSession = {
  id: 'session-123',
  user_id: 'user-456',
  admin_id: null,
  status: 'waiting' as const,
  device_serial: null,
  device_chip: null,
  device_firmware: null,
  created_at: '2026-02-07T12:00:00Z',
  joined_at: null,
  closed_at: null,
  close_reason: null,
};

const mockAuthSession = {
  data: {
    session: {
      user: {
        id: 'user-456',
      },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  
  // Default mock implementations
  mockCreateSupportSession.mockResolvedValue(mockSession);
  mockCloseSupportSession.mockResolvedValue(undefined);
  mockGetUserSession.mockResolvedValue(null);
  mockUpdateSessionDeviceInfo.mockResolvedValue(undefined);
  mockCleanupStaleSessions.mockResolvedValue(0);
  mockGetSession.mockResolvedValue(mockAuthSession);

  // Reset channel mock chain for realtime subscription
  mockChannel.on.mockReturnThis();
  mockChannel.subscribe.mockReturnThis();
  mockSupabaseClient.channel.mockReturnValue(mockChannel);
  mockGetSupabase.mockResolvedValue(mockSupabaseClient);
});

describe('useSupportSession', () => {
  let consoleSpy: { error: jest.SpyInstance; warn: jest.SpyInstance };

  beforeEach(() => {
    // Suppress expected console warnings from error scenarios
    consoleSpy = spyOnConsole(['[useSupportSession]']);
  });

  afterEach(() => {
    consoleSpy.error.mockRestore();
    consoleSpy.warn.mockRestore();
  });

  describe('initial state', () => {
    it('initializes with no session', () => {
      const { result } = renderHook(() => useSupportSession());
      
      expect(result.current.session).toBeNull();
      expect(result.current.sessionStatus).toBeNull();
      expect(result.current.isCreating).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('provides all required functions', () => {
      const { result } = renderHook(() => useSupportSession());
      
      expect(typeof result.current.create).toBe('function');
      expect(typeof result.current.close).toBe('function');
      expect(typeof result.current.updateDeviceInfo).toBe('function');
      expect(typeof result.current.setSession).toBe('function');
    });
  });

  describe('create', () => {
    it('creates a new session successfully', async () => {
      const { result } = renderHook(() => useSupportSession());

      let session: unknown;
      await act(async () => {
        session = await result.current.create();
      });

      expect(mockGetSession).toHaveBeenCalled();
      expect(mockCreateSupportSession).toHaveBeenCalledWith('user-456');
      expect(session).toEqual(mockSession);
      expect(result.current.session).toEqual(mockSession);
      expect(result.current.sessionStatus).toBe('waiting');
      expect(result.current.isCreating).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('sets isCreating during creation', async () => {
      let resolveCreate: (value: unknown) => void;
      const createPromise = new Promise((resolve) => {
        resolveCreate = resolve;
      });
      mockCreateSupportSession.mockReturnValueOnce(createPromise);

      const { result } = renderHook(() => useSupportSession());

      act(() => {
        result.current.create();
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(true);
      });

      await act(async () => {
        resolveCreate!(mockSession);
        await createPromise;
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });
    });

    it('handles creation errors', async () => {
      const error = new Error('Failed to create session');
      mockCreateSupportSession.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      expect(result.current.session).toBeNull();
      expect(result.current.error).toBe('Failed to create session');
      expect(result.current.isCreating).toBe(false);
    });

    it('handles missing auth session', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
      });

      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      expect(mockCreateSupportSession).not.toHaveBeenCalled();
      expect(result.current.session).toBeNull();
      expect(result.current.error).toBe('You must be logged in to create a support session.');
    });

    it('handles auth errors', async () => {
      mockGetSession.mockRejectedValueOnce(new Error('Auth error'));

      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      expect(result.current.session).toBeNull();
      expect(result.current.error).toBeDefined();
    });
  });

  describe('close', () => {
    it('closes a session successfully', async () => {
      const { result } = renderHook(() => useSupportSession());

      // Create first
      await act(async () => {
        await result.current.create();
      });

      expect(result.current.session).not.toBeNull();

      // Close
      await act(async () => {
        await result.current.close('user_ended');
      });

      expect(mockCloseSupportSession).toHaveBeenCalledWith('session-123', 'user_ended');
      expect(result.current.session?.status).toBe('closed');
      expect(result.current.session?.close_reason).toBe('user_ended');
      expect(result.current.session?.closed_at).toBeDefined();
    });

    it('does nothing when no session exists', async () => {
      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.close('user_ended');
      });

      expect(mockCloseSupportSession).not.toHaveBeenCalled();
    });

    it('handles close errors', async () => {
      const error = new Error('Failed to close');
      mockCloseSupportSession.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      await act(async () => {
        await result.current.close('user_ended');
      });

      expect(result.current.error).toBe('Failed to close');
    });
  });

  describe('updateDeviceInfo', () => {
    it('updates device info successfully', async () => {
      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      await act(async () => {
        await result.current.updateDeviceInfo({
          device_serial: 'ABC123',
          device_chip: 'ESP32-S3',
        });
      });

      expect(mockUpdateSessionDeviceInfo).toHaveBeenCalledWith('session-123', {
        device_serial: 'ABC123',
        device_chip: 'ESP32-S3',
      });

      expect(result.current.session?.device_serial).toBe('ABC123');
      expect(result.current.session?.device_chip).toBe('ESP32-S3');
    });

    it('updates firmware version', async () => {
      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      await act(async () => {
        await result.current.updateDeviceInfo({
          device_firmware: '1.0.0',
        });
      });

      expect(result.current.session?.device_firmware).toBe('1.0.0');
    });

    it('does nothing when no session exists', async () => {
      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.updateDeviceInfo({
          device_serial: 'ABC123',
        });
      });

      expect(mockUpdateSessionDeviceInfo).not.toHaveBeenCalled();
    });

    it('handles update errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockUpdateSessionDeviceInfo.mockRejectedValueOnce(new Error('Update failed'));

      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      await act(async () => {
        await result.current.updateDeviceInfo({
          device_serial: 'ABC123',
        });
      });

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('setSession', () => {
    it('sets session from external source', () => {
      const { result } = renderHook(() => useSupportSession());

      const externalSession = {
        ...mockSession,
        id: 'ext-session',
        admin_id: 'admin-789',
        status: 'active' as const,
        joined_at: '2026-02-07T12:05:00Z',
      };

      act(() => {
        result.current.setSession(externalSession);
      });

      expect(result.current.session?.id).toBe('ext-session');
      expect(result.current.sessionStatus).toBe('active');
      expect(result.current.session?.admin_id).toBe('admin-789');
    });

    it('clears session when set to null', () => {
      const { result } = renderHook(() => useSupportSession());

      act(() => {
        result.current.setSession(mockSession);
      });

      expect(result.current.session).not.toBeNull();

      act(() => {
        result.current.setSession(null);
      });

      expect(result.current.session).toBeNull();
      expect(result.current.sessionStatus).toBeNull();
    });
  });

  describe('initialization', () => {
    it('checks for existing session on mount', async () => {
      mockGetUserSession.mockResolvedValueOnce(mockSession);

      const { result } = renderHook(() => useSupportSession());

      await waitFor(() => {
        expect(mockCleanupStaleSessions).toHaveBeenCalled();
        expect(mockGetSession).toHaveBeenCalled();
        expect(mockGetUserSession).toHaveBeenCalledWith('user-456');
      });

      await waitFor(() => {
        expect(result.current.session).toEqual(mockSession);
      });
    });

    it('handles initialization errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      // cleanupStaleSessions errors are swallowed by .catch(() => {}),
      // so we need to make getSession fail to trigger the outer catch
      mockGetSession.mockRejectedValueOnce(new Error('Auth init failed'));

      renderHook(() => useSupportSession());

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      consoleErrorSpy.mockRestore();
    });

    it('does not set session if component unmounts during init', async () => {
      let resolveGetUserSession: (value: unknown) => void;
      const getUserSessionPromise = new Promise((resolve) => {
        resolveGetUserSession = resolve;
      });
      mockGetUserSession.mockReturnValueOnce(getUserSessionPromise);

      const { result, unmount } = renderHook(() => useSupportSession());

      unmount();

      await act(async () => {
        resolveGetUserSession!(mockSession);
        await getUserSessionPromise;
      });

      // Session should not be set after unmount
      expect(result.current.session).toBeNull();
    });
  });

  describe('beforeunload cleanup', () => {
    it('sets up beforeunload handler', () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useSupportSession());

      expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('attempts to close session on beforeunload', async () => {
      // Spy BEFORE rendering so we capture the listener added by useEffect
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      // Get the beforeunload handler that was registered during mount
      const handler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'beforeunload'
      )?.[1] as () => void;

      expect(handler).toBeDefined();

      act(() => {
        handler();
      });

      // Should attempt to close (best-effort on page unload)
      await waitFor(() => {
        expect(mockCloseSupportSession).toHaveBeenCalledWith('session-123', 'page_unload');
      });

      addEventListenerSpy.mockRestore();
    });

    it('does not close already closed sessions on beforeunload', async () => {
      // Spy BEFORE rendering so we capture the listener added by useEffect
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

      const { result } = renderHook(() => useSupportSession());

      // Create session first (separate act to flush state/effects)
      await act(async () => {
        await result.current.create();
      });

      expect(result.current.session?.status).toBe('waiting');

      // Then close it (separate act to flush state/effects and update ref)
      await act(async () => {
        await result.current.close('user_ended');
      });

      expect(result.current.session?.status).toBe('closed');

      const handler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'beforeunload'
      )?.[1] as () => void;

      expect(handler).toBeDefined();

      mockCloseSupportSession.mockClear();

      act(() => {
        handler();
      });

      // Should not attempt to close again since session.status === 'closed'
      expect(mockCloseSupportSession).not.toHaveBeenCalled();

      addEventListenerSpy.mockRestore();
    });
  });

  describe('sessionStatus', () => {
    it('returns null when no session', () => {
      const { result } = renderHook(() => useSupportSession());
      expect(result.current.sessionStatus).toBeNull();
    });

    it('returns session status when session exists', async () => {
      const { result } = renderHook(() => useSupportSession());

      await act(async () => {
        await result.current.create();
      });

      expect(result.current.sessionStatus).toBe('waiting');

      await act(async () => {
        await result.current.close('user_ended');
      });

      expect(result.current.sessionStatus).toBe('closed');
    });
  });
});
