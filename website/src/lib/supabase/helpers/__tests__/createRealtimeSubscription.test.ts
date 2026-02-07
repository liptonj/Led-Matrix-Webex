/**
 * createRealtimeSubscription Helper Tests
 *
 * Unit tests for the createRealtimeSubscription helper function.
 */

import { createRealtimeSubscription } from "../createRealtimeSubscription";
import * as core from "../../core";

// Mock the core module
jest.mock("../../core");

describe("createRealtimeSubscription", () => {
  let mockChannel: any;
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock channel with chaining
    mockChannel = {
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    };

    // Create mock supabase client
    mockSupabase = {
      channel: jest.fn().mockReturnValue(mockChannel),
      removeChannel: jest.fn(),
    };

    (core.getSupabase as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe("postgres_changes subscriptions", () => {
    it("should create subscription for all events", async () => {
      const onMessage = jest.fn();
      const onStatusChange = jest.fn();

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "postgres_changes",
          event: "*",
          schema: "display",
          table: "devices",
        },
        { onMessage, onStatusChange }
      );

      expect(mockSupabase.channel).toHaveBeenCalledWith("test-channel");
      expect(mockChannel.on).toHaveBeenCalledWith(
        "postgres_changes",
        {
          event: "*",
          schema: "display",
          table: "devices",
        },
        expect.any(Function)
      );
      expect(mockChannel.subscribe).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should create subscription with filter", async () => {
      const onMessage = jest.fn();

      await createRealtimeSubscription(
        "pairing-ABC123",
        {
          type: "postgres_changes",
          event: "UPDATE",
          schema: "display",
          table: "pairings",
          filter: "pairing_code=eq.ABC123",
        },
        { onMessage }
      );

      expect(mockChannel.on).toHaveBeenCalledWith(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "display",
          table: "pairings",
          filter: "pairing_code=eq.ABC123",
        },
        expect.any(Function)
      );
    });

    it("should call onMessage when postgres change received", async () => {
      const onMessage = jest.fn();
      let messageHandler: (payload: any) => void;

      mockChannel.on.mockImplementation((_type: string, _config: any, handler: any) => {
        messageHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "postgres_changes",
          event: "INSERT",
          schema: "display",
          table: "devices",
        },
        { onMessage }
      );

      const mockPayload = {
        eventType: "INSERT",
        new: { id: 1, name: "test" },
        old: null,
      };

      messageHandler!(mockPayload);

      expect(onMessage).toHaveBeenCalledWith(mockPayload);
    });

    it("should support INSERT, UPDATE, DELETE events", async () => {
      const events = ["INSERT", "UPDATE", "DELETE"] as const;

      for (const event of events) {
        jest.clearAllMocks();
        const onMessage = jest.fn();

        await createRealtimeSubscription(
          "test-channel",
          {
            type: "postgres_changes",
            event,
            schema: "display",
            table: "devices",
          },
          { onMessage }
        );

        expect(mockChannel.on).toHaveBeenCalledWith(
          "postgres_changes",
          expect.objectContaining({ event }),
          expect.any(Function)
        );
      }
    });
  });

  describe("broadcast subscriptions", () => {
    it("should create broadcast subscription", async () => {
      const onMessage = jest.fn();
      const userUuid = "550e8400-e29b-41d4-a716-446655440000";

      await createRealtimeSubscription(
        `user:${userUuid}`,
        {
          type: "broadcast",
          event: "debug_log",
        },
        { onMessage }
      );

      expect(mockSupabase.channel).toHaveBeenCalledWith(`user:${userUuid}`);
      expect(mockChannel.on).toHaveBeenCalledWith(
        "broadcast",
        { event: "debug_log" },
        expect.any(Function)
      );
    });

    it("should call onMessage when broadcast received", async () => {
      const onMessage = jest.fn();
      let messageHandler: (payload: any) => void;
      const userUuid = "550e8400-e29b-41d4-a716-446655440000";

      mockChannel.on.mockImplementation((_type: string, _config: any, handler: any) => {
        messageHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        `user:${userUuid}`,
        {
          type: "broadcast",
          event: "debug_log",
        },
        { onMessage }
      );

      const mockPayload = {
        payload: {
          device_uuid: "550e8400-e29b-41d4-a716-446655440001",
          serial_number: "serial123",
          level: "info",
          message: "Test log",
        },
      };

      messageHandler!(mockPayload);

      expect(onMessage).toHaveBeenCalledWith({
        device_uuid: "550e8400-e29b-41d4-a716-446655440001",
        serial_number: "serial123",
        level: "info",
        message: "Test log",
      });
    });
  });

  describe("subscription lifecycle", () => {
    it("should call onStatusChange when subscribed", async () => {
      const onStatusChange = jest.fn();
      let statusHandler: (status: string, err?: Error) => void;

      mockChannel.subscribe.mockImplementation((handler: any) => {
        statusHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn(), onStatusChange }
      );

      statusHandler!("SUBSCRIBED");

      expect(onStatusChange).toHaveBeenCalledWith(true);
    });

    it("should call onError and onStatusChange on CHANNEL_ERROR", async () => {
      const onStatusChange = jest.fn();
      const onError = jest.fn();
      let statusHandler: (status: string, err?: Error) => void;

      mockChannel.subscribe.mockImplementation((handler: any) => {
        statusHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn(), onStatusChange, onError }
      );

      const error = new Error("Connection failed");
      statusHandler!("CHANNEL_ERROR", error);

      expect(onError).toHaveBeenCalledWith("Connection failed");
      expect(onStatusChange).toHaveBeenCalledWith(false);
    });

    it("should call onError with generic message when no error provided", async () => {
      const onError = jest.fn();
      let statusHandler: (status: string, err?: Error) => void;

      mockChannel.subscribe.mockImplementation((handler: any) => {
        statusHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn(), onError }
      );

      statusHandler!("CHANNEL_ERROR");

      expect(onError).toHaveBeenCalledWith("Failed to subscribe to realtime updates");
    });

    it("should handle TIMED_OUT status", async () => {
      const onStatusChange = jest.fn();
      const onError = jest.fn();
      let statusHandler: (status: string, err?: Error) => void;

      mockChannel.subscribe.mockImplementation((handler: any) => {
        statusHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn(), onStatusChange, onError }
      );

      statusHandler!("TIMED_OUT");

      expect(onError).toHaveBeenCalledWith("Realtime subscription timed out");
      expect(onStatusChange).toHaveBeenCalledWith(false);
    });

    it("should handle CLOSED status", async () => {
      const onStatusChange = jest.fn();
      let statusHandler: (status: string, err?: Error) => void;

      mockChannel.subscribe.mockImplementation((handler: any) => {
        statusHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn(), onStatusChange }
      );

      statusHandler!("CLOSED");

      expect(onStatusChange).toHaveBeenCalledWith(false);
    });

    it("should not require onStatusChange or onError callbacks", async () => {
      let statusHandler: (status: string, err?: Error) => void;

      mockChannel.subscribe.mockImplementation((handler: any) => {
        statusHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn() }
      );

      // Should not throw when callbacks are not provided
      expect(() => {
        statusHandler!("SUBSCRIBED");
        statusHandler!("CHANNEL_ERROR");
        statusHandler!("CLOSED");
      }).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should return unsubscribe function", async () => {
      const unsubscribe = await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn() }
      );

      expect(typeof unsubscribe).toBe("function");
    });

    it("should remove channel when unsubscribe is called", async () => {
      const unsubscribe = await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn() }
      );

      unsubscribe();

      expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
    });

    it("should allow multiple unsubscribe calls", async () => {
      const unsubscribe = await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage: jest.fn() }
      );

      unsubscribe();
      unsubscribe();

      expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(2);
    });
  });

  describe("edge cases", () => {
    it("should handle channel creation failure", async () => {
      (core.getSupabase as jest.Mock).mockRejectedValueOnce(
        new Error("Failed to get client")
      );

      await expect(
        createRealtimeSubscription(
          "test-channel",
          {
            type: "broadcast",
            event: "test",
          },
          { onMessage: jest.fn() }
        )
      ).rejects.toThrow("Failed to get client");
    });

    it("should handle null/undefined payloads gracefully", async () => {
      const onMessage = jest.fn();
      let messageHandler: (payload: any) => void;

      mockChannel.on.mockImplementation((_type: string, _config: any, handler: any) => {
        messageHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage }
      );

      messageHandler!({ payload: null });
      expect(onMessage).toHaveBeenCalledWith(null);

      messageHandler!({ payload: undefined });
      expect(onMessage).toHaveBeenCalledWith(undefined);
    });

    it("should handle complex payload structures", async () => {
      const onMessage = jest.fn();
      let messageHandler: (payload: any) => void;

      mockChannel.on.mockImplementation((_type: string, _config: any, handler: any) => {
        messageHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription(
        "test-channel",
        {
          type: "broadcast",
          event: "test",
        },
        { onMessage }
      );

      const complexPayload = {
        payload: {
          nested: {
            data: {
              array: [1, 2, 3],
              object: { key: "value" },
            },
          },
        },
      };

      messageHandler!(complexPayload);

      expect(onMessage).toHaveBeenCalledWith(complexPayload.payload);
    });
  });

  describe("multiple subscriptions", () => {
    it("should handle multiple concurrent subscriptions", async () => {
      const onMessage1 = jest.fn();
      const onMessage2 = jest.fn();

      const unsubscribe1 = await createRealtimeSubscription(
        "channel-1",
        { type: "broadcast", event: "test1" },
        { onMessage: onMessage1 }
      );

      const unsubscribe2 = await createRealtimeSubscription(
        "channel-2",
        { type: "broadcast", event: "test2" },
        { onMessage: onMessage2 }
      );

      expect(mockSupabase.channel).toHaveBeenCalledTimes(2);
      expect(mockSupabase.channel).toHaveBeenCalledWith("channel-1");
      expect(mockSupabase.channel).toHaveBeenCalledWith("channel-2");

      unsubscribe1();
      unsubscribe2();

      expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(2);
    });
  });

  describe("type safety", () => {
    it("should properly type messages for postgres_changes", async () => {
      interface Device {
        id: number;
        name: string;
        serial_number: string;
      }

      const onMessage = jest.fn<void, [any]>();
      let messageHandler: (payload: any) => void;

      mockChannel.on.mockImplementation((_type: string, _config: any, handler: any) => {
        messageHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription<any>(
        "devices",
        {
          type: "postgres_changes",
          event: "INSERT",
          schema: "display",
          table: "devices",
        },
        { onMessage }
      );

      const payload = {
        eventType: "INSERT",
        new: { id: 1, name: "Device 1", serial_number: "ABC123" },
        old: null,
      };

      messageHandler!(payload);

      expect(onMessage).toHaveBeenCalledWith(payload);
    });

    it("should properly type messages for broadcast", async () => {
      interface LogMessage {
        level: string;
        message: string;
        timestamp: number;
      }

      const onMessage = jest.fn<void, [LogMessage]>();
      let messageHandler: (payload: any) => void;

      mockChannel.on.mockImplementation((_type: string, _config: any, handler: any) => {
        messageHandler = handler;
        return mockChannel;
      });

      await createRealtimeSubscription<LogMessage>(
        "logs",
        {
          type: "broadcast",
          event: "log",
        },
        { onMessage }
      );

      const payload = {
        payload: {
          level: "info",
          message: "Test log",
          timestamp: Date.now(),
        },
      };

      messageHandler!(payload);

      expect(onMessage).toHaveBeenCalledWith(payload.payload);
    });
  });
});
