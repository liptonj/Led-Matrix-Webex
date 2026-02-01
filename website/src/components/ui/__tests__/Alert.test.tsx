/**
 * Alert Component Tests
 *
 * Tests for the Alert UI component with various variants.
 */

import { render, screen } from "@/test-utils";
import { Alert, AlertTitle } from "../Alert";

describe("Alert", () => {
  describe("Rendering", () => {
    it("should render with default variant", () => {
      render(<Alert>Alert message</Alert>);
      
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Alert message");
    });

    it("should render all variants correctly", () => {
      const variants = ["info", "success", "warning", "danger"] as const;
      
      variants.forEach(variant => {
        const { container } = render(
          <Alert variant={variant}>
            {variant} alert
          </Alert>
        );
        const alert = container.querySelector('[role="alert"]');
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveTextContent(`${variant} alert`);
      });
    });

    it("should have proper role attribute", () => {
      render(<Alert>Message</Alert>);
      
      const alert = screen.getByRole("alert");
      expect(alert).toHaveAttribute("role", "alert");
    });
  });

  describe("AlertTitle", () => {
    it("should render title with alert", () => {
      render(
        <Alert>
          <AlertTitle>Alert Title</AlertTitle>
          <p>Alert message</p>
        </Alert>
      );
      
      expect(screen.getByText("Alert Title")).toBeInTheDocument();
      expect(screen.getByText("Alert message")).toBeInTheDocument();
    });

    it("should render as h4 element", () => {
      const { container } = render(
        <Alert>
          <AlertTitle>Title</AlertTitle>
        </Alert>
      );
      
      const title = container.querySelector("h4");
      expect(title).toBeInTheDocument();
      expect(title).toHaveTextContent("Title");
    });

    it("should accept custom className", () => {
      const { container } = render(
        <Alert>
          <AlertTitle className="custom-title">Title</AlertTitle>
        </Alert>
      );
      
      const title = container.querySelector("h4");
      expect(title).toHaveClass("custom-title");
    });
  });

  describe("Styling", () => {
    it("should apply info variant styles", () => {
      render(<Alert variant="info">Info</Alert>);
      
      const alert = screen.getByRole("alert");
      expect(alert).toHaveClass("border-primary");
    });

    it("should apply success variant styles", () => {
      render(<Alert variant="success">Success</Alert>);
      
      const alert = screen.getByRole("alert");
      expect(alert).toHaveClass("border-success");
    });

    it("should apply warning variant styles", () => {
      render(<Alert variant="warning">Warning</Alert>);
      
      const alert = screen.getByRole("alert");
      expect(alert).toHaveClass("border-warning");
    });

    it("should apply danger variant styles", () => {
      render(<Alert variant="danger">Danger</Alert>);
      
      const alert = screen.getByRole("alert");
      expect(alert).toHaveClass("border-danger");
    });

    it("should accept custom className", () => {
      render(<Alert className="custom-alert">Message</Alert>);
      
      const alert = screen.getByRole("alert");
      expect(alert).toHaveClass("custom-alert");
    });
  });

  describe("Accessibility", () => {
    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(<Alert ref={ref}>Message</Alert>);
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    });

    it("should accept additional HTML attributes", () => {
      render(<Alert data-testid="custom-alert">Message</Alert>);
      
      const alert = screen.getByTestId("custom-alert");
      expect(alert).toBeInTheDocument();
    });
  });
});
