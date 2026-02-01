/**
 * Unit tests for useWebexStatus hook
 * 
 * Tests Webex token management, API polling, OAuth flow, and status normalization.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

import { useWebexStatus, type UseWebexStatusOptions } from '../useWebexStatus';

// Store original env
const originalEnv = process.env;

describe('useWebexStatus hook', () => {
  const mockAddLog = jest.fn();

  const mockToken = {
    serial_number: 'A1B2C3D4',
    device_id: 'webex-display-C3D4',
    token: 'test-app-token',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  const defaultOptions: UseWebexStatusOptions = {
    appToken: mockToken,
    isPaired: true,
    addLog: mockAddLog,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    };
    
    jest.clearAllMocks();
    (global.fetch as jest.Mock) = jest.fn();
    
    // Mock localStorage
    const localStorageMock = {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    process.env = originalEnv;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('normalizeWebexStatus', () => {
    it('should normalize standard status strings', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.normalizeWebexStatus('active')).toBe('active');
      expect(result.current.normalizeWebexStatus('available')).toBe('active');
      expect(result.current.normalizeWebexStatus('meeting')).toBe('meeting');
      expect(result.current.normalizeWebexStatus('call')).toBe('call');
      expect(result.current.normalizeWebexStatus('busy')).toBe('busy');
      expect(result.current.normalizeWebexStatus('presenting')).toBe('presenting');
      expect(result.current.normalizeWebexStatus('dnd')).toBe('dnd');
      expect(result.current.normalizeWebexStatus('donotdisturb')).toBe('dnd');
      expect(result.current.normalizeWebexStatus('away')).toBe('away');
      expect(result.current.normalizeWebexStatus('inactive')).toBe('away');
      expect(result.current.normalizeWebexStatus('brb')).toBe('away');
      expect(result.current.normalizeWebexStatus('offline')).toBe('offline');
      expect(result.current.normalizeWebexStatus('outofoffice')).toBe('ooo');
      expect(result.current.normalizeWebexStatus('ooo')).toBe('ooo');
      expect(result.current.normalizeWebexStatus('pending')).toBe('pending');
    });

    it('should handle case insensitivity', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.normalizeWebexStatus('ACTIVE')).toBe('active');
      expect(result.current.normalizeWebexStatus('Active')).toBe('active');
      expect(result.current.normalizeWebexStatus('DND')).toBe('dnd');
      expect(result.current.normalizeWebexStatus('DoNotDisturb')).toBe('dnd');
    });

    it('should handle whitespace', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.normalizeWebexStatus('  active  ')).toBe('active');
      expect(result.current.normalizeWebexStatus('\taway\n')).toBe('away');
    });

    it('should return unknown for unrecognized status', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.normalizeWebexStatus('unknown_status')).toBe('unknown');
      expect(result.current.normalizeWebexStatus('foo')).toBe('unknown');
      expect(result.current.normalizeWebexStatus('bar')).toBe('unknown');
    });

    it('should handle null and undefined', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.normalizeWebexStatus(null)).toBe('unknown');
      expect(result.current.normalizeWebexStatus(undefined)).toBe('unknown');
      expect(result.current.normalizeWebexStatus('')).toBe('unknown');
    });
  });

  describe('shouldRefreshWebexToken', () => {
    it('should return true when token is within refresh threshold', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      // Token expires in 3 minutes (within 5 min threshold)
      const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
      expect(result.current.shouldRefreshWebexToken(expiresAt)).toBe(true);
    });

    it('should return false when token is outside refresh threshold', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      // Token expires in 30 minutes (outside 5 min threshold)
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      expect(result.current.shouldRefreshWebexToken(expiresAt)).toBe(false);
    });

    it('should return true when expiresAt is null', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.shouldRefreshWebexToken(null)).toBe(true);
    });

    it('should return true when token is expired', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      // Token expired 5 minutes ago
      const expiresAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(result.current.shouldRefreshWebexToken(expiresAt)).toBe(true);
    });
  });

  describe('fetchWebexToken', () => {
    it('should fetch Webex token from backend', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'webex-access-token',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });

      // Use isPaired: false to prevent automatic polling from consuming the mock
      const { result } = renderHook(() => useWebexStatus({ ...defaultOptions, isPaired: false }));

      let token;
      await act(async () => {
        token = await result.current.fetchWebexToken();
      });

      expect(token).toBe('webex-access-token');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/webex-token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-app-token',
          },
        })
      );
      expect(result.current.webexToken).toBe('webex-access-token');
      expect(result.current.webexTokenExpiresAt).not.toBeNull();
    });

    it('should return null when appToken is null', async () => {
      const options = { ...defaultOptions, appToken: null };
      const { result } = renderHook(() => useWebexStatus(options));

      let token;
      await act(async () => {
        token = await result.current.fetchWebexToken();
      });

      expect(token).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle fetch failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Token not found' }),
      });

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      let token;
      await act(async () => {
        token = await result.current.fetchWebexToken();
      });

      expect(token).toBeNull();
      expect(mockAddLog).toHaveBeenCalledWith('webex-token failed: Token not found');
    });

    it('should handle network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      let token;
      await act(async () => {
        token = await result.current.fetchWebexToken();
      });

      expect(token).toBeNull();
      expect(mockAddLog).toHaveBeenCalledWith('webex-token error: Network error');
    });

    it('should return null when Supabase URL not configured', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = '';

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      let token;
      await act(async () => {
        token = await result.current.fetchWebexToken();
      });

      expect(token).toBeNull();
    });
  });

  describe('ensureWebexToken', () => {
    it('should return cached token if still valid', async () => {
      // First fetch to get token
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'webex-access-token',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      // First call - fetches token
      await act(async () => {
        await result.current.fetchWebexToken();
      });

      (global.fetch as jest.Mock).mockClear();

      // Second call - should use cached token
      let token;
      await act(async () => {
        token = await result.current.ensureWebexToken();
      });

      expect(token).toBe('webex-access-token');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should refresh token if near expiry', async () => {
      // First fetch with near-expiry token
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'old-token',
          expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(), // 3 min
        }),
      });

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      await act(async () => {
        await result.current.fetchWebexToken();
      });

      // Second fetch for refresh
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-token',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });

      let token;
      await act(async () => {
        token = await result.current.ensureWebexToken();
      });

      expect(token).toBe('new-token');
    });

    it('should return null when appToken is null', async () => {
      const options = { ...defaultOptions, appToken: null };
      const { result } = renderHook(() => useWebexStatus(options));

      let token;
      await act(async () => {
        token = await result.current.ensureWebexToken();
      });

      expect(token).toBeNull();
    });
  });

  describe('pollWebexStatus', () => {
    it('should poll Webex API and update status', async () => {
      // Provide 4 mocks: 2 for initial effect poll (token + api) and 2 for manual call
      (global.fetch as jest.Mock)
        // Initial poll from effect
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'webex-access-token',
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            status: 'active',
          }),
        });

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      // Wait for initial poll to complete
      await waitFor(() => {
        expect(result.current.apiWebexStatus).toBe('active');
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://webexapis.com/v1/people/me',
        expect.objectContaining({
          headers: { Authorization: 'Bearer webex-access-token' },
        })
      );
    });

    it('should handle API error response', async () => {
      // Mocks: token + failed API response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'webex-access-token',
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ message: 'Unauthorized' }),
        });

      renderHook(() => useWebexStatus(defaultOptions));

      // Wait for the effect to run
      await waitFor(() => {
        expect(mockAddLog).toHaveBeenCalledWith('Webex API error: Unauthorized');
      });
    });

    it('should not poll when not paired', async () => {
      const options = { ...defaultOptions, isPaired: false };
      const { result } = renderHook(() => useWebexStatus(options));

      await act(async () => {
        await result.current.pollWebexStatus();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not poll when appToken is null', async () => {
      const options = { ...defaultOptions, appToken: null };
      const { result } = renderHook(() => useWebexStatus(options));

      await act(async () => {
        await result.current.pollWebexStatus();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should use various status field names from API', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'webex-access-token',
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            presence: 'dnd', // Alternative field name
          }),
        });

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      // Wait for the effect to poll and update status
      await waitFor(() => {
        expect(result.current.apiWebexStatus).toBe('dnd');
      });
    });
  });

  describe('startWebexOAuth', () => {
    it('should start OAuth flow and open auth URL', async () => {
      const mockWindowOpen = jest.fn();
      const originalWindowOpen = window.open;
      window.open = mockWindowOpen;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          auth_url: 'https://webexapis.com/v1/authorize?client_id=xxx',
        }),
      });

      // Use isPaired: false to prevent polling from consuming the mock
      const { result } = renderHook(() => useWebexStatus({ ...defaultOptions, isPaired: false }));

      await act(async () => {
        await result.current.startWebexOAuth();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/webex-oauth-start',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-app-token',
          },
        })
      );
      expect(mockWindowOpen).toHaveBeenCalledWith(
        'https://webexapis.com/v1/authorize?client_id=xxx',
        '_blank',
        'noopener,noreferrer'
      );
      expect(mockAddLog).toHaveBeenCalledWith('Opened Webex authorization flow.');

      window.open = originalWindowOpen;
    });

    it('should not start OAuth when appToken is null', async () => {
      const options = { ...defaultOptions, appToken: null };
      const { result } = renderHook(() => useWebexStatus(options));

      await act(async () => {
        await result.current.startWebexOAuth();
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockAddLog).toHaveBeenCalledWith('Missing app token - connect to the display first.');
    });

    it('should handle OAuth start failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'OAuth not configured' }),
      });

      // Use isPaired: false to prevent polling from consuming the mock
      const { result } = renderHook(() => useWebexStatus({ ...defaultOptions, isPaired: false }));

      await act(async () => {
        await result.current.startWebexOAuth();
      });

      expect(result.current.webexOauthStatus).toBe('error');
      expect(mockAddLog).toHaveBeenCalledWith('Webex OAuth start failed: OAuth not configured');
    });

    it('should set starting status during OAuth flow', async () => {
      let resolvePromise: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
      const pendingPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolvePromise = resolve;
      });

      const mockWindowOpen = jest.fn();
      window.open = mockWindowOpen;

      (global.fetch as jest.Mock).mockReturnValueOnce(pendingPromise);

      // Use isPaired: false to prevent polling from consuming the mock
      const { result } = renderHook(() => useWebexStatus({ ...defaultOptions, isPaired: false }));

      // Start OAuth
      let oauthPromise: Promise<void>;
      act(() => {
        oauthPromise = result.current.startWebexOAuth();
      });

      await waitFor(() => {
        expect(result.current.webexOauthStatus).toBe('starting');
      });

      // Complete OAuth
      await act(async () => {
        resolvePromise({
          ok: true,
          json: () => Promise.resolve({ auth_url: 'https://example.com' }),
        });
        await oauthPromise;
      });

      expect(result.current.webexOauthStatus).toBe('idle');
    });
  });

  describe('poll interval', () => {
    it('should poll at configured interval when paired', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'token',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          status: 'active',
        }),
      });

      renderHook(() => useWebexStatus(defaultOptions));

      // Initial poll
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      (global.fetch as jest.Mock).mockClear();

      // Advance to next poll interval (30s)
      await act(async () => {
        jest.advanceTimersByTime(30 * 1000);
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    it('should not poll when interval is less than 5000ms', async () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      act(() => {
        result.current.setWebexPollIntervalMs(1000);
      });

      (global.fetch as jest.Mock).mockClear();

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      // Should not have polled because interval is too short
      const webexApiCalls = (global.fetch as jest.Mock).mock.calls.filter(
        (call: unknown[]) => (call[0] as string)?.includes('webexapis.com')
      );
      expect(webexApiCalls.length).toBe(0);
    });

    it('should update poll interval', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      act(() => {
        result.current.setWebexPollIntervalMs(60000);
      });

      expect(result.current.webexPollIntervalMs).toBe(60000);
    });

    it('should persist poll interval to localStorage', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      act(() => {
        result.current.setWebexPollIntervalMs(45000);
      });

      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'led_matrix_webex_poll_interval',
        '45000'
      );
    });

    it('should load poll interval from localStorage on mount', () => {
      (window.localStorage.getItem as jest.Mock).mockReturnValue('60000');

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.webexPollIntervalMs).toBe(60000);
    });

    it('should ignore invalid localStorage poll interval', () => {
      (window.localStorage.getItem as jest.Mock).mockReturnValue('invalid');

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.webexPollIntervalMs).toBe(60000); // Default
    });

    it('should ignore poll interval less than 5000ms from localStorage', () => {
      (window.localStorage.getItem as jest.Mock).mockReturnValue('1000');

      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.webexPollIntervalMs).toBe(60000); // Default
    });
  });

  describe('initial state', () => {
    it('should have null token values initially', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.webexToken).toBeNull();
      expect(result.current.webexTokenExpiresAt).toBeNull();
      expect(result.current.apiWebexStatus).toBeNull();
    });

    it('should have idle OAuth status initially', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.webexOauthStatus).toBe('idle');
    });

    it('should have default poll interval', () => {
      const { result } = renderHook(() => useWebexStatus(defaultOptions));

      expect(result.current.webexPollIntervalMs).toBe(60000);
    });
  });
});
