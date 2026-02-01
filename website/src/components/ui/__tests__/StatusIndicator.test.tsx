/**
 * StatusIndicator Component Tests
 *
 * Tests for the StatusIndicator component.
 */

import { render, screen } from "@/test-utils";
import { StatusIndicator } from "../StatusIndicator";
import type { WebexStatus } from "@/types";

describe("StatusIndicator", () => {
  describe("Rendering", () => {
    it("should render with status", () => {
      render(<StatusIndicator status="active" />);
      
      const indicator = screen.getByRole("img", { name: /available/i });
      expect(indicator).toBeInTheDocument();
    });

    it("should render all statuses correctly", () => {
      const statuses: WebexStatus[] = ["active", "meeting", "dnd", "away", "ooo", "offline", "unknown"];
      
      statuses.forEach(status => {
        const { container } = render(<StatusIndicator status={status} />);
        const indicator = container.querySelector('[role="img"]');
        expect(indicator).toBeInTheDocument();
      });
    });

    it("should show label when showLabel is true", () => {
      render(<StatusIndicator status="active" showLabel />);
      
      expect(screen.getByText("Available")).toBeInTheDocument();
    });

    it("should not show label by default", () => {
      render(<StatusIndicator status="active" />);
      
      expect(screen.queryByText("Available")).not.toBeInTheDocument();
    });
  });

  describe("Status Labels", () => {
    const statusLabels: Array<[WebexStatus, string]> = [
      ["active", "Available"],
      ["meeting", "In a Call"],
      ["dnd", "Do Not Disturb"],
      ["away", "Away"],
      ["ooo", "Out of Office"],
      ["offline", "Offline"],
      ["unknown", "Unknown"],
    ];

    statusLabels.forEach(([status, label]) => {
      it(`should show correct label for ${status} status`, () => {
        render(<StatusIndicator status={status} showLabel />);
        
        expect(screen.getByText(label)).toBeInTheDocument();
      });

      it(`should have correct aria-label for ${status} status`, () => {
        render(<StatusIndicator status={status} />);
        
        const indicator = screen.getByRole("img", { name: label });
        expect(indicator).toBeInTheDocument();
      });
    });
  });

  describe("Sizing", () => {
    it("should render with small size", () => {
      const { container } = render(<StatusIndicator status="active" size="sm" />);
      
      const indicator = container.querySelector('[role="img"]');
      expect(indicator).toHaveClass("w-2", "h-2");
    });

    it("should render with medium size (default)", () => {
      const { container } = render(<StatusIndicator status="active" size="md" />);
      
      const indicator = container.querySelector('[role="img"]');
      expect(indicator).toHaveClass("w-3", "h-3");
    });

    it("should render with large size", () => {
      const { container } = render(<StatusIndicator status="active" size="lg" />);
      
      const indicator = container.querySelector('[role="img"]');
      expect(indicator).toHaveClass("w-4", "h-4");
    });
  });

  describe("Styling", () => {
    it("should accept custom className", () => {
      const { container } = render(<StatusIndicator status="active" className="custom-indicator" />);
      
      const wrapper = container.querySelector(".custom-indicator");
      expect(wrapper).toBeInTheDocument();
    });

    it("should have rounded-full class", () => {
      const { container } = render(<StatusIndicator status="active" />);
      
      const indicator = container.querySelector('[role="img"]');
      expect(indicator).toHaveClass("rounded-full");
    });
  });

  describe("Accessibility", () => {
    it("should have img role", () => {
      render(<StatusIndicator status="active" />);
      
      const indicator = screen.getByRole("img");
      expect(indicator).toHaveAttribute("role", "img");
    });

    it("should have aria-label", () => {
      render(<StatusIndicator status="meeting" />);
      
      const indicator = screen.getByRole("img");
      expect(indicator).toHaveAttribute("aria-label", "In a Call");
    });
  });
});
