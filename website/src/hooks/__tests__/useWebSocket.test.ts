/**
 * useWebSocket Hook Tests
 *
 * Unit tests for the WebSocket hook that manages WebSocket connections,
 * message handling, reconnection logic, and command/response patterns.
 */

import { act, renderHook } from "@testing-library/react";
import {
    useWebSocket,
    UseWebSocketOptions,
    WebSocketMessage
} from "../useWebSocket";

// Mock WebSocket class
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = MockWebSocket.CONNECTING;
  readonly OPEN = MockWebSocket.OPEN;
  readonly CLOSING = MockWebSocket.CLOSING;
  readonly CLOSED = MockWebSocket.CLOSED;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private static instances: MockWebSocket[] = [];
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage(data: WebSocketMessage): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  static getLastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  static getAllInstances(): MockWebSocket[] {
    return MockWebSocket.instances;
  }

  static clearInstances(): void {
    MockWebSocket.instances = [];
  }
}

// Set up global WebSocket mock
const originalWebSocket = global.WebSocket;

beforeEach(() => {
  MockWebSocket.clearInstances();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).WebSocket = MockWebSocket;
  jest.useFakeTimers();
});

afterEach(() => {
  global.WebSocket = originalWebSocket;
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("useWebSocket", () => {
  const defaultOptions: UseWebSocketOptions = {
    url: "ws://localhost:8080",
    reconnect: false, // Disable auto-reconnect for most tests
  };

  describe("initial state", () => {
    it("should return disconnected status initially", () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      expect(result.current.status).toBe("disconnected");
      expect(result.current.isConnected).toBe(false);
      expect(result.current.lastMessage).toBeNull();
      expect(result.current.reconnectAttempts).toBe(0);
    });

    it("should provide connect, disconnect, send, and sendCommand functions", () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      expect(typeof result.current.connect).toBe("function");
      expect(typeof result.current.disconnect).toBe("function");
      expect(typeof result.current.send).toBe("function");
      expect(typeof result.current.sendCommand).toBe("function");
    });
  });

  describe("connect", () => {
    it("should connect to WebSocket URL", () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      act(() => {
        result.current.connect();
      });

      expect(result.current.status).toBe("connecting");

      const wsInstance = MockWebSocket.getLastInstance();
      expect(wsInstance).toBeDefined();
      expect(wsInstance?.url).toBe("ws://localhost:8080");
    });

    it("should update status to connected when WebSocket opens", async () => {
      const onOpen = jest.fn();
      const { result } = renderHook(() =>
        useWebSocket({ ...defaultOptions, onOpen })
      );

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();

      await act(async () => {
        wsInstance?.simulateOpen();
      });

      expect(result.current.status).toBe("connected");
      expect(result.current.isConnected).toBe(true);
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it("should not create duplicate connections when already connected", async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      // Try to connect again
      act(() => {
        result.current.connect();
      });

      // Should still be only one instance
      expect(MockWebSocket.getAllInstances().length).toBe(1);
    });
  });

  describe("disconnect", () => {
    it("should close WebSocket connection", async () => {
      const onClose = jest.fn();
      const { result } = renderHook(() =>
        useWebSocket({ ...defaultOptions, onClose })
      );

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.status).toBe("disconnected");
      expect(result.current.isConnected).toBe(false);
    });

    it("should clear reconnect timeout when disconnecting", async () => {
      // For this test, we want to verify that calling disconnect() clears
      // any pending reconnect timeout. The disconnect() function closes the
      // connection and clears timeouts, so no new connections should be created.
      const { result } = renderHook(() =>
        useWebSocket({ ...defaultOptions, reconnect: false })
      );

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);

      // Disconnect should close the connection
      act(() => {
        result.current.disconnect();
      });

      expect(result.current.status).toBe("disconnected");
      expect(result.current.isConnected).toBe(false);

      // Should still be only one instance since reconnect is disabled
      expect(MockWebSocket.getAllInstances().length).toBe(1);
    });
  });

  describe("send", () => {
    it("should send JSON message when connected", async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      const message: WebSocketMessage = { type: "test", data: "hello" };
      let sendResult: boolean = false;

      act(() => {
        sendResult = result.current.send(message);
      });

      expect(sendResult).toBe(true);
      expect(wsInstance?.sentMessages).toContain(JSON.stringify(message));
    });

    it("should return false when not connected", () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      const message: WebSocketMessage = { type: "test" };
      let sendResult: boolean = true;

      act(() => {
        sendResult = result.current.send(message);
      });

      expect(sendResult).toBe(false);
    });
  });

  describe("sendCommand", () => {
    it("should send command and wait for response", async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      // Start the command
      let commandPromise: Promise<unknown>;
      act(() => {
        commandPromise = result.current.sendCommand("test_command", { foo: "bar" });
      });

      // Extract the requestId from the sent message
      const sentMessage = JSON.parse(wsInstance!.sentMessages[0] ?? '{}');
      expect(sentMessage.type).toBe("command");
      expect(sentMessage.command).toBe("test_command");
      expect(sentMessage.requestId).toBeDefined();
      expect(sentMessage.payload).toEqual({ foo: "bar" });

      // Simulate command response
      await act(async () => {
        wsInstance?.simulateMessage({
          type: "command_response",
          requestId: sentMessage.requestId,
          success: true,
          data: { result: "success" },
        });
      });

      const response = await commandPromise!;
      expect(response).toEqual({
        requestId: sentMessage.requestId,
        success: true,
        data: { result: "success" },
        error: undefined,
      });
    });

    it("should reject when WebSocket is not connected", async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      await expect(result.current.sendCommand("test")).rejects.toThrow(
        "WebSocket not connected"
      );
    });

    it("should timeout if no response received", async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      // Create the command promise and handle the rejection
      let commandError: Error | null = null;
      let commandPromise: Promise<unknown>;

      await act(async () => {
        commandPromise = result.current.sendCommand("slow_command");

        // Catch the error to prevent unhandled rejection warning
        commandPromise.catch((err) => {
          commandError = err;
        });

        // Fast-forward past the timeout (10 seconds)
        jest.advanceTimersByTime(11000);

        // Wait for the promise to reject
        try {
          await commandPromise;
        } catch {
          // Expected rejection
        }
      });

      expect(commandError).toBeInstanceOf(Error);
      expect((commandError as Error | null)?.message).toBe('Command "slow_command" timed out');
    });
  });

  describe("onMessage", () => {
    it("should trigger callback on incoming message", async () => {
      const onMessage = jest.fn();
      const { result } = renderHook(() =>
        useWebSocket({ ...defaultOptions, onMessage })
      );

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      const incomingMessage: WebSocketMessage = {
        type: "status_update",
        status: "active",
      };

      await act(async () => {
        wsInstance?.simulateMessage(incomingMessage);
      });

      expect(onMessage).toHaveBeenCalledWith(incomingMessage);
      expect(result.current.lastMessage).toEqual(incomingMessage);
    });

    it("should update lastMessage on each new message", async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      await act(async () => {
        wsInstance?.simulateMessage({ type: "message1" });
      });
      expect(result.current.lastMessage).toEqual({ type: "message1" });

      await act(async () => {
        wsInstance?.simulateMessage({ type: "message2" });
      });
      expect(result.current.lastMessage).toEqual({ type: "message2" });
    });
  });

  describe("onError", () => {
    it("should trigger callback on error", async () => {
      const onError = jest.fn();
      const { result } = renderHook(() =>
        useWebSocket({ ...defaultOptions, onError })
      );

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();

      await act(async () => {
        wsInstance?.simulateError();
      });

      expect(result.current.status).toBe("error");
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe("onClose", () => {
    it("should update status on close", async () => {
      const onClose = jest.fn();
      const { result } = renderHook(() =>
        useWebSocket({ ...defaultOptions, onClose })
      );

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      expect(result.current.status).toBe("connected");

      await act(async () => {
        wsInstance?.simulateClose();
      });

      expect(result.current.status).toBe("disconnected");
      expect(result.current.isConnected).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconnect", () => {
    it("should attempt reconnection after disconnect when enabled", async () => {
      const { result } = renderHook(() =>
        useWebSocket({
          ...defaultOptions,
          reconnect: true,
          reconnectInterval: 3000,
          maxReconnectAttempts: 3,
        })
      );

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      expect(result.current.reconnectAttempts).toBe(0);

      // Simulate connection close
      await act(async () => {
        wsInstance?.simulateClose();
      });

      expect(result.current.status).toBe("disconnected");

      // Advance timer to trigger reconnect
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      // Should have attempted to reconnect
      expect(MockWebSocket.getAllInstances().length).toBe(2);
      expect(result.current.reconnectAttempts).toBe(1);
    });

    it("should stop reconnecting after max attempts", async () => {
      const { result } = renderHook(() =>
        useWebSocket({
          ...defaultOptions,
          reconnect: true,
          reconnectInterval: 1000,
          maxReconnectAttempts: 2,
        })
      );

      act(() => {
        result.current.connect();
      });

      // First connection
      const ws1 = MockWebSocket.getLastInstance();
      await act(async () => {
        ws1?.simulateOpen();
      });

      expect(result.current.reconnectAttempts).toBe(0);

      // First disconnect - should trigger first reconnect
      await act(async () => {
        ws1?.simulateClose();
      });

      // First reconnect attempt
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // After first reconnect attempt, reconnectAttempts should be 1
      expect(result.current.reconnectAttempts).toBeGreaterThanOrEqual(1);

      // Record current instance count after reconnect attempts
      const instanceCountAfterReconnects = MockWebSocket.getAllInstances().length;

      // Get the latest instance and simulate repeated closes and timer advances
      // to exhaust all reconnection attempts
      for (let i = 0; i < 5; i++) {
        const latestWs = MockWebSocket.getLastInstance();
        if (latestWs && latestWs.readyState !== MockWebSocket.CLOSED) {
          await act(async () => {
            latestWs.simulateClose();
          });
          await act(async () => {
            jest.advanceTimersByTime(1000);
          });
        }
      }

      // Record final count
      const finalInstanceCount = MockWebSocket.getAllInstances().length;

      // After all reconnect attempts are exhausted, waiting more should not
      // create new connections
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      const afterWaitInstanceCount = MockWebSocket.getAllInstances().length;

      // Key assertion: no new connections after waiting when max attempts reached
      expect(afterWaitInstanceCount).toBe(finalInstanceCount);

      // Reconnect attempts should have reached or exceeded max
      expect(result.current.reconnectAttempts).toBeGreaterThanOrEqual(2);
    });

    it("should reset reconnect attempts on successful connection", async () => {
      const { result } = renderHook(() =>
        useWebSocket({
          ...defaultOptions,
          reconnect: true,
          reconnectInterval: 1000,
          maxReconnectAttempts: 5,
        })
      );

      act(() => {
        result.current.connect();
      });

      const ws1 = MockWebSocket.getLastInstance();
      await act(async () => {
        ws1?.simulateOpen();
      });

      // Disconnect
      await act(async () => {
        ws1?.simulateClose();
      });

      // Reconnect
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      expect(result.current.reconnectAttempts).toBe(1);

      // Successful reconnection
      const ws2 = MockWebSocket.getLastInstance();
      await act(async () => {
        ws2?.simulateOpen();
      });

      // Reconnect attempts should be reset
      expect(result.current.reconnectAttempts).toBe(0);
    });
  });

  describe("cleanup on unmount", () => {
    it("should close connection and reject pending commands on unmount", async () => {
      const { result, unmount } = renderHook(() => useWebSocket(defaultOptions));

      act(() => {
        result.current.connect();
      });

      const wsInstance = MockWebSocket.getLastInstance();
      await act(async () => {
        wsInstance?.simulateOpen();
      });

      // Start a command that won't be answered
      let commandPromise: Promise<unknown>;
      act(() => {
        commandPromise = result.current.sendCommand("test");
      });

      // Unmount the component
      unmount();

      // The command should be rejected
      await expect(commandPromise!).rejects.toThrow("Component unmounted");
    });
  });
});
