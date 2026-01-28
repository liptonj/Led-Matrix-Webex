/**
 * useManifest Hook Tests
 *
 * Unit tests for the useManifest hook that fetches firmware manifest data.
 *
 * @jest-environment jsdom
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { useManifest } from "../useManifest";
import type { FirmwareManifest } from "@/types";

// Store original env
const originalEnv = process.env;

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockManifest: FirmwareManifest = {
  version: "1.2.0",
  build_id: "build-123",
  build_date: "2024-01-26T00:00:00Z",
  firmware: {
    "esp32s3": { url: "https://example.com/firmware.bin" },
  },
  bundle: {
    "merged": { url: "https://example.com/firmware-merged.bin" },
  },
  generated: "2024-01-26T00:00:00Z",
  latest: "1.2.0",
  versions: [
    {
      tag: "v1.2.0",
      version: "1.2.0",
      name: "Release 1.2.0",
      build_id: "build-123",
      build_date: "2024-01-26T00:00:00Z",
      notes: "Initial release",
      prerelease: false,
      firmware: [
        { name: "firmware.bin", url: "https://example.com/firmware.bin", size: 1048576 },
      ],
    },
  ],
};

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
  mockFetch.mockReset();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("useManifest", () => {
  describe("initial state", () => {
    it("should return loading=true and null manifest initially", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      
      // Create a never-resolving promise to keep loading state
      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useManifest());

      expect(result.current.loading).toBe(true);
      expect(result.current.manifest).toBeNull();
      expect(result.current.versions).toEqual([]);
      expect(result.current.latestVersion).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe("successful fetch", () => {
    it("should return manifest data on successful fetch", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const { result } = renderHook(() => useManifest());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.manifest).toEqual(mockManifest);
      expect(result.current.versions).toEqual(mockManifest.versions);
      expect(result.current.latestVersion).toBe("1.2.0");
      expect(result.current.error).toBeNull();
    });

    it("should fetch from Supabase edge function URL", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      renderHook(() => useManifest());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "https://test.supabase.co/functions/v1/get-manifest",
        );
      });
    });
  });

  describe("error - no Supabase config", () => {
    it("should return config error when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const { result } = renderHook(() => useManifest());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toContain("Supabase configuration missing");
      expect(result.current.manifest).toBeNull();
    });
  });

  describe("error - network failure", () => {
    it("should return error message on fetch failure", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

      mockFetch.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useManifest());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toContain("Failed to load firmware versions");
      expect(result.current.manifest).toBeNull();
    });

    it("should handle non-OK response status", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useManifest());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toContain("Failed to load firmware versions");
      expect(result.current.manifest).toBeNull();
    });

    it("should handle 404 response status", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { result } = renderHook(() => useManifest());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toContain("Failed to load firmware versions");
    });
  });

  describe("refetch", () => {
    it("should fetch again when refetch is called", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const { result } = renderHook(() => useManifest());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Call refetch
      await act(async () => {
        await result.current.refetch();
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should update manifest when refetch gets new data", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

      const updatedManifest: FirmwareManifest = {
        ...mockManifest,
        latest: "1.3.0",
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockManifest),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(updatedManifest),
        });

      const { result } = renderHook(() => useManifest());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.latestVersion).toBe("1.2.0");

      // Call refetch
      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.latestVersion).toBe("1.3.0");
    });
  });
});
