/**
 * callEdgeFunction Helper Tests
 *
 * Unit tests for the callEdgeFunction helper function.
 */

import { callEdgeFunction } from "../callEdgeFunction";
import * as auth from "../../auth";
import * as core from "../../core";

// Mock dependencies
jest.mock("../../auth");
jest.mock("../../core", () => ({
  supabaseUrl: "https://test.supabase.co",
}));

// Mock global fetch
global.fetch = jest.fn();

describe("callEdgeFunction", () => {
  const mockToken = "test-access-token";
  const mockSession = {
    data: {
      session: {
        access_token: mockToken,
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (auth.getSession as jest.Mock).mockResolvedValue(mockSession);
    process.env.NODE_ENV = "test";
  });

  describe("successful calls", () => {
    it("should call edge function with authentication", async () => {
      const mockResponse = { user_id: "123", existing: false };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await callEdgeFunction(
        "admin-create-user",
        { email: "test@example.com", password: "secret", role: "user" }
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://test.supabase.co/functions/v1/admin-create-user",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mockToken}`,
          },
          body: JSON.stringify({
            email: "test@example.com",
            password: "secret",
            role: "user",
          }),
        }
      );
    });

    it("should include custom headers when provided", async () => {
      const mockResponse = { success: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await callEdgeFunction(
        "test-function",
        { data: "test" },
        { headers: { "X-Custom-Header": "value" } }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Custom-Header": "value",
          }),
        })
      );
    });

    it("should add debug header in non-production when debug is true", async () => {
      process.env.NODE_ENV = "development";
      const mockResponse = { success: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await callEdgeFunction(
        "test-function",
        { data: "test" },
        { debug: true }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-debug-auth": "1",
          }),
        })
      );
    });

    it("should not add debug header in production even when debug is true", async () => {
      process.env.NODE_ENV = "production";
      const mockResponse = { success: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await callEdgeFunction(
        "test-function",
        { data: "test" },
        { debug: true }
      );

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers).not.toHaveProperty("x-debug-auth");
    });

    it("should handle empty response body", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await callEdgeFunction(
        "test-function",
        { data: "test" }
      );

      expect(result).toEqual({});
    });
  });

  describe("error handling", () => {
    it("should throw error when not authenticated", async () => {
      (auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: null },
      });

      await expect(
        callEdgeFunction("test-function", { data: "test" })
      ).rejects.toThrow("Not authenticated.");
    });

    it("should throw error when Supabase URL is not configured", async () => {
      jest.resetModules();
      jest.mock("../../core", () => ({
        supabaseUrl: "",
      }));
      const { callEdgeFunction: fn } = await import("../callEdgeFunction");

      await expect(
        fn("test-function", { data: "test" })
      ).rejects.toThrow("Supabase URL is not configured.");
    });

    it("should throw error when response is not ok with error message", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "User already exists" }),
      });

      await expect(
        callEdgeFunction("admin-create-user", { email: "test@example.com" })
      ).rejects.toThrow("User already exists");
    });

    it("should throw generic error when response is not ok without error message", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

      await expect(
        callEdgeFunction("test-function", { data: "test" })
      ).rejects.toThrow("Failed to call edge function: test-function");
    });

    it("should handle JSON parse failure gracefully", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await expect(
        callEdgeFunction("test-function", { data: "test" })
      ).rejects.toThrow("Failed to call edge function: test-function");
    });

    it("should handle network errors", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Network error")
      );

      await expect(
        callEdgeFunction("test-function", { data: "test" })
      ).rejects.toThrow("Network error");
    });
  });

  describe("timeout handling", () => {
    it("should respect timeout option when provided", async () => {
      // Mock fetch to hang indefinitely
      (global.fetch as jest.Mock).mockImplementationOnce(
        () => new Promise(() => {}) // Never resolves
      );

      // Use a very short timeout and expect it to timeout
      const promise = callEdgeFunction(
        "test-function",
        { data: "test" },
        { timeoutMs: 10 }
      );

      await expect(promise).rejects.toThrow(
        "Edge function test-function timed out"
      );
    });

    it("should not timeout when timeoutMs is not provided", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await callEdgeFunction("test-function", { data: "test" });

      expect(result).toEqual({ success: true });
    });

    it("should complete successfully when response is faster than timeout", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await callEdgeFunction(
        "test-function",
        { data: "test" },
        { timeoutMs: 5000 }
      );

      expect(result).toEqual({ success: true });
    });
  });

  describe("authentication", () => {
    it("should retrieve session for each call", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await callEdgeFunction("test-1", { data: "test" });
      await callEdgeFunction("test-2", { data: "test" });

      expect(auth.getSession).toHaveBeenCalledTimes(2);
    });

    it("should handle session without access token", async () => {
      (auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: { access_token: null } },
      });

      await expect(
        callEdgeFunction("test-function", { data: "test" })
      ).rejects.toThrow("Not authenticated.");
    });

    it("should handle undefined session", async () => {
      (auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: undefined },
      });

      await expect(
        callEdgeFunction("test-function", { data: "test" })
      ).rejects.toThrow("Not authenticated.");
    });
  });

  describe("request body handling", () => {
    it("should correctly serialize complex objects", async () => {
      const complexBody = {
        user: { email: "test@example.com", role: "admin" },
        settings: { notify: true, theme: "dark" },
        tags: ["tag1", "tag2"],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await callEdgeFunction("test-function", complexBody);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(complexBody),
        })
      );
    });

    it("should handle empty body object", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await callEdgeFunction("test-function", {});

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: "{}",
        })
      );
    });
  });

  describe("type safety", () => {
    it("should properly type request and response", async () => {
      interface CreateUserRequest {
        email: string;
        password: string;
        role: string;
      }

      interface CreateUserResponse {
        user_id: string;
        existing: boolean;
      }

      const mockResponse: CreateUserResponse = {
        user_id: "123",
        existing: false,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await callEdgeFunction<
        CreateUserRequest,
        CreateUserResponse
      >("admin-create-user", {
        email: "test@example.com",
        password: "secret",
        role: "user",
      });

      expect(result.user_id).toBe("123");
      expect(result.existing).toBe(false);
    });
  });
});
