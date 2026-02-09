/**
 * Provision Token Utility Tests
 *
 * Unit tests for provision token management utilities.
 * Tests verify token creation, polling for device approval, and token deletion.
 */

import { getSession } from '@/lib/supabase/auth';
import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  getSupabase,
  withTimeout,
} from '@/lib/supabase/core';
import {
  createProvisionToken,
  deleteProvisionToken,
  waitForDeviceApproval,
} from '../provisionToken';
import type { Device } from '@/lib/supabase/types';
import { spyOnConsole } from '@/test-utils/setup';

// Mock dependencies
jest.mock('@/lib/supabase/auth');
jest.mock('@/lib/supabase/core');

// Mock crypto.randomUUID
const mockRandomUUID = jest.fn();
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: mockRandomUUID,
  },
  writable: true,
});

describe('provisionToken utilities', () => {
  const mockUserId = 'user-123';
  const mockToken = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
  const mockSession = {
    user: {
      id: mockUserId,
      email: 'test@example.com',
    },
    access_token: 'token',
    refresh_token: 'refresh',
  };

  let mockSupabaseClient: {
    schema: jest.Mock;
  };
  let mockQueryBuilder: {
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    insert: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup mock query builder chain
    mockQueryBuilder = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      delete: jest.fn(function(this: any) {
        // When delete() is called, track how many eq() calls follow
        let eqCallCount = 0;
        const originalEq = this.eq;
        
        // Override eq to count calls and resolve on the last one
        this.eq = jest.fn(function(this: any, ...args: any[]) {
          eqCallCount++;
          // After 2 eq() calls, resolve (for .eq('token', ...).eq('user_id', ...))
          if (eqCallCount >= 2) {
            return Promise.resolve({ data: null, error: null });
          }
          return this;
        });
        return this;
      }),
    };

    mockSupabaseClient = {
      schema: jest.fn(() => ({
        from: jest.fn(() => mockQueryBuilder),
      })),
    };

    // Default mocks
    (getSession as jest.Mock).mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });
    (getSupabase as jest.Mock).mockResolvedValue(mockSupabaseClient);
    (withTimeout as jest.Mock).mockImplementation((promise) => promise);
    mockRandomUUID.mockReturnValue('a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createProvisionToken', () => {
    let consoleSpy: { error: jest.SpyInstance; warn: jest.SpyInstance };

    beforeEach(() => {
      // Suppress expected console warnings from error scenarios
      consoleSpy = spyOnConsole(['[createProvisionToken]']);
    });

    afterEach(() => {
      consoleSpy.error.mockRestore();
      consoleSpy.warn.mockRestore();
    });

    it('generates a 32-character token', async () => {
      mockQueryBuilder.insert.mockResolvedValue({
        data: null,
        error: null,
      });

      const token = await createProvisionToken();

      expect(token).toBe(mockToken);
      expect(token).toHaveLength(32);
      expect(mockRandomUUID).toHaveBeenCalled();
    });

    it('returns null when user is not authenticated', async () => {
      (getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const token = await createProvisionToken();

      expect(token).toBeNull();
      expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
    });

    it('returns null when session error occurs', async () => {
      (getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: new Error('Session error'),
      });

      const token = await createProvisionToken();

      expect(token).toBeNull();
      expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
    });

    it('returns null when user ID is missing', async () => {
      (getSession as jest.Mock).mockResolvedValue({
        data: {
          session: {
            ...mockSession,
            user: null,
          },
        },
        error: null,
      });

      const token = await createProvisionToken();

      expect(token).toBeNull();
      expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
    });

    it('inserts token into database', async () => {
      mockQueryBuilder.insert.mockResolvedValue({
        data: null,
        error: null,
      });

      const token = await createProvisionToken();

      expect(token).toBe(mockToken);
      expect(mockSupabaseClient.schema).toHaveBeenCalledWith('display');
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        token: mockToken,
        user_id: mockUserId,
      });
      expect(withTimeout).toHaveBeenCalledWith(
        expect.any(Promise),
        SUPABASE_REQUEST_TIMEOUT_MS,
        'Timed out while creating provision token.',
      );
    });

    it('returns null on database error', async () => {
      const dbError = { code: 'PGRST999', message: 'Database error' };
      mockQueryBuilder.insert.mockResolvedValue({
        data: null,
        error: dbError,
      });

      const token = await createProvisionToken();

      expect(token).toBeNull();
    });

    it('returns null on unexpected error', async () => {
      (getSupabase as jest.Mock).mockRejectedValue(new Error('Unexpected error'));

      const token = await createProvisionToken();

      expect(token).toBeNull();
    });

    it('handles timeout errors gracefully', async () => {
      (withTimeout as jest.Mock).mockRejectedValue(
        new Error('Timed out while creating provision token.'),
      );

      const token = await createProvisionToken();

      expect(token).toBeNull();
    });
  });

  describe('waitForDeviceApproval', () => {
    const mockDevice: Device = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      serial_number: 'A1B2C3D4',
      device_id: 'webex-display-C3D4',
      pairing_code: 'ABC123',
      display_name: 'Test Device',
      firmware_version: '1.0.0',
      target_firmware_version: null,
      ip_address: '192.168.1.100',
      last_seen: '2024-01-26T00:00:00Z',
      debug_enabled: false,
      is_provisioned: true,
      approval_required: false,
      disabled: false,
      blacklisted: false,
      registered_at: '2024-01-25T00:00:00Z',
      provisioned_at: null,
      metadata: {},
      release_channel: 'production',
    };

    let consoleSpy: { error: jest.SpyInstance; warn: jest.SpyInstance };

    beforeEach(() => {
      // Suppress expected console warnings from timeout/abort/error scenarios
      consoleSpy = spyOnConsole([
        '[waitForDeviceApproval]',
      ]);

      // Setup default query builder for device queries
      mockQueryBuilder.limit.mockResolvedValue({
        data: [],
        error: null,
      });
      
      // Mock Date.now to work with fake timers
      const realDateNow = Date.now;
      const startTime = realDateNow();
      jest.spyOn(Date, 'now').mockImplementation(() => startTime + jest.now());
    });
    
    afterEach(() => {
      consoleSpy.error.mockRestore();
      consoleSpy.warn.mockRestore();
      jest.spyOn(Date, 'now').mockRestore();
    });

    it('polls for device approval and returns device when found', async () => {
      // First poll returns empty, second poll returns device
      mockQueryBuilder.limit
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [mockDevice],
          error: null,
        });

      const promise = waitForDeviceApproval(mockUserId, 10000);

      // Advance time by 2 seconds (poll interval)
      jest.advanceTimersByTime(2000);
      await jest.runAllTimersAsync();

      const device = await promise;

      expect(device).toEqual(mockDevice);
      expect(mockQueryBuilder.limit).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_approved_by', mockUserId);
      expect(mockQueryBuilder.order).toHaveBeenCalledWith('registered_at', {
        ascending: false,
      });
    }, 15000);

    it('returns null on timeout', async () => {
      mockQueryBuilder.limit.mockResolvedValue({
        data: [],
        error: null,
      });

      const promise = waitForDeviceApproval(mockUserId, 5000);

      // Let initial poll start
      await Promise.resolve();
      
      // Advance time past timeout
      jest.advanceTimersByTime(5500);
      await jest.runAllTimersAsync();

      const device = await promise;

      expect(device).toBeNull();
      // Should have polled at least once before timing out
      expect(mockQueryBuilder.limit).toHaveBeenCalled();
    }, 15000);

    it('handles abort signals passed to withTimeout', async () => {
      mockQueryBuilder.limit.mockResolvedValue({
        data: [],
        error: null,
      });

      // Simulate abort by making withTimeout reject with AbortError when signal is aborted
      (withTimeout as jest.Mock).mockImplementation((promise, timeout, message, signal) => {
        if (signal?.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        return promise;
      });

      const promise = waitForDeviceApproval(mockUserId, 60000);

      // Process initial poll
      await Promise.resolve();

      // Advance time by 2 seconds
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      // The function should handle abort errors gracefully
      // Since the function creates its own AbortController internally,
      // we verify that abort errors from withTimeout are handled
      expect(mockQueryBuilder.limit).toHaveBeenCalled();

      // Advance time past timeout to resolve
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      const device = await promise;
      expect(device).toBeNull();
    });

    it('polls every 2 seconds', async () => {
      mockQueryBuilder.limit.mockResolvedValue({
        data: [],
        error: null,
      });

      const promise = waitForDeviceApproval(mockUserId, 10000);

      // Advance time by 2 seconds - should trigger second poll
      jest.advanceTimersByTime(2000);
      await jest.runAllTimersAsync();

      // Advance time by another 2 seconds - should trigger third poll
      jest.advanceTimersByTime(2000);
      await jest.runAllTimersAsync();

      // Advance time by another 2 seconds - should trigger fourth poll
      jest.advanceTimersByTime(2000);
      await jest.runAllTimersAsync();

      // Advance time past timeout to resolve the promise
      jest.advanceTimersByTime(10000);
      await jest.runAllTimersAsync();

      const device = await promise;

      expect(device).toBeNull();
      // Verify polling occurred at 2-second intervals (initial + 3 more = at least 4)
      expect(mockQueryBuilder.limit.mock.calls.length).toBeGreaterThanOrEqual(4);
    }, 15000);

    it('returns device immediately if found on first poll', async () => {
      mockQueryBuilder.limit.mockResolvedValue({
        data: [mockDevice],
        error: null,
      });

      const promise = waitForDeviceApproval(mockUserId, 10000);

      // Don't advance time - should return immediately
      const device = await promise;

      expect(device).toEqual(mockDevice);
      expect(mockQueryBuilder.limit).toHaveBeenCalledTimes(1);
    });

    it('handles PGRST116 error (no rows found) gracefully', async () => {
      const pgrstError = { code: 'PGRST116', message: 'No rows found' };
      mockQueryBuilder.limit.mockResolvedValue({
        data: null,
        error: pgrstError,
      });

      const promise = waitForDeviceApproval(mockUserId, 5000);

      // Process initial poll
      await Promise.resolve();

      // Advance time and process
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      // Should continue polling despite PGRST116 error
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      const device = await promise;

      expect(device).toBeNull();
      expect(mockQueryBuilder.limit).toHaveBeenCalled();
    });

    it('handles other database errors', async () => {
      const dbError = { code: 'PGRST999', message: 'Database error' };
      mockQueryBuilder.limit.mockResolvedValue({
        data: null,
        error: dbError,
      });

      const promise = waitForDeviceApproval(mockUserId, 5000);

      // Process initial poll
      await Promise.resolve();

      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      const device = await promise;

      expect(device).toBeNull();
    });

    it('handles AbortError gracefully', async () => {
      (withTimeout as jest.Mock).mockRejectedValue(
        new DOMException('Aborted', 'AbortError'),
      );

      const promise = waitForDeviceApproval(mockUserId, 10000);

      // Process initial poll
      await Promise.resolve();

      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      const device = await promise;

      expect(device).toBeNull();
    });

    it('handles unexpected errors', async () => {
      (getSupabase as jest.Mock).mockRejectedValue(new Error('Unexpected error'));

      const promise = waitForDeviceApproval(mockUserId, 10000);

      // Process initial poll
      await Promise.resolve();

      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      const device = await promise;

      expect(device).toBeNull();
    });

    it('stops polling when timeout is reached', async () => {
      mockQueryBuilder.limit.mockResolvedValue({
        data: [],
        error: null,
      });

      const promise = waitForDeviceApproval(mockUserId, 3000);

      // Let initial poll start
      await Promise.resolve();

      // Advance past timeout
      jest.advanceTimersByTime(3500);
      await jest.runAllTimersAsync();

      const device = await promise;

      expect(device).toBeNull();
      expect(mockQueryBuilder.limit).toHaveBeenCalled();
    }, 15000);

    it('uses default timeout of 60 seconds', async () => {
      mockQueryBuilder.limit.mockResolvedValue({
        data: [],
        error: null,
      });

      const promise = waitForDeviceApproval(mockUserId);

      // Process initial poll
      await Promise.resolve();

      // Advance time but not past 60 seconds
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      // Advance time past timeout to resolve
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      const device = await promise;

      expect(device).toBeNull();
      expect(mockQueryBuilder.limit).toHaveBeenCalled();
    });
  });

  describe('deleteProvisionToken', () => {
    let consoleSpy: { error: jest.SpyInstance; warn: jest.SpyInstance };

    beforeEach(() => {
      // Suppress expected console warnings from error scenarios
      consoleSpy = spyOnConsole(['[deleteProvisionToken]']);
    });

    afterEach(() => {
      consoleSpy.error.mockRestore();
      consoleSpy.warn.mockRestore();
    });

    it('successfully deletes token and returns true', async () => {
      const result = await deleteProvisionToken(mockToken);

      expect(result).toBe(true);
      expect(mockSupabaseClient.schema).toHaveBeenCalledWith('display');
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('token', mockToken);
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', mockUserId);
      expect(withTimeout).toHaveBeenCalledWith(
        expect.any(Promise),
        SUPABASE_REQUEST_TIMEOUT_MS,
        'Timed out while deleting provision token.',
      );
    });

    it('returns false when user is not authenticated', async () => {
      (getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const result = await deleteProvisionToken(mockToken);

      expect(result).toBe(false);
      expect(mockQueryBuilder.delete).not.toHaveBeenCalled();
    });

    it('returns false when session error occurs', async () => {
      (getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: new Error('Session error'),
      });

      const result = await deleteProvisionToken(mockToken);

      expect(result).toBe(false);
      expect(mockQueryBuilder.delete).not.toHaveBeenCalled();
    });

    it('returns false when user ID is missing', async () => {
      (getSession as jest.Mock).mockResolvedValue({
        data: {
          session: {
            ...mockSession,
            user: null,
          },
        },
        error: null,
      });

      const result = await deleteProvisionToken(mockToken);

      expect(result).toBe(false);
      expect(mockQueryBuilder.delete).not.toHaveBeenCalled();
    });

    it('returns false on database error', async () => {
      const dbError = { code: 'PGRST999', message: 'Database error' };
      // Override the delete chain to return error
      mockQueryBuilder.delete = jest.fn(function(this: any) {
        this.eq = jest.fn().mockResolvedValue({ data: null, error: dbError });
        return this;
      });

      const result = await deleteProvisionToken(mockToken);

      expect(result).toBe(false);
    });

    it('returns false on unexpected error', async () => {
      (getSupabase as jest.Mock).mockRejectedValue(new Error('Unexpected error'));

      const result = await deleteProvisionToken(mockToken);

      expect(result).toBe(false);
    });

    it('handles timeout errors gracefully', async () => {
      (withTimeout as jest.Mock).mockRejectedValue(
        new Error('Timed out while deleting provision token.'),
      );

      const result = await deleteProvisionToken(mockToken);

      expect(result).toBe(false);
    });

    it('only allows deleting own tokens', async () => {
      await deleteProvisionToken(mockToken);

      // Verify both token and user_id filters are applied
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('token', mockToken);
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', mockUserId);
    });
  });
});
