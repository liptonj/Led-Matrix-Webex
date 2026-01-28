/**
 * useNavigation Hook Tests
 *
 * Tests for the navigation state management hook.
 */

import { renderHook, act } from "@testing-library/react";
import { useNavigation } from "../useNavigation";

describe("useNavigation", () => {
  // Store original body.style.overflow
  const originalOverflow = document.body.style.overflow;

  afterEach(() => {
    document.body.style.overflow = originalOverflow;
  });

  describe("initial state", () => {
    it("should return isOpen as false initially", () => {
      const { result } = renderHook(() => useNavigation());
      expect(result.current.isOpen).toBe(false);
    });

    it("should provide open, close, toggle, and navRef", () => {
      const { result } = renderHook(() => useNavigation());
      expect(typeof result.current.open).toBe("function");
      expect(typeof result.current.close).toBe("function");
      expect(typeof result.current.toggle).toBe("function");
      expect(result.current.navRef).toBeDefined();
    });
  });

  describe("open", () => {
    it("should set isOpen to true", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);
    });

    it("should prevent body scroll", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(document.body.style.overflow).toBe("hidden");
    });
  });

  describe("close", () => {
    it("should set isOpen to false", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.close();
      });

      expect(result.current.isOpen).toBe(false);
    });

    it("should restore body scroll", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(document.body.style.overflow).toBe("hidden");

      act(() => {
        result.current.close();
      });

      expect(document.body.style.overflow).toBe("");
    });
  });

  describe("toggle", () => {
    it("should toggle isOpen from false to true", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.toggle();
      });

      expect(result.current.isOpen).toBe(true);
    });

    it("should toggle isOpen from true to false", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.isOpen).toBe(false);
    });
  });

  describe("escape key handling", () => {
    it("should close nav when escape key is pressed", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Escape" });
        document.dispatchEvent(event);
      });

      expect(result.current.isOpen).toBe(false);
    });

    it("should not close nav when other key is pressed", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Enter" });
        document.dispatchEvent(event);
      });

      expect(result.current.isOpen).toBe(true);
    });
  });

  describe("resize handling", () => {
    it("should close nav when window is resized to desktop width", () => {
      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);

      // Simulate desktop width
      Object.defineProperty(window, "innerWidth", {
        value: 1200,
        writable: true,
      });

      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      expect(result.current.isOpen).toBe(false);
    });

    it("should not close nav when resized to mobile width", () => {
      // Set initial width to mobile
      Object.defineProperty(window, "innerWidth", {
        value: 500,
        writable: true,
      });

      const { result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      // Should still be open on mobile
      expect(result.current.isOpen).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("should remove event listeners on unmount", () => {
      const removeEventListenerSpy = jest.spyOn(document, "removeEventListener");

      const { unmount, result } = renderHook(() => useNavigation());

      act(() => {
        result.current.open();
      });

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function)
      );

      removeEventListenerSpy.mockRestore();
    });
  });
});
