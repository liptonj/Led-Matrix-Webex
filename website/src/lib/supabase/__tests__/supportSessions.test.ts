/**
 * Support Sessions Tests
 *
 * Tests for Supabase support session utilities including creation,
 * joining, closing, and querying sessions.
 */

import {
  createSupportSession,
  joinSupportSession,
  closeSupportSession,
  revertSessionToWaiting,
  getActiveSessions,
  getUserSession,
  updateSessionDeviceInfo,
  cleanupStaleSessions,
} from '../supportSessions';

// Mock Supabase
const mockSelect = jest.fn().mockReturnThis();
const mockInsert = jest.fn().mockReturnThis();
const mockUpdate = jest.fn().mockReturnThis();
const mockEq = jest.fn().mockReturnThis();
const mockIn = jest.fn().mockReturnThis();
const mockOrder = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockSingle = jest.fn();
const mockMaybeSingle = jest.fn();
const mockRpc = jest.fn();

// Create a chainable mock object
const createChainableMock = () => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  eq: mockEq,
  in: mockIn,
  order: mockOrder,
  limit: mockLimit,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
});

const mockFrom = jest.fn().mockReturnValue(createChainableMock());

const mockSchema = jest.fn().mockReturnValue({
  from: mockFrom,
});

const mockSupabaseClient = {
  schema: mockSchema,
  rpc: mockRpc,
};

jest.mock('../core', () => ({
  getSupabase: jest.fn(),
  withTimeout: jest.fn().mockImplementation((promise: unknown) => promise),
  SUPABASE_REQUEST_TIMEOUT_MS: 10000,
}));

// Import after mock so we can configure it in beforeEach
import { getSupabase } from '../core';
const mockGetSupabase = getSupabase as jest.Mock;

