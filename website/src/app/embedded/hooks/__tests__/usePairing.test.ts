/**
 * Tests for usePairing hook
 */
import { act, renderHook, waitFor } from '@testing-library/react';

import { usePairing, type UsePairingOptions } from '../usePairing';

// Mock Supabase client
const mockChannel = jest.fn().mockReturnValue({
  on: jest.fn().mockReturnThis(),
  subscribe: jest.fn((callback) => {
    callback('SUBSCRIBED');
    return { unsubscribe: jest.fn() };
  }),
});

const mockSupabaseClient = {
  channel: mockChannel,
  removeChannel: jest.fn(),
  removeAllChannels: jest.fn(),
  schema: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { device_last_seen: new Date().toISOString(), device_connected: true }, error: null }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          then: jest.fn((resolve) => resolve({ error: null })),
        }),
      }),
    }),
  }),
  realtime: { setAuth: jest.fn() },
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

// Mock fetch
global.fetch = jest.fn();

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

// Mock environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

describe('usePairing', () => {
  const mockAddLog = jest.fn();
  const defaultOptions: UsePairingOptions = { addLog: mockAddLog };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    (global.fetch as jest.Mock).mockReset();
  });

  describe('initial state', () => {
    it('starts with default state', () => {
      const { result } = renderHook(() => usePairing(defaultOptions));

      expect(result.current.isPaired).toBe(false);
      expect(result.current.isPeerConnected).toBe(false);
      expect(result.current.rtStatus).toBe('disconnected');
      expect(result.current.appToken).toBeNull();
      expect(result.current.pairingCode).toBe('');
      expect(result.current.connectionError).toBeNull();
    });
  });

  describe('setPairingCode', () => {
    it('updates pairing code', () => {
      const { result } = renderHook(() => usePairing(defaultOptions));

      act(() => {
        result.current.setPairingCode('TEST12');
      });

      expect(result.current.pairingCode).toBe('TEST12');
    });
  });

  describe('exchangePairingCode', () => {
    it('exchanges pairing code for token', async () => {
      const mockToken = {
        token: 'test-token',
        serial_number: 'TEST123',
        pairing_code: 'TEST12',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockToken),
      });

      const { result } = renderHook(() => usePairing(defaultOptions));

      let token;
      await act(async () => {
        token = await result.current.exchangePairingCode('TEST12');
      });

      expect(token).toEqual(mockToken);
      expect(result.current.appToken).toEqual(mockToken);
      expect(mockAddLog).toHaveBeenCalledWith('Authentication token obtained');
    });

    it('handles failed token exchange', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid code' }),
      });

      const { result } = renderHook(() => usePairing(defaultOptions));

      let token;
      await act(async () => {
        token = await result.current.exchangePairingCode('BADCODE');
      });

      expect(token).toBeNull();
      expect(mockAddLog).toHaveBeenCalledWith(expect.stringContaining('Token exchange failed'));
    });
  });

  describe('handleConnect', () => {
    it('requires a pairing code', async () => {
      const { result } = renderHook(() => usePairing(defaultOptions));

      await act(async () => {
        await result.current.handleConnect();
      });

      expect(result.current.connectionError).toBe('Please enter a pairing code');
    });

    it('connects with valid pairing code', async () => {
      const mockToken = {
        token: 'test-token',
        serial_number: 'TEST123',
        pairing_code: 'TEST12',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockToken),
      });

      const { result } = renderHook(() => usePairing(defaultOptions));

      act(() => {
        result.current.setPairingCode('TEST12');
      });

      await act(async () => {
        await result.current.handleConnect();
      });

      await waitFor(() => {
        expect(result.current.isPaired).toBe(true);
        expect(result.current.rtStatus).toBe('connected');
      });
    });
  });

  describe('handleDisconnect', () => {
    it('resets state on disconnect', async () => {
      const mockToken = {
        token: 'test-token',
        serial_number: 'TEST123',
        pairing_code: 'TEST12',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockToken),
      });

      const { result } = renderHook(() => usePairing(defaultOptions));

      act(() => {
        result.current.setPairingCode('TEST12');
      });

      await act(async () => {
        await result.current.handleConnect();
      });

      act(() => {
        result.current.handleDisconnect();
      });

      expect(result.current.isPaired).toBe(false);
      expect(result.current.isPeerConnected).toBe(false);
      expect(result.current.rtStatus).toBe('disconnected');
      expect(mockAddLog).toHaveBeenCalledWith('Disconnected');
    });
  });

  describe('shouldRefreshToken', () => {
    it('returns false for valid token', () => {
      const { result } = renderHook(() => usePairing(defaultOptions));

      const token = {
        token: 'test',
        serial_number: 'TEST123',
        device_id: 'webex-display-T123',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };

      expect(result.current.shouldRefreshToken(token)).toBe(false);
    });

    it('returns true for expiring token', () => {
      const { result } = renderHook(() => usePairing(defaultOptions));

      const token = {
        token: 'test',
        serial_number: 'TEST123',
        device_id: 'webex-display-T123',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };

      expect(result.current.shouldRefreshToken(token)).toBe(true);
    });
  });

  describe('updateAppStateViaEdge', () => {
    it('calls Edge Function with state data', async () => {
      const mockToken = {
        token: 'test-token',
        serial_number: 'TEST123',
        pairing_code: 'TEST12',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockToken) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ device_connected: true }) });

      const { result } = renderHook(() => usePairing(defaultOptions));

      act(() => {
        result.current.setPairingCode('TEST12');
      });

      await act(async () => {
        await result.current.handleConnect();
      });

      await act(async () => {
        const success = await result.current.updateAppStateViaEdge({ webex_status: 'active' });
        expect(success).toBe(true);
      });
    });
  });
});
