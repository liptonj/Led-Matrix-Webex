/**
 * Button Component Tests
 *
 * Tests for the Button UI component with various variants and states.
 */

import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { Button } from "../Button";

describe("Button", () => {
  describe("Rendering", () => {
    it("should render with default variant", () => {
      render(<Button>Click me</Button>);
      
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toBeInTheDocument();
    });

    it("should render all variants correctly", () => {
      const variants = ["default", "primary", "success", "warning", "danger", "link"] as const;
      
      variants.forEach(variant => {
        const { container } = render(<Button variant={variant}>{variant}</Button>);
        const button = container.querySelector("button");
        expect(button).toBeInTheDocument();
      });
    });

    it("should render all sizes correctly", () => {
      const sizes = ["sm", "md", "lg"] as const;
      
      sizes.forEach(size => {
        const { container } = render(<Button size={size}>{size}</Button>);
        const button = container.querySelector("button");
        expect(button).toBeInTheDocument();
      });
    });

    it("should render as block when block prop is true", () => {
      render(<Button block>Block Button</Button>);
      
      const button = screen.getByRole("button", { name: /block button/i });
      expect(button).toHaveClass("w-full");
    });
  });

  describe("Interactions", () => {
    it("should call onClick handler when clicked", async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      
      render(<Button onClick={handleClick}>Click me</Button>);
      
      const button = screen.getByRole("button", { name: /click me/i });
      await user.click(button);
      
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("should not call onClick when disabled", async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      
      render(<Button onClick={handleClick} disabled>Disabled</Button>);
      
      const button = screen.getByRole("button", { name: /disabled/i });
      await user.click(button);
      
      expect(handleClick).not.toHaveBeenCalled();
    });

    it("should have disabled cursor style when disabled", () => {
      render(<Button disabled>Disabled</Button>);
      
      const button = screen.getByRole("button", { name: /disabled/i });
      expect(button).toHaveClass("disabled:cursor-not-allowed");
      expect(button).toBeDisabled();
    });
  });

  describe("Accessibility", () => {
    it("should have proper focus styles", () => {
      render(<Button>Focus test</Button>);
      
      const button = screen.getByRole("button", { name: /focus test/i });
      expect(button).toHaveClass("focus-visible:outline-2");
    });

    it("should accept aria attributes", () => {
      render(
        <Button aria-label="Custom label" aria-describedby="description">
          Button
        </Button>
      );
      
      const button = screen.getByRole("button", { name: /custom label/i });
      expect(button).toHaveAttribute("aria-describedby", "description");
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(<Button ref={ref}>Ref test</Button>);
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
    });
  });

  describe("Custom Props", () => {
    it("should accept and apply custom className", () => {
      render(<Button className="custom-class">Custom</Button>);
      
      const button = screen.getByRole("button", { name: /custom/i });
      expect(button).toHaveClass("custom-class");
    });

    it("should accept custom type attribute", () => {
      render(<Button type="submit">Submit</Button>);
      
      const button = screen.getByRole("button", { name: /submit/i });
      expect(button).toHaveAttribute("type", "submit");
    });

    it("should spread additional HTML attributes", () => {
      render(<Button data-testid="custom-test-id">Test</Button>);
      
      const button = screen.getByTestId("custom-test-id");
      expect(button).toBeInTheDocument();
    });
  });
});
