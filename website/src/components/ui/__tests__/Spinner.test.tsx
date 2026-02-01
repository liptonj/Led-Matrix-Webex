/**
 * Spinner Component Tests
 *
 * Tests for the Spinner loading component.
 */

import { render, screen } from "@/test-utils";
import { Spinner } from "../Spinner";

describe("Spinner", () => {
  describe("Rendering", () => {
    it("should render with default size", () => {
      render(<Spinner />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toBeInTheDocument();
    });

    it("should render all sizes correctly", () => {
      const sizes = ["sm", "md", "lg"] as const;
      
      sizes.forEach(size => {
        const { container } = render(<Spinner size={size} />);
        const spinner = container.querySelector('[role="status"]');
        expect(spinner).toBeInTheDocument();
      });
    });

    it("should have loading aria-label", () => {
      render(<Spinner />);
      
      const spinner = screen.getByLabelText("Loading");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("Styling", () => {
    it("should have animation class", () => {
      render(<Spinner />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toHaveClass("animate-spin");
    });

    it("should have rounded-full class", () => {
      render(<Spinner />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toHaveClass("rounded-full");
    });

    it("should accept custom className", () => {
      render(<Spinner className="custom-spinner" />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toHaveClass("custom-spinner");
    });

    it("should apply small size classes", () => {
      render(<Spinner size="sm" />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toHaveClass("w-4", "h-4");
    });

    it("should apply medium size classes", () => {
      render(<Spinner size="md" />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toHaveClass("w-8", "h-8");
    });

    it("should apply large size classes", () => {
      render(<Spinner size="lg" />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toHaveClass("w-12", "h-12");
    });
  });

  describe("Accessibility", () => {
    it("should have status role", () => {
      render(<Spinner />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toHaveAttribute("role", "status");
    });

    it("should have accessible label", () => {
      render(<Spinner />);
      
      const spinner = screen.getByRole("status");
      expect(spinner).toHaveAttribute("aria-label", "Loading");
    });
  });
});
