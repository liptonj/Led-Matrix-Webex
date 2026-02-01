/**
 * queryWithTimeout Helper Tests
 *
 * Unit tests for the queryWithTimeout helper function.
 */

import * as core from "../../core";
import { queryWithTimeout } from "../queryWithTimeout";

// Mock the core module
jest.mock("../../core", () => ({
  getSupabase: jest.fn(),
  SUPABASE_REQUEST_TIMEOUT_MS: 10000,
  withTimeout: jest.fn((promise) => promise),
}));

describe("queryWithTimeout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("successful queries", () => {
    it("should execute query and return data array", async () => {
      const mockData = [{ id: 1, name: "test" }];
      const mockQueryResult = { data: mockData, error: null };

      const result = await queryWithTimeout(
        () => Promise.resolve(mockQueryResult),
        "Timed out"
      );

      expect(result).toEqual(mockData);
      expect(core.withTimeout).toHaveBeenCalledWith(
        expect.any(Promise),
        10000,
        "Timed out",
        undefined
      );
    });

    it("should execute query and return single row", async () => {
      const mockData = { id: 1, name: "test" };

      const result = await queryWithTimeout(
        () => Promise.resolve({ data: mockData, error: null }),
        "Timed out"
      );

      expect(result).toEqual(mockData);
    });

    it("should return empty array when data is null for array queries", async () => {
      const result = await queryWithTimeout(
        () => Promise.resolve({ data: null, error: null }),
        "Timed out"
      );

      expect(result).toEqual(null);
    });

    it("should use custom timeout when provided", async () => {
      const mockData = [{ id: 1 }];

      await queryWithTimeout(
        () => Promise.resolve({ data: mockData, error: null }),
        "Timed out",
        { timeoutMs: 5000 }
      );

      expect(core.withTimeout).toHaveBeenCalledWith(
        expect.any(Promise),
        5000,
        "Timed out",
        undefined
      );
    });

    it("should pass abort signal when provided", async () => {
      const mockData = [{ id: 1 }];
      const signal = new AbortController().signal;

      await queryWithTimeout(
        () => Promise.resolve({ data: mockData, error: null }),
        "Timed out",
        { signal }
      );

      expect(core.withTimeout).toHaveBeenCalledWith(
        expect.any(Promise),
        10000,
        "Timed out",
        signal
      );
    });
  });

  describe("error handling", () => {
    it("should throw error when query fails", async () => {
      const mockError = { code: "PGRST999", message: "Database error" };

      await expect(
        queryWithTimeout(
          () => Promise.resolve({ data: null, error: mockError }),
          "Timed out"
        )
      ).rejects.toEqual(mockError);
    });

    it("should return empty array for not found error when allowEmpty is true", async () => {
      const mockError = { code: "PGRST116", message: "Not found" };

      const result = await queryWithTimeout(
        () => Promise.resolve({ data: null, error: mockError }),
        "Timed out",
        { allowEmpty: true }
      );

      expect(result).toEqual(null);
    });

    it("should throw not found error when allowEmpty is false", async () => {
      const mockError = { code: "PGRST116", message: "Not found" };

      await expect(
        queryWithTimeout(
          () => Promise.resolve({ data: null, error: mockError }),
          "Timed out",
          { allowEmpty: false }
        )
      ).rejects.toEqual(mockError);
    });

    it("should throw timeout error when withTimeout rejects", async () => {
      const timeoutError = new Error("Timeout");
      (core.withTimeout as jest.Mock).mockRejectedValueOnce(timeoutError);

      await expect(
        queryWithTimeout(
          () => Promise.resolve({ data: [], error: null }),
          "Timed out"
        )
      ).rejects.toThrow("Timeout");
    });
  });

  describe("edge cases", () => {
    it("should handle empty array data", async () => {
      const result = await queryWithTimeout(
        () => Promise.resolve({ data: [], error: null }),
        "Timed out"
      );

      expect(result).toEqual([]);
    });

    it("should handle null data for single queries", async () => {
      const result = await queryWithTimeout(
        () => Promise.resolve({ data: null, error: null }),
        "Timed out"
      );

      expect(result).toBeNull();
    });

    it("should handle query builder that throws", async () => {
      const error = new Error("Query builder failed");

      await expect(
        queryWithTimeout(
          () => {
            throw error;
          },
          "Timed out"
        )
      ).rejects.toThrow("Query builder failed");
    });
  });

  describe("integration patterns", () => {
    it("should support chained query builder pattern", async () => {
      const mockData = [{ id: 1 }];

      const result = await queryWithTimeout(
        async () => {
          await core.getSupabase();
          return { data: mockData, error: null };
        },
        "Timed out loading data"
      );

      expect(result).toEqual(mockData);
    });

    it("should work with complex filter chains", async () => {
      const mockData = [{ id: 1, status: "active" }];

      const result = await queryWithTimeout(
        () => Promise.resolve({ data: mockData, error: null }),
        "Timed out",
        { timeoutMs: 15000 }
      );

      expect(result).toEqual(mockData);
      expect(core.withTimeout).toHaveBeenCalledWith(
        expect.any(Promise),
        15000,
        "Timed out",
        undefined
      );
    });
  });
});
