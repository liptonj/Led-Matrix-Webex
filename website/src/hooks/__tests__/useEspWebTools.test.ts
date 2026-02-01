/**
 * useEspWebTools Hook Tests
 *
 * Unit tests for the useEspWebTools hook that manages ESP Web Tools integration.
 *
 * @jest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { useEspWebTools } from '../useEspWebTools';

// Store original env
const originalEnv = process.env;

// Mock customElements
const mockCustomElements = {
  get: jest.fn(),
  whenDefined: jest.fn(),
};

// Override global customElements
Object.defineProperty(global, 'customElements', {
  value: mockCustomElements,
  writable: true,
});

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
  mockCustomElements.get.mockReset();
  mockCustomElements.whenDefined.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  process.env = originalEnv;
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('useEspWebTools', () => {
  describe('configuration state', () => {
    it('should return configured=true when Supabase URL is set', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      mockCustomElements.get.mockReturnValue(undefined);
      mockCustomElements.whenDefined.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useEspWebTools());

      expect(result.current.configured).toBe(true);
      expect(result.current.manifestUrl).toBe(
        'https://test.supabase.co/functions/v1/get-manifest?format=esp-web-tools'
      );
    });

    it('should return configured=false when Supabase URL is not set', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      mockCustomElements.get.mockReturnValue(undefined);
      mockCustomElements.whenDefined.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useEspWebTools());

      expect(result.current.configured).toBe(false);
      expect(result.current.manifestUrl).toBeNull();
    });
  });

  describe('custom element already defined', () => {
    it('should return ready=true immediately if custom element exists', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      
      // Mock that custom element is already defined
      mockCustomElements.get.mockReturnValue(true);

      const { result } = renderHook(() => useEspWebTools());

      expect(result.current.ready).toBe(true);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      
      // whenDefined should not be called
      expect(mockCustomElements.whenDefined).not.toHaveBeenCalled();
    });
  });

  describe('custom element not yet defined', () => {
    it('should wait for custom element to be defined', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      
      mockCustomElements.get.mockReturnValue(undefined);
      
      let resolveWhenDefined: () => void;
      mockCustomElements.whenDefined.mockReturnValue(
        new Promise((resolve) => {
          resolveWhenDefined = resolve;
        })
      );

      const { result } = renderHook(() => useEspWebTools());

      // Initially loading
      expect(result.current.ready).toBe(false);
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();

      // Resolve the whenDefined promise
      await act(async () => {
        resolveWhenDefined!();
        await Promise.resolve(); // Flush promises
      });

      expect(result.current.ready).toBe(true);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should show loading state after 2 second timeout', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      
      mockCustomElements.get.mockReturnValue(undefined);
      mockCustomElements.whenDefined.mockReturnValue(new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useEspWebTools());

      // Initially loading
      expect(result.current.loading).toBe(true);

      // Fast-forward time by 2 seconds
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      // Should still be loading
      expect(result.current.loading).toBe(true);
    });

    it('should set error if whenDefined rejects', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      
      mockCustomElements.get.mockReturnValue(undefined);
      mockCustomElements.whenDefined.mockReturnValue(
        Promise.reject(new Error('Failed to load'))
      );

      const { result } = renderHook(() => useEspWebTools());

      await waitFor(() => {
        expect(result.current.error).toBe('ESP Web Tools failed to load. Please refresh the page.');
      });

      expect(result.current.ready).toBe(false);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should clear timeout on unmount', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      
      mockCustomElements.get.mockReturnValue(undefined);
      mockCustomElements.whenDefined.mockReturnValue(new Promise(() => {}));

      const { unmount } = renderHook(() => useEspWebTools());

      // Fast-forward some time
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Unmount before timeout
      unmount();

      // Advance past timeout
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      // Should not throw or cause issues
    });

    it('should ignore updates after unmount', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      
      mockCustomElements.get.mockReturnValue(undefined);
      
      let resolveWhenDefined: () => void;
      mockCustomElements.whenDefined.mockReturnValue(
        new Promise((resolve) => {
          resolveWhenDefined = resolve;
        })
      );

      const { result, unmount } = renderHook(() => useEspWebTools());

      const initialState = result.current;

      // Unmount before promise resolves
      unmount();

      // Resolve the promise
      await act(async () => {
        resolveWhenDefined!();
        await Promise.resolve();
      });

      // State should not have changed after unmount
      expect(result.current).toBe(initialState);
    });
  });

  describe('manifest URL generation', () => {
    it('should generate correct manifest URL format', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      mockCustomElements.get.mockReturnValue(true);

      const { result } = renderHook(() => useEspWebTools());

      expect(result.current.manifestUrl).toBe(
        'https://example.supabase.co/functions/v1/get-manifest?format=esp-web-tools'
      );
    });

    it('should handle different Supabase URLs', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co';
      mockCustomElements.get.mockReturnValue(true);

      const { result } = renderHook(() => useEspWebTools());

      expect(result.current.manifestUrl).toContain('myproject.supabase.co');
      expect(result.current.manifestUrl).toContain('format=esp-web-tools');
    });
  });

  describe('return value structure', () => {
    it('should return all expected properties', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      mockCustomElements.get.mockReturnValue(true);

      const { result } = renderHook(() => useEspWebTools());

      expect(result.current).toHaveProperty('ready');
      expect(result.current).toHaveProperty('loading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('manifestUrl');
      expect(result.current).toHaveProperty('configured');
    });

    it('should have correct types for all properties', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      mockCustomElements.get.mockReturnValue(true);

      const { result } = renderHook(() => useEspWebTools());

      expect(typeof result.current.ready).toBe('boolean');
      expect(typeof result.current.loading).toBe('boolean');
      expect(result.current.error === null || typeof result.current.error === 'string').toBe(true);
      expect(result.current.manifestUrl === null || typeof result.current.manifestUrl === 'string').toBe(true);
      expect(typeof result.current.configured).toBe('boolean');
    });
  });
});
