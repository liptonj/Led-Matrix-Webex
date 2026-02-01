import * as authModule from '@/lib/supabase/auth';
import * as coreModule from '@/lib/supabase/core';
import * as healthModule from '@/lib/supabase/health';
import * as usersModule from '@/lib/supabase/users';
import { renderHook, waitFor } from '@testing-library/react';
import { useAdminAuth } from '../useAdminAuth';

jest.mock('@/lib/supabase/auth');
jest.mock('@/lib/supabase/users');
jest.mock('@/lib/supabase/core');
jest.mock('@/lib/supabase/health');

const mockIsSupabaseConfigured = coreModule.isSupabaseConfigured as jest.MockedFunction<
  typeof coreModule.isSupabaseConfigured
>;
const mockGetSession = authModule.getSession as jest.MockedFunction<typeof authModule.getSession>;
const mockIsAdmin = authModule.isAdmin as jest.MockedFunction<typeof authModule.isAdmin>;
const mockGetCurrentUserProfile = usersModule.getCurrentUserProfile as jest.MockedFunction<
  typeof usersModule.getCurrentUserProfile
>;
const mockGetCachedSession = coreModule.getCachedSession as jest.MockedFunction<
  typeof coreModule.getCachedSession
>;
const mockOnAuthStateChange = authModule.onAuthStateChange as jest.MockedFunction<
  typeof authModule.onAuthStateChange
>;
const mockSignOut = authModule.signOut as jest.MockedFunction<typeof authModule.signOut>;
const mockCheckSupabaseHealth = healthModule.checkSupabaseHealth as jest.MockedFunction<
  typeof healthModule.checkSupabaseHealth
>;

const mockSession = {
  access_token: 'mock-token',
  refresh_token: 'mock-refresh',
  expires_at: Date.now() / 1000 + 3600,
  user: { id: 'user-1', email: 'test@example.com' },
};

const mockUserProfile = {
  user_id: 'user-1',
  email: 'test@example.com',
  role: 'admin' as const,
  first_name: 'Test',
  last_name: 'User',
  disabled: false,
  created_at: '2024-01-01T00:00:00Z',
  created_by: null,
};

describe('useAdminAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Default mocks
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockCheckSupabaseHealth.mockResolvedValue({ healthy: true, latency: 100 });
    mockGetCachedSession.mockReturnValue(null);
    mockOnAuthStateChange.mockResolvedValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    
    // Clear sessionStorage
    if (typeof window !== 'undefined') {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should initialize with loading state', () => {
    mockGetSession.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    const { result } = renderHook(() => useAdminAuth());

    expect(result.current.loading).toBe(true);
    expect(result.current.authenticated).toBe(false);
    expect(result.current.admin).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should handle successful authentication', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockResolvedValue(true);

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.authenticated).toBe(true);
    expect(result.current.admin).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should handle unauthenticated user', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.authenticated).toBe(false);
    expect(result.current.admin).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle disabled user', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue({ ...mockUserProfile, disabled: true });
    mockIsAdmin.mockResolvedValue(true);
    mockSignOut.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.authenticated).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.admin).toBe(false);
      expect(result.current.error).toBe('This account is disabled. Contact an administrator.');
    });
    
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('should handle Supabase not configured', async () => {
    mockIsSupabaseConfigured.mockReturnValue(false);

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Supabase is not configured. Admin features are disabled.');
  });

  it('should handle unhealthy Supabase connection', async () => {
    mockCheckSupabaseHealth.mockResolvedValue({ 
      healthy: false, 
      error: 'Connection timeout' 
    });

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Cannot connect to Supabase: Connection timeout');
  });

  it('should use cached session when available', async () => {
    mockGetCachedSession.mockReturnValue(mockSession);
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockResolvedValue(true);

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.authenticated).toBe(true);
    expect(mockGetCachedSession).toHaveBeenCalled();
  });

  it('should retry session check once if no session found', async () => {
    mockGetSession
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockResolvedValue(true);

    const { result } = renderHook(() => useAdminAuth());

    // Advance timers for retry delay
    jest.advanceTimersByTime(500);

    await waitFor(() => {
      expect(result.current.authenticated).toBe(true);
    });

    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it('should handle pending login flag', async () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('admin_login_in_progress', '1');
    }

    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockResolvedValue(true);

    const { result } = renderHook(() => useAdminAuth());

    jest.advanceTimersByTime(300);

    await waitFor(() => {
      expect(result.current.authenticated).toBe(true);
    });

    if (typeof window !== 'undefined') {
      expect(window.sessionStorage.getItem('admin_login_in_progress')).toBeNull();
    }
  });

  it('should handle profile check timeout', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockRejectedValue(new Error('Timed out'));
    mockIsAdmin.mockResolvedValue(true);

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should not sign out or show error on timeout
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(result.current.authenticated).toBe(true);
  });

  it('should handle admin check timeout', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockRejectedValue(new Error('Timed out'));

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.authenticated).toBe(true);
    expect(result.current.admin).toBeNull(); // Set to null on timeout
  });

  it('should handle profile check failure', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockRejectedValue(new Error('Database error'));
    mockIsAdmin.mockResolvedValue(true);

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.authenticated).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load your profile.');
    });
  });

  it('should handle auth check timeout', async () => {
    mockGetSession.mockImplementation(() => new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => useAdminAuth());

    // Advance to timeout
    jest.advanceTimersByTime(20000);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Auth check timed out. Please refresh or check your network.');
  });

  it('should cleanup on unmount', async () => {
    const mockUnsubscribe = jest.fn();
    mockOnAuthStateChange.mockResolvedValue({ 
      data: { subscription: { unsubscribe: mockUnsubscribe } } 
    });
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockResolvedValue(true);

    const { unmount } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(mockOnAuthStateChange).toHaveBeenCalled();
    });

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should handle auth state changes', async () => {
    let authCallback: ((event: string, session: typeof mockSession | null) => void) | undefined;
    
    mockOnAuthStateChange.mockImplementation(async (callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockResolvedValue(true);

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.authenticated).toBe(true);
    });

    // Simulate sign out
    await waitFor(() => {
      authCallback?.('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(result.current.authenticated).toBe(false);
    });
  });

  it('should ignore INITIAL_SESSION event until check completes', async () => {
    let authCallback: ((event: string, session: typeof mockSession | null) => void) | undefined;
    
    mockOnAuthStateChange.mockImplementation(async (callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockResolvedValue(true);

    renderHook(() => useAdminAuth());

    // Fire INITIAL_SESSION before check completes
    await waitFor(() => {
      authCallback?.('INITIAL_SESSION', mockSession);
    });

    // Should be ignored - no additional calls to hydrate
    expect(mockGetCurrentUserProfile).toHaveBeenCalledTimes(1);
  });

  it('should handle AbortError gracefully', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockGetSession.mockRejectedValue(abortError);

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      // Should not set error on abort
      expect(result.current.error).toBeNull();
    });
  });

  it('should continue authentication despite high latency', async () => {
    mockCheckSupabaseHealth.mockResolvedValue({ healthy: true, latency: 3000 });
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockGetCurrentUserProfile.mockResolvedValue(mockUserProfile);
    mockIsAdmin.mockResolvedValue(true);

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Even with high latency, auth should complete successfully
    expect(result.current.authenticated).toBe(true);
    expect(result.current.admin).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
