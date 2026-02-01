/**
 * Common Test Setup Utilities
 *
 * Helper functions for setting up test environments and cleaning up after tests.
 */

import { MockWebSocket, createMockLocalStorage } from "./mocks";

/**
 * Sets up the global test environment
 * Call this in beforeEach if needed
 */
export function setupGlobalMocks(): void {
  // Mock WebSocket - use unknown cast for test environment
  if (typeof global.WebSocket === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as unknown as Record<string, unknown>).WebSocket = MockWebSocket;
  }

  // Mock localStorage
  const mockLocalStorage = createMockLocalStorage();
  Object.defineProperty(window, "localStorage", {
    value: mockLocalStorage,
    writable: true,
  });

  // Mock sessionStorage
  Object.defineProperty(window, "sessionStorage", {
    value: createMockLocalStorage(),
    writable: true,
  });

  // Mock fetch if not already mocked
  if (!global.fetch || !(global.fetch as jest.Mock).mock) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "",
      })
    ) as unknown as typeof fetch;
  }

  // Mock window.matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  // Mock IntersectionObserver
  global.IntersectionObserver = class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: readonly number[] = [];
    disconnect() {}
    observe() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    unobserve() {}
  };

  // Mock ResizeObserver
  global.ResizeObserver = class MockResizeObserver implements ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  };
}

/**
 * Cleans up global mocks after tests
 * Call this in afterEach if needed
 */
export function cleanupGlobalMocks(): void {
  jest.clearAllMocks();
  MockWebSocket.clearInstances();
  
  // Clear localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
}

/**
 * Waits for a condition to be true
 * Useful for async testing scenarios
 */
export async function waitForCondition(
  condition: () => boolean,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Condition not met within ${timeout}ms`);
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Advances timers and waits for promises to resolve
 * Useful when testing code that uses setTimeout/setInterval
 */
export async function advanceTimersAndFlush(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await Promise.resolve();
}

/**
 * Suppresses console errors/warnings during tests
 * Returns a cleanup function to restore console
 */
export function suppressConsole(): () => void {
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = jest.fn();
  console.warn = jest.fn();

  return () => {
    console.error = originalError;
    console.warn = originalWarn;
  };
}

/**
 * Creates a spy on console methods with optional filtering
 */
export function spyOnConsole(
  suppressPatterns: string[] = []
): { error: jest.SpyInstance; warn: jest.SpyInstance } {
  const shouldSuppress = (args: unknown[]): boolean => {
    const first = args[0];
    if (typeof first !== "string") return false;
    return suppressPatterns.some(pattern => first.includes(pattern));
  };

  const errorSpy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!shouldSuppress(args)) {
      // eslint-disable-next-line no-console
      console.log("Unexpected error:", ...args);
    }
  });

  const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    if (!shouldSuppress(args)) {
      // eslint-disable-next-line no-console
      console.log("Unexpected warning:", ...args);
    }
  });

  return { error: errorSpy, warn: warnSpy };
}

/**
 * Mock timer utilities
 */
export function useFakeTimers(): void {
  jest.useFakeTimers();
}

export function useRealTimers(): void {
  jest.useRealTimers();
}

/**
 * Flushes all pending promises
 */
export async function flushPromises(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}
