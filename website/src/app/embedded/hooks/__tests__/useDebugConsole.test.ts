/**
 * Tests for useDebugConsole hook
 */
import { act, renderHook, waitFor } from '@testing-library/react';

import { useDebugConsole } from '../useDebugConsole';

// Mock navigator.clipboard
const mockClipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
Object.defineProperty(navigator, 'clipboard', { value: mockClipboard, writable: true });

describe('useDebugConsole', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear localStorage using the global mock (from test-utils/setup)
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
      // Clear mock history if it's a jest mock
      const setItem = window.localStorage.setItem as jest.Mock;
      if (setItem.mockClear) {
        setItem.mockClear();
      }
    }
    mockClipboard.writeText.mockResolvedValue(undefined);
  });

  describe('debugVisible state', () => {
    it('defaults to false', () => {
      const { result } = renderHook(() => useDebugConsole());
      expect(result.current.debugVisible).toBe(false);
    });

    it('can be toggled via setDebugVisible', () => {
      const { result } = renderHook(() => useDebugConsole());
      expect(result.current.debugVisible).toBe(false);

      act(() => {
        result.current.setDebugVisible(true);
      });
      expect(result.current.debugVisible).toBe(true);

      act(() => {
        result.current.setDebugVisible(false);
      });
      expect(result.current.debugVisible).toBe(false);
    });

    it('can toggle using function form of setDebugVisible', () => {
      const { result } = renderHook(() => useDebugConsole());
      expect(result.current.debugVisible).toBe(false);

      act(() => {
        result.current.setDebugVisible(prev => !prev);
      });
      expect(result.current.debugVisible).toBe(true);

      act(() => {
        result.current.setDebugVisible(prev => !prev);
      });
      expect(result.current.debugVisible).toBe(false);
    });

    it('persists to localStorage when changed', async () => {
      const { result } = renderHook(() => useDebugConsole());

      // Get reference to the global localStorage mock
      const setItemMock = window.localStorage.setItem;
      const mockClearFn = (setItemMock as jest.Mock).mockClear;

      // Check if we have a jest mock
      if (!mockClearFn) {
        // Skip this test in environments where localStorage isn't a jest mock
        console.warn('Skipping localStorage persistence test - localStorage is not a jest mock');
        return;
      }

      // Wait for initial mount effects to complete
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Clear initial mount calls
      mockClearFn.call(setItemMock);

      await act(async () => {
        result.current.setDebugVisible(true);
        // Give React time to process the state update
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      
      // Wait for useEffect to run and save to localStorage
      await waitFor(() => {
        expect(setItemMock).toHaveBeenCalledWith('led_matrix_debug_visible', 'true');
      }, { timeout: 3000 });

      mockClearFn.call(setItemMock);

      await act(async () => {
        result.current.setDebugVisible(false);
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      
      await waitFor(() => {
        expect(setItemMock).toHaveBeenCalledWith('led_matrix_debug_visible', 'false');
      }, { timeout: 3000 });
    });
  });

  describe('debugLogs management', () => {
    it('starts with empty logs', () => {
      const { result } = renderHook(() => useDebugConsole());
      expect(result.current.debugLogs).toEqual([]);
    });

    it('appendDebugLog adds entries to the log', () => {
      const { result } = renderHook(() => useDebugConsole());

      act(() => {
        result.current.appendDebugLog('info', 'Test message');
      });

      expect(result.current.debugLogs).toHaveLength(1);
      expect(result.current.debugLogs[0]?.message).toBe('Test message');
      expect(result.current.debugLogs[0]?.level).toBe('info');
    });

    it('clearDebugLogs clears the log and adds activity entry', () => {
      const { result } = renderHook(() => useDebugConsole());

      act(() => {
        result.current.appendDebugLog('info', 'Test message');
        result.current.appendDebugLog('warn', 'Another message');
      });
      expect(result.current.debugLogs.length).toBe(2);

      act(() => {
        result.current.clearDebugLogs();
      });
      // After clearing, only the "Debug log cleared" activity entry remains
      expect(result.current.debugLogs.length).toBe(1);
      expect(result.current.debugLogs[0]?.message).toBe('Debug log cleared');
      expect(result.current.debugLogs[0]?.level).toBe('activity');
    });
  });

  describe('addLog function', () => {
    it('adds to both debugLogs and activityLog', () => {
      const { result } = renderHook(() => useDebugConsole());

      act(() => {
        result.current.addLog('User action');
      });

      expect(result.current.debugLogs).toHaveLength(1);
      expect(result.current.debugLogs[0]?.level).toBe('activity');
      expect(result.current.debugLogs[0]?.message).toBe('User action');
      expect(result.current.activityLog).toHaveLength(1);
      expect(result.current.activityLog[0]?.message).toBe('User action');
    });
  });

  describe('handleCopyDebug', () => {
    it('copies debug logs to clipboard', async () => {
      const { result } = renderHook(() => useDebugConsole());

      act(() => {
        result.current.appendDebugLog('info', 'Test entry');
      });

      await act(async () => {
        await result.current.handleCopyDebug();
      });

      expect(mockClipboard.writeText).toHaveBeenCalled();
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "Never" for null', () => {
      const { result } = renderHook(() => useDebugConsole());
      expect(result.current.formatRelativeTime(null)).toBe('Never');
    });

    it('returns "Just now" for recent timestamps', () => {
      const { result } = renderHook(() => useDebugConsole());
      const recent = Date.now() - 500;
      expect(result.current.formatRelativeTime(recent)).toBe('Just now');
    });

    it('formats seconds ago correctly', () => {
      const { result } = renderHook(() => useDebugConsole());
      const thirtySecondsAgo = Date.now() - 30000;
      expect(result.current.formatRelativeTime(thirtySecondsAgo)).toBe('30s ago');
    });

    it('formats minutes ago correctly', () => {
      const { result } = renderHook(() => useDebugConsole());
      const fiveMinutesAgo = Date.now() - 300000;
      expect(result.current.formatRelativeTime(fiveMinutesAgo)).toBe('5m ago');
    });

    it('formats hours ago correctly', () => {
      const { result } = renderHook(() => useDebugConsole());
      const twoHoursAgo = Date.now() - 7200000;
      expect(result.current.formatRelativeTime(twoHoursAgo)).toBe('2h ago');
    });
  });
});
