/**
 * ThemeToggle Component Tests
 *
 * Tests for the ThemeToggle component.
 */

import { render, screen, waitFor } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "../ThemeToggle";

// Mock useTheme hook
const mockToggleTheme = jest.fn();
const mockUseTheme = jest.fn();

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => mockUseTheme(),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render loading state when not mounted", () => {
      mockUseTheme.mockReturnValue({
        theme: "light",
        toggleTheme: mockToggleTheme,
        mounted: false,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByLabelText("Toggle theme");
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent("🌙");
    });

    it("should render light mode icon when theme is light", () => {
      mockUseTheme.mockReturnValue({
        theme: "light",
        toggleTheme: mockToggleTheme,
        mounted: true,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByLabelText("Switch to dark mode");
      expect(button).toHaveTextContent("☀️");
    });

    it("should render dark mode icon when theme is dark", () => {
      mockUseTheme.mockReturnValue({
        theme: "dark",
        toggleTheme: mockToggleTheme,
        mounted: true,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByLabelText("Switch to light mode");
      expect(button).toHaveTextContent("🌙");
    });
  });

  describe("Interaction", () => {
    it("should call toggleTheme when clicked", async () => {
      const user = userEvent.setup();
      mockUseTheme.mockReturnValue({
        theme: "light",
        toggleTheme: mockToggleTheme,
        mounted: true,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByRole("button");
      await user.click(button);
      
      expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });

    it("should not call toggleTheme when not mounted", async () => {
      const user = userEvent.setup();
      mockUseTheme.mockReturnValue({
        theme: "light",
        toggleTheme: mockToggleTheme,
        mounted: false,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByRole("button");
      await user.click(button);
      
      // Button in unmounted state doesn't have onClick handler
      expect(mockToggleTheme).not.toHaveBeenCalled();
    });
  });

  describe("Accessibility", () => {
    it("should have button type", () => {
      mockUseTheme.mockReturnValue({
        theme: "light",
        toggleTheme: mockToggleTheme,
        mounted: true,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("type", "button");
    });

    it("should have descriptive aria-label", () => {
      mockUseTheme.mockReturnValue({
        theme: "light",
        toggleTheme: mockToggleTheme,
        mounted: true,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByLabelText("Switch to dark mode");
      expect(button).toBeInTheDocument();
    });

    it("should have aria-pressed attribute", () => {
      mockUseTheme.mockReturnValue({
        theme: "dark",
        toggleTheme: mockToggleTheme,
        mounted: true,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-pressed", "true");
    });

    it("should have title attribute", () => {
      mockUseTheme.mockReturnValue({
        theme: "light",
        toggleTheme: mockToggleTheme,
        mounted: true,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("title", "Switch to dark mode");
    });
  });

  describe("Styling", () => {
    it("should have proper button classes", () => {
      mockUseTheme.mockReturnValue({
        theme: "light",
        toggleTheme: mockToggleTheme,
        mounted: true,
      });
      
      render(<ThemeToggle />);
      
      const button = screen.getByRole("button");
      expect(button).toHaveClass(
        "w-10",
        "h-10",
        "rounded-lg",
        "transition-all",
        "hover:bg-white/20"
      );
    });
  });
});
