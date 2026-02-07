/**
 * Unit tests for useSupportChannel hook
 *
 * Tests Supabase Realtime channel subscription, event handling,
 * message sending, and rate limiting functionality.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useSupportChannel } from '../useSupportChannel';

// Mock Supabase
const mockChannel = {
  on: jest.fn().mockReturnThis(),
  subscribe: jest.fn().mockImplementation((callback) => {
    // Simulate subscription success
    setTimeout(() => {
      callback('SUBSCRIBED', null);
    }, 0);
    return mockChannel;
  }),
  send: jest.fn(),
};

const mockSupabase = {
  channel: jest.fn().mockReturnValue(mockChannel),
  removeChannel: jest.fn(),
};

const mockGetSupabase = jest.fn().mockResolvedValue(mockSupabase);

jest.mock('@/lib/supabase/core', () => ({
  getSupabase: (...args: unknown[]) => mockGetSupabase(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  
  // Reset mock implementations
  mockChannel.on.mockReturnThis();
  mockChannel.subscribe.mockImplementation((callback) => {
    setTimeout(() => {
      callback('SUBSCRIBED', null);
    }, 0);
    return mockChannel;
  });
  mockChannel.send.mockImplementation(() => {});
  
  mockSupabase.channel.mockReturnValue(mockChannel);
  mockSupabase.removeChannel.mockImplementation(() => {});
  
  mockGetSupabase.mockResolvedValue(mockSupabase);
});

describe('useSupportChannel', () => {
  describe('initial state', () => {
    it('initializes as disconnected with no session', () => {
      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: null }),
      );
      
      expect(result.current.isConnected).toBe(false);
      expect(result.current.channelError).toBeNull();
    });

    it('provides send function', () => {
      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: null }),
      );
      
      expect(typeof result.current.send).toBe('function');
    });
  });

  describe('subscription', () => {
    it('subscribes when sessionId is provided', async () => {
      renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(mockGetSupabase).toHaveBeenCalled();
        expect(mockSupabase.channel).toHaveBeenCalledWith(
          'support:session-123',
          expect.objectContaining({
            config: expect.objectContaining({
              broadcast: { self: false },
              private: true,
            }),
          })
        );
        expect(mockChannel.subscribe).toHaveBeenCalled();
      });
    });

    it('does not subscribe when sessionId is null', () => {
      renderHook(() =>
        useSupportChannel({ sessionId: null }),
      );

      // getSupabase may be called for cleanup, but channel should not be created
      // We can't easily test this without more complex mocking, but the hook
      // should handle null sessionId gracefully
      expect(mockSupabase.channel).not.toHaveBeenCalled();
    });

    it('updates isConnected when subscribed', async () => {
      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      expect(result.current.channelError).toBeNull();
    });

    it('handles subscription errors', async () => {
      mockChannel.subscribe.mockImplementationOnce((callback) => {
        setTimeout(() => {
          callback('CHANNEL_ERROR', { message: 'Connection failed' });
        }, 0);
        return mockChannel;
      });

      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.channelError).toBe('Connection failed');
      });
    });

    it('handles timeout errors', async () => {
      mockChannel.subscribe.mockImplementationOnce((callback) => {
        setTimeout(() => {
          callback('TIMED_OUT', null);
        }, 0);
        return mockChannel;
      });

      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.channelError).toBe('Channel subscription timed out');
      });
    });

    it('handles closed status', async () => {
      mockChannel.subscribe.mockImplementationOnce((callback) => {
        setTimeout(() => {
          callback('CLOSED', null);
        }, 0);
        return mockChannel;
      });

      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
      });
    });
  });

  describe('event handlers', () => {
    it('registers event handlers', async () => {
      const eventHandlers = {
        test_event: jest.fn(),
        another_event: jest.fn(),
      };

      renderHook(() =>
        useSupportChannel({
          sessionId: 'session-123',
          eventHandlers,
        }),
      );

      await waitFor(() => {
        expect(mockChannel.on).toHaveBeenCalled();
      });

      // Should register handlers for each event
      // channel.on('broadcast', { event: 'test_event' }, callback)
      const onCalls = mockChannel.on.mock.calls;
      expect(onCalls.some((call) => {
        const options = call[1] as { event?: string };
        return options?.event === 'test_event';
      })).toBe(true);
      expect(onCalls.some((call) => {
        const options = call[1] as { event?: string };
        return options?.event === 'another_event';
      })).toBe(true);
    });

    it('calls event handler when message received', async () => {
      const eventHandlers = {
        test_event: jest.fn(),
      };

      renderHook(() =>
        useSupportChannel({
          sessionId: 'session-123',
          eventHandlers,
        }),
      );

      await waitFor(() => {
        expect(mockChannel.on).toHaveBeenCalled();
      });

      // Get the registered handler
      // channel.on('broadcast', { event: 'test_event' }, callback)
      const onCall = mockChannel.on.mock.calls.find(
        (call) => call[0] === 'broadcast' && (call[1] as { event?: string })?.event === 'test_event'
      );
      const handler = onCall?.[2] as (msg: { payload: Record<string, unknown> }) => void;

      if (!handler) {
        throw new Error('Handler not found');
      }

      act(() => {
        handler({ payload: { data: 'test' } });
      });

      expect(eventHandlers.test_event).toHaveBeenCalledWith({ data: 'test' });
    });

    it('updates event handlers ref without re-subscribing', async () => {
      const initialHandlers = {
        event1: jest.fn(),
      };

      const { rerender } = renderHook(
        ({ handlers }) =>
          useSupportChannel({
            sessionId: 'session-123',
            eventHandlers: handlers,
          }),
        { initialProps: { handlers: initialHandlers } }
      );

      await waitFor(() => {
        expect(mockChannel.on).toHaveBeenCalled();
      });

      const newHandlers = {
        event2: jest.fn(),
      };

      rerender({ handlers: newHandlers });

      // The hook uses refs for event handlers, so the channel is NOT recreated.
      // Only sessionId changes trigger re-subscription.
      expect(mockSupabase.removeChannel).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('sends message when connected', async () => {
      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      act(() => {
        result.current.send('test_event', { data: 'test' });
      });

      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'test_event',
        payload: { data: 'test' },
      });
    });

    it('does not send when not connected', () => {
      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: null }),
      );

      act(() => {
        result.current.send('test_event', { data: 'test' });
      });

      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('enforces rate limiting', async () => {
      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Send more than rate limit (20 messages)
      for (let i = 0; i < 25; i++) {
        act(() => {
          result.current.send('test_event', { data: `test${i}` });
        });
      }

      // Should have rate limited
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded')
      );

      // Should not have sent all messages
      expect(mockChannel.send.mock.calls.length).toBeLessThanOrEqual(20);

      consoleWarnSpy.mockRestore();
    });

    it('resets rate limit window', async () => {
      jest.useFakeTimers();
      const { result } = renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Send up to rate limit
      for (let i = 0; i < 20; i++) {
        act(() => {
          result.current.send('test_event', { data: `test${i}` });
        });
      }

      expect(mockChannel.send).toHaveBeenCalledTimes(20);

      // Advance time past rate limit window (1000ms)
      act(() => {
        jest.advanceTimersByTime(1001);
      });

      // Should be able to send more
      act(() => {
        result.current.send('test_event', { data: 'after_reset' });
      });

      expect(mockChannel.send).toHaveBeenCalledTimes(21);

      jest.useRealTimers();
    });
  });

  describe('cleanup', () => {
    it('unsubscribes when sessionId changes to null', async () => {
      const { rerender } = renderHook(
        ({ sessionId }) =>
          useSupportChannel({ sessionId }),
        { initialProps: { sessionId: 'session-123' as string | null } }
      );

      await waitFor(() => {
        expect(mockSupabase.channel).toHaveBeenCalled();
      });

      rerender({ sessionId: null });

      await waitFor(() => {
        expect(mockSupabase.removeChannel).toHaveBeenCalled();
      });
    });

    it('unsubscribes when sessionId changes', async () => {
      const { rerender } = renderHook(
        ({ sessionId }) =>
          useSupportChannel({ sessionId }),
        { initialProps: { sessionId: 'session-123' } }
      );

      await waitFor(() => {
        expect(mockSupabase.channel).toHaveBeenCalledWith(
          'support:session-123',
          expect.any(Object)
        );
      });

      rerender({ sessionId: 'session-456' });

      await waitFor(() => {
        expect(mockSupabase.removeChannel).toHaveBeenCalled();
        expect(mockSupabase.channel).toHaveBeenCalledWith(
          'support:session-456',
          expect.any(Object)
        );
      });
    });

    it('cleans up on unmount', async () => {
      const { unmount } = renderHook(() =>
        useSupportChannel({ sessionId: 'session-123' }),
      );

      await waitFor(() => {
        expect(mockSupabase.channel).toHaveBeenCalled();
      });

      unmount();

      await waitFor(() => {
        expect(mockSupabase.removeChannel).toHaveBeenCalled();
      });
    });

    it('does not call handlers after unmount', async () => {
      const eventHandlers = {
        test_event: jest.fn(),
      };

      const { unmount } = renderHook(() =>
        useSupportChannel({
          sessionId: 'session-123',
          eventHandlers,
        }),
      );

      await waitFor(() => {
        expect(mockChannel.on).toHaveBeenCalled();
      });

      unmount();

      // Get the handler
      // channel.on('broadcast', { event: 'test_event' }, callback)
      const onCall = mockChannel.on.mock.calls.find(
        (call) => call[0] === 'broadcast' && (call[1] as { event?: string })?.event === 'test_event'
      );
      const handler = onCall?.[2] as (msg: { payload: Record<string, unknown> }) => void;

      if (handler) {
        act(() => {
          handler({ payload: { data: 'test' } });
        });
      }

      // Handler should not be called after unmount (mounted flag prevents it)
      expect(eventHandlers.test_event).not.toHaveBeenCalled();
    });
  });
});
