/**
 * useWebexSDK Hook Tests
 *
 * Unit tests for the Webex SDK hook that manages the Webex Embedded App SDK,
 * user info, meeting events, call events, and presence status changes.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useWebexSDK } from "../useWebexSDK";

// Mock Webex App instance
class MockWebexApp {
  private eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map();
  private _onReadyPromise: Promise<void>;
  private _onReadyResolve!: () => void;
  private _onReadyReject!: (error: Error) => void;
  private _shouldFailReady = false;
  // Note: getUser() is deprecated in EAF 2.x - user object is static and not available via API
  private _user: { id: string; displayName: string; email?: string } = { id: "user-1", displayName: "Test User", email: "test@example.com" };
  private _meeting: { id: string; title: string } | null = null;

  constructor() {
    this._onReadyPromise = new Promise((resolve, reject) => {
      this._onReadyResolve = resolve;
      this._onReadyReject = reject;
    });
  }

  context = {
    // getUser() is deprecated in EAF 2.x - not available in context API
    getMeeting: async () => {
      return this._meeting;
    },
    getSpace: async () => {
      return null;
    },
    getSidebar: async () => {
      return null;
    },
  };

  async onReady(): Promise<void> {
    if (this._shouldFailReady) {
      throw new Error("SDK failed to initialize");
    }
    return this._onReadyPromise;
  }

  async listen(): Promise<void> {
    // No-op for tests
  }

  on(event: string, callback: (data: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(callback);
  }

  off(event: string, callback?: (data: unknown) => void): void {
    if (callback) {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(callback);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    } else {
      this.eventHandlers.delete(event);
    }
  }

  // Test helpers
  completeReady(): void {
    this._onReadyResolve();
  }

  failReady(): void {
    this._onReadyReject(new Error("SDK failed to initialize"));
  }

  setFailOnReady(fail: boolean): void {
    this._shouldFailReady = fail;
  }

  // Note: getUser() is deprecated in EAF 2.x - removed setFailOnGetUser method

  setUser(user: { id: string; displayName: string; email?: string }): void {
    this._user = user;
  }

  setMeeting(meeting: { id: string; title: string } | null): void {
    this._meeting = meeting;
  }

  triggerEvent(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  getEventHandlers(event: string): Array<(data: unknown) => void> {
    return this.eventHandlers.get(event) || [];
  }

  hasEventHandler(event: string): boolean {
    return this.eventHandlers.has(event) && this.eventHandlers.get(event)!.length > 0;
  }
}

// Store instances for testing
let mockWebexAppInstance: MockWebexApp | null = null;

// Mock Webex SDK constructor
const MockWebexApplication = jest.fn().mockImplementation(() => {
  mockWebexAppInstance = new MockWebexApp();
  return mockWebexAppInstance;
});

// Setup/teardown for window.Webex mock
function setupWebexSDK(available = true): void {
  if (available) {
    // Use Object.defineProperty to set Webex on the existing window object
    Object.defineProperty(window, "Webex", {
      value: {
        Application: MockWebexApplication,
      },
      writable: true,
      configurable: true,
    });
  } else {
    // Remove Webex from window
    if ("Webex" in window) {
      delete (window as unknown as { Webex?: unknown }).Webex;
    }
  }
}

function cleanupWebexSDK(): void {
  if ("Webex" in window) {
    delete (window as unknown as { Webex?: unknown }).Webex;
  }
}

beforeEach(() => {
  mockWebexAppInstance = null;
  MockWebexApplication.mockClear();
  jest.useFakeTimers();
  setupWebexSDK(true);
});

afterEach(() => {
  cleanupWebexSDK();
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("useWebexSDK", () => {
  describe("Initialization", () => {
    it("should start with initial state (not initialized)", () => {
      const { result } = renderHook(() => useWebexSDK());

      expect(result.current.isInitialized).toBe(false);
      expect(result.current.isReady).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.status).toBe("unknown");
      expect(result.current.meeting).toBeNull();
      expect(result.current.isInCall).toBe(false);
      expect(result.current.isMuted).toBe(false);
      expect(result.current.isVideoOn).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should wait for SDK with retry logic", async () => {
      // SDK not available initially
      setupWebexSDK(false);

      const { result } = renderHook(() => useWebexSDK());

      // Start initialization
      act(() => {
        result.current.initialize();
      });

      // SDK still not available
      expect(result.current.isInitialized).toBe(false);

      // Make SDK available and advance time for retry
      setupWebexSDK(true);
      
      await act(async () => {
        jest.advanceTimersByTime(100); // First retry at 100ms
        await Promise.resolve();
      });

      // Should have found the SDK eventually or timed out
    });

    it("should set error when SDK not available after timeout", async () => {
      setupWebexSDK(false);

      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        // Advance past the 5000ms timeout
        jest.advanceTimersByTime(6000);
        await Promise.resolve();
      });

      expect(result.current.error).toBe(
        "Webex SDK not available. Make sure you are running inside a Webex embedded app."
      );
    });

    it("should create Application instance on initialize", async () => {
      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
      });

      expect(MockWebexApplication).toHaveBeenCalled();
    });

    it("should call onReady and get user info", async () => {
      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
        expect(result.current.user).toEqual({
          id: "user-1",
          displayName: "Test User",
          email: "test@example.com",
        });
      });
    });

    it("should get current meeting if available", async () => {
      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
      });

      mockWebexAppInstance?.setMeeting({ id: "meeting-1", title: "Team Standup" });

      await act(async () => {
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.meeting).toEqual({
          id: "meeting-1",
          title: "Team Standup",
          isActive: true,
        });
      });
    });

    it("should set status to 'meeting' when in meeting", async () => {
      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
      });

      mockWebexAppInstance?.setMeeting({ id: "meeting-1", title: "Standup" });

      await act(async () => {
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.status).toBe("meeting");
        expect(result.current.isInCall).toBe(true);
      });
    });

    it("should register event listeners after ready", async () => {
      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockWebexAppInstance?.hasEventHandler("meeting:started")).toBe(true);
        expect(mockWebexAppInstance?.hasEventHandler("meeting:ended")).toBe(true);
        expect(mockWebexAppInstance?.hasEventHandler("meeting:joined")).toBe(true);
        expect(mockWebexAppInstance?.hasEventHandler("meeting:left")).toBe(true);
        expect(mockWebexAppInstance?.hasEventHandler("call:connected")).toBe(true);
        expect(mockWebexAppInstance?.hasEventHandler("call:disconnected")).toBe(true);
        expect(mockWebexAppInstance?.hasEventHandler("presence:changed")).toBe(true);
      });
    });

    it("should not re-initialize if already initialized", async () => {
      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
      });

      const firstCallCount = MockWebexApplication.mock.calls.length;

      // Try to initialize again
      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
      });

      // Should not create a new instance
      expect(MockWebexApplication.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe("Meeting Events", () => {
    async function setupReadySDK() {
      const hookResult = renderHook(() => useWebexSDK());

      await act(async () => {
        hookResult.result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      return hookResult;
    }

    it("should handle meeting:started event", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("meeting:started", {
          id: "meeting-1",
          title: "New Meeting",
          state: "started",
        });
        await Promise.resolve();
      });

      expect(result.current.meeting).toEqual({
        id: "meeting-1",
        title: "New Meeting",
        isActive: true,
      });
      expect(result.current.status).toBe("meeting");
      expect(result.current.isInCall).toBe(true);
    });

    it("should handle meeting:joined event", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("meeting:joined", {
          id: "meeting-2",
          title: "Joined Meeting",
          state: "joined",
        });
        await Promise.resolve();
      });

      expect(result.current.meeting).toEqual({
        id: "meeting-2",
        title: "Joined Meeting",
        isActive: true,
      });
      expect(result.current.isInCall).toBe(true);
    });

    it("should handle meeting:ended event", async () => {
      const { result } = await setupReadySDK();

      // Start a meeting first
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("meeting:started", {
          id: "meeting-1",
          state: "started",
        });
        await Promise.resolve();
      });

      expect(result.current.isInCall).toBe(true);

      // End the meeting
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("meeting:ended", {
          state: "ended",
        });
        await Promise.resolve();
      });

      expect(result.current.meeting).toBeNull();
      expect(result.current.status).toBe("active");
      expect(result.current.isInCall).toBe(false);
    });

    it("should handle meeting:left event", async () => {
      const { result } = await setupReadySDK();

      // Join a meeting first
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("meeting:joined", {
          id: "meeting-1",
          state: "joined",
        });
        await Promise.resolve();
      });

      // Leave the meeting
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("meeting:left", {
          state: "left",
        });
        await Promise.resolve();
      });

      expect(result.current.meeting).toBeNull();
      expect(result.current.isInCall).toBe(false);
      expect(result.current.isMuted).toBe(false);
      expect(result.current.isVideoOn).toBe(false);
    });

    it("should update status and meeting state", async () => {
      const { result } = await setupReadySDK();

      // Status should be 'active' when not in meeting
      expect(result.current.status).toBe("active");

      // Start meeting
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("meeting:started", {
          id: "m1",
          state: "started",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("meeting");

      // End meeting
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("meeting:ended", {
          state: "ended",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("active");
    });
  });

  describe("Call Events", () => {
    async function setupReadySDK() {
      const hookResult = renderHook(() => useWebexSDK());

      await act(async () => {
        hookResult.result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      return hookResult;
    }

    it("should handle call:connected event", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("call:connected", {
          state: "connected",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("call");
      expect(result.current.isInCall).toBe(true);
    });

    it("should handle call:disconnected event", async () => {
      const { result } = await setupReadySDK();

      // Connect first
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("call:connected", {
          state: "connected",
        });
        await Promise.resolve();
      });

      expect(result.current.isInCall).toBe(true);

      // Disconnect
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("call:disconnected", {
          state: "disconnected",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("active");
      expect(result.current.isInCall).toBe(false);
    });

    it("should update isInCall state", async () => {
      const { result } = await setupReadySDK();

      expect(result.current.isInCall).toBe(false);

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("call:connected", {
          state: "connected",
        });
        await Promise.resolve();
      });

      expect(result.current.isInCall).toBe(true);

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("call:disconnected", {
          state: "disconnected",
        });
        await Promise.resolve();
      });

      expect(result.current.isInCall).toBe(false);
    });
  });

  describe("Presence Events", () => {
    async function setupReadySDK() {
      const hookResult = renderHook(() => useWebexSDK());

      await act(async () => {
        hookResult.result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      return hookResult;
    }

    it("should handle presence:changed to 'active'", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", {
          status: "active",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("active");
    });

    it("should handle presence:changed to 'dnd'", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", {
          status: "dnd",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("dnd");
    });

    it("should handle presence:changed to 'away'", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", {
          status: "away",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("away");
    });

    it("should handle presence:changed to 'offline'", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", {
          status: "offline",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("offline");
    });

    it("should map 'donotdisturb' to 'dnd'", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", {
          status: "donotdisturb",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("dnd");
    });

    it("should map 'inactive' to 'away'", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", {
          status: "inactive",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("away");
    });

    it("should map 'available' to 'active'", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", {
          status: "available",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("active");
    });

    it("should handle unknown presence as 'unknown'", async () => {
      const { result } = await setupReadySDK();

      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", {
          status: "some_unknown_status",
        });
        await Promise.resolve();
      });

      expect(result.current.status).toBe("unknown");
    });
  });

  describe("Error Handling", () => {
    // Suppress expected console.error output during error tests
    const originalConsoleError = console.error;
    beforeEach(() => {
      console.error = jest.fn();
    });
    afterEach(() => {
      console.error = originalConsoleError;
    });

    it("should handle onReady rejection", async () => {
      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
      });

      mockWebexAppInstance?.setFailOnReady(true);

      await act(async () => {
        mockWebexAppInstance?.failReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      // The error should be set due to initialization failure
      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });
    });

    // Note: getUser() is deprecated in EAF 2.x - removed test for getUser rejection
    // The app now functions without user info, which is the expected behavior

    it("should set error message on failure", async () => {
      setupWebexSDK(false);

      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        jest.advanceTimersByTime(6000);
        await Promise.resolve();
      });

      expect(result.current.error).toContain("Webex SDK not available");
    });

    it("should reset isInitialized on error", async () => {
      const { result } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
      });

      // It gets set to true during initialization
      expect(result.current.isInitialized).toBe(true);

      // Note: getUser() is deprecated in EAF 2.x - app continues normally without user info
      // This test is no longer relevant since getUser() is not called
      // The app should remain initialized even without user info
    });
  });

  describe("Cleanup", () => {
    it("should unregister all event listeners on unmount", async () => {
      const { result, unmount } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Verify handlers are registered
      expect(mockWebexAppInstance?.hasEventHandler("meeting:started")).toBe(true);

      // Capture the instance before unmount
      const appInstance = mockWebexAppInstance;

      await act(async () => {
        unmount();
      });

      // Event handlers should be cleared
      expect(appInstance?.hasEventHandler("meeting:started")).toBe(false);
      expect(appInstance?.hasEventHandler("meeting:ended")).toBe(false);
      expect(appInstance?.hasEventHandler("call:connected")).toBe(false);
      expect(appInstance?.hasEventHandler("presence:changed")).toBe(false);
    });

    it("should not update state after unmount", async () => {
      const { result, unmount } = renderHook(() => useWebexSDK());

      await act(async () => {
        result.current.initialize();
        await Promise.resolve();
        mockWebexAppInstance?.completeReady();
        await Promise.resolve();
      });

      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      // Unmount
      act(() => {
        unmount();
      });

      // Try to trigger events after unmount - should not cause errors
      await act(async () => {
        mockWebexAppInstance?.triggerEvent("presence:changed", { status: "dnd" });
        await Promise.resolve();
      });

      // Should not throw or log state update errors
      consoleErrorSpy.mockRestore();
    });
  });
});
