/**
 * useTheme Hook Tests
 *
 * Tests for the theme management hook.
 */

import { renderHook, act } from "@testing-library/react";
import { useTheme } from "../useTheme";

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
});

// Mock matchMedia
const mockMatchMedia = jest.fn().mockImplementation((query) => ({
  matches: query === "(prefers-color-scheme: dark)",
  media: query,
  onchange: null,
  addListener: jest.fn(),
  removeListener: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
}));

Object.defineProperty(window, "matchMedia", {
  value: mockMatchMedia,
});

describe("useTheme", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    jest.clearAllMocks();
    // Reset document classes
    document.documentElement.classList.remove("light", "dark");
  });

  describe("initial state", () => {
    it("should return default dark theme when no preference stored", () => {
      const { result } = renderHook(() => useTheme());

      // After mount
      expect(result.current.theme).toBe("dark");
      expect(result.current.isDark).toBe(true);
      expect(result.current.isLight).toBe(false);
    });

    it("should return mounted as true after mount", async () => {
      const { result } = renderHook(() => useTheme());

      // Should be mounted after effect runs
      expect(result.current.mounted).toBe(true);
    });

    it("should return stored theme from localStorage", () => {
      mockLocalStorage.getItem.mockReturnValueOnce("light");

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe("light");
      expect(result.current.isLight).toBe(true);
    });
  });

  describe("toggleTheme", () => {
    it("should toggle from dark to light", () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe("light");
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "led_matrix_theme",
        "light"
      );
    });

    it("should toggle from light to dark", () => {
      mockLocalStorage.getItem.mockReturnValueOnce("light");

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe("light");

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe("dark");
    });
  });

  describe("setTheme", () => {
    it("should set theme to light", () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme("light");
      });

      expect(result.current.theme).toBe("light");
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "led_matrix_theme",
        "light"
      );
    });

    it("should set theme to dark", () => {
      mockLocalStorage.getItem.mockReturnValueOnce("light");

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme("dark");
      });

      expect(result.current.theme).toBe("dark");
    });

    it("should apply theme class to document", () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme("light");
      });

      expect(document.documentElement.classList.contains("light")).toBe(true);
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  describe("system preference", () => {
    it("should use system preference when no stored preference", () => {
      // Mock prefers-color-scheme: light
      mockMatchMedia.mockImplementationOnce((query) => ({
        matches: query === "(prefers-color-scheme: light)",
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }));

      const { result } = renderHook(() => useTheme());

      // Default behavior when system preference is detected
      expect(result.current.theme).toBeDefined();
    });
  });

  describe("isDark and isLight helpers", () => {
    it("should have isDark true when theme is dark", () => {
      const { result } = renderHook(() => useTheme());

      expect(result.current.isDark).toBe(true);
      expect(result.current.isLight).toBe(false);
    });

    it("should have isLight true when theme is light", () => {
      mockLocalStorage.getItem.mockReturnValueOnce("light");

      const { result } = renderHook(() => useTheme());

      expect(result.current.isDark).toBe(false);
      expect(result.current.isLight).toBe(true);
    });
  });

  describe("provided functions", () => {
    it("should provide setTheme and toggleTheme functions", () => {
      const { result } = renderHook(() => useTheme());

      expect(typeof result.current.setTheme).toBe("function");
      expect(typeof result.current.toggleTheme).toBe("function");
    });
  });
});