jest.mock('../helpers/createRealtimeSubscription', () => ({
  createRealtimeSubscription: jest.fn().mockResolvedValue(jest.fn()),
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

describe('supportSessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Configure getSupabase to return our mock client
    mockGetSupabase.mockResolvedValue(mockSupabaseClient);
    mockSingle.mockResolvedValue({
      data: mockSession,
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    // Reset chain methods to return chainable object for chaining
    const chainable = createChainableMock();
    mockSelect.mockReturnValue(chainable);
    mockInsert.mockReturnValue(chainable);
    mockUpdate.mockReturnValue(chainable);
    mockEq.mockReturnValue(chainable);
    mockIn.mockReturnValue(chainable);
    mockOrder.mockReturnValue(chainable);
    mockLimit.mockReturnValue(chainable);
    mockRpc.mockResolvedValue({ data: 3, error: null });
  });

  describe('createSupportSession', () => {
    it('creates a new session with user_id', async () => {
      const newSession = {
        ...mockSession,
        id: 'new-session',
      };
      mockSingle.mockResolvedValueOnce({
        data: newSession,
        error: null,
      });

      const result = await createSupportSession('user-456');

      expect(mockSchema).toHaveBeenCalledWith('display');
      expect(mockFrom).toHaveBeenCalledWith('support_sessions');
      expect(mockInsert).toHaveBeenCalledWith({ user_id: 'user-456' });
      expect(mockSelect).toHaveBeenCalled();
      expect(result.id).toBe('new-session');
      expect(result.user_id).toBe('user-456');
    });

    it('throws error when creation fails', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error', code: '23505' },
      });

      await expect(createSupportSession('user-456')).rejects.toEqual({
        message: 'Database error',
        code: '23505',
      });
    });
  });

  describe('joinSupportSession', () => {
    it('updates status to active and sets admin_id', async () => {
      const activeSession = {
        ...mockSession,
        status: 'active' as const,
        admin_id: 'admin-789',
        joined_at: '2026-02-07T12:05:00Z',
      };
      mockSingle.mockResolvedValueOnce({
        data: activeSession,
        error: null,
      });

      const result = await joinSupportSession('session-123', 'admin-789');

      expect(mockSchema).toHaveBeenCalledWith('display');
      expect(mockFrom).toHaveBeenCalledWith('support_sessions');
      expect(mockUpdate).toHaveBeenCalledWith({
        admin_id: 'admin-789',
        status: 'active',
        joined_at: expect.any(String),
      });
      expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
      expect(mockEq).toHaveBeenCalledWith('status', 'waiting');
      expect(result.status).toBe('active');
      expect(result.admin_id).toBe('admin-789');
    });

    it('only joins sessions with waiting status', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'No rows returned', code: 'PGRST116' },
      });

      // Attempting to join a closed session should fail
      await expect(joinSupportSession('closed-session', 'admin-789')).rejects.toEqual({
        message: 'No rows returned',
        code: 'PGRST116',
      });

      // Verify the status filter was applied
      expect(mockEq).toHaveBeenCalledWith('status', 'waiting');
    });

    it('throws error when join fails', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Session not found', code: 'PGRST116' },
      });

      await expect(joinSupportSession('session-123', 'admin-789')).rejects.toEqual({
        message: 'Session not found',
        code: 'PGRST116',
      });
    });
  });

  describe('closeSupportSession', () => {
    it('updates status to closed with reason', async () => {
      mockEq.mockResolvedValueOnce({ data: null, error: null });

      await closeSupportSession('session-123', 'user_ended');

      expect(mockSchema).toHaveBeenCalledWith('display');
      expect(mockFrom).toHaveBeenCalledWith('support_sessions');
      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'closed',
        closed_at: expect.any(String),
        close_reason: 'user_ended',
      });
      expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
    });

    it('throws error when close fails', async () => {
      mockEq.mockResolvedValueOnce({
        data: null,
        error: { message: 'Update failed', code: 'PGRST301' },
      });

      await expect(closeSupportSession('session-123', 'user_ended')).rejects.toEqual({
        message: 'Update failed',
        code: 'PGRST301',
      });
    });
  });

  describe('revertSessionToWaiting', () => {
    it('reverts active session back to waiting', async () => {
      mockEq.mockResolvedValueOnce({ data: null, error: null });

      await revertSessionToWaiting('session-123');

      expect(mockSchema).toHaveBeenCalledWith('display');
      expect(mockFrom).toHaveBeenCalledWith('support_sessions');
      expect(mockUpdate).toHaveBeenCalledWith({
        admin_id: null,
        status: 'waiting',
        joined_at: null,
      });
      expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
    });

    it('throws error when revert fails', async () => {
      mockEq.mockResolvedValueOnce({
        data: null,
        error: { message: 'Revert failed', code: 'PGRST301' },
      });

      await expect(revertSessionToWaiting('session-123')).rejects.toEqual({
        message: 'Revert failed',
        code: 'PGRST301',
      });
    });
  });

  describe('getActiveSessions', () => {
    it('returns all active sessions', async () => {
      const sessions = [
        { ...mockSession, id: 's1', status: 'waiting' as const },
        { ...mockSession, id: 's2', status: 'active' as const },
      ];
      mockOrder.mockResolvedValueOnce({
        data: sessions,
        error: null,
      });

      const result = await getActiveSessions();

      expect(mockSchema).toHaveBeenCalledWith('display');
      expect(mockFrom).toHaveBeenCalledWith('support_sessions');
      expect(mockSelect).toHaveBeenCalled();
      expect(mockIn).toHaveBeenCalledWith('status', ['waiting', 'active']);
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('s1');
      expect(result[1].id).toBe('s2');
    });

    it('returns empty array when no active sessions', async () => {
      mockOrder.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await getActiveSessions();

      expect(result).toEqual([]);
    });

    it('throws error when query fails', async () => {
      mockOrder.mockResolvedValueOnce({
        data: null,
        error: { message: 'Query failed', code: 'PGRST301' },
      });

      await expect(getActiveSessions()).rejects.toEqual({
        message: 'Query failed',
        code: 'PGRST301',
      });
    });
  });

  describe('getUserSession', () => {
    it('returns user session when exists', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: mockSession,
        error: null,
      });

      const result = await getUserSession('user-456');

      expect(mockSchema).toHaveBeenCalledWith('display');
      expect(mockFrom).toHaveBeenCalledWith('support_sessions');
      expect(mockSelect).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('user_id', 'user-456');
      expect(mockIn).toHaveBeenCalledWith('status', ['waiting', 'active']);
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockLimit).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockSession);
    });

    it('returns null when no open session', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await getUserSession('user-456');

      expect(result).toBeNull();
    });

    it('throws error when query fails', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Query failed', code: 'PGRST301' },
      });

      await expect(getUserSession('user-456')).rejects.toEqual({
        message: 'Query failed',
        code: 'PGRST301',
      });
    });
  });

  describe('updateSessionDeviceInfo', () => {
    it('updates device serial', async () => {
      mockEq.mockResolvedValueOnce({ data: null, error: null });

      await updateSessionDeviceInfo('session-123', {
        device_serial: 'ABC123',
      });

      expect(mockSchema).toHaveBeenCalledWith('display');
      expect(mockFrom).toHaveBeenCalledWith('support_sessions');
      expect(mockUpdate).toHaveBeenCalledWith({
        device_serial: 'ABC123',
      });
      expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
    });

    it('updates device chip', async () => {
      mockEq.mockResolvedValueOnce({ data: null, error: null });

      await updateSessionDeviceInfo('session-123', {
        device_chip: 'ESP32-S3',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        device_chip: 'ESP32-S3',
      });
    });

    it('updates device firmware', async () => {
      mockEq.mockResolvedValueOnce({ data: null, error: null });

      await updateSessionDeviceInfo('session-123', {
        device_firmware: '1.0.0',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        device_firmware: '1.0.0',
      });
    });

    it('updates multiple device fields', async () => {
      mockEq.mockResolvedValueOnce({ data: null, error: null });

      await updateSessionDeviceInfo('session-123', {
        device_serial: 'ABC123',
        device_chip: 'ESP32-S3',
        device_firmware: '1.0.0',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        device_serial: 'ABC123',
        device_chip: 'ESP32-S3',
        device_firmware: '1.0.0',
      });
    });

    it('throws error when update fails', async () => {
      mockEq.mockResolvedValueOnce({
        data: null,
        error: { message: 'Update failed', code: 'PGRST301' },
      });

      await expect(
        updateSessionDeviceInfo('session-123', { device_serial: 'ABC123' })
      ).rejects.toEqual({
        message: 'Update failed',
        code: 'PGRST301',
      });
    });
  });

  describe('cleanupStaleSessions', () => {
    it('calls RPC function and returns count', async () => {
      mockRpc.mockResolvedValueOnce({ data: 5, error: null });

      const result = await cleanupStaleSessions();

      expect(mockRpc).toHaveBeenCalledWith('cleanup_stale_sessions');
      expect(result).toBe(5);
    });

    it('returns 0 when RPC returns null', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await cleanupStaleSessions();

      expect(result).toBe(0);
    });

    it('throws error when RPC fails', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'RPC failed', code: 'PGRST301' },
      });

      await expect(cleanupStaleSessions()).rejects.toEqual({
        message: 'RPC failed',
        code: 'PGRST301',
      });
    });
  });
});
