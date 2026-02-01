/**
 * Card Component Tests
 *
 * Tests for the Card UI component and its subcomponents.
 */

import { render, screen } from "@/test-utils";
import { Card, CardHeader, CardTitle, CardContent } from "../Card";

describe("Card", () => {
  describe("Rendering", () => {
    it("should render card with content", () => {
      render(<Card>Card content</Card>);
      
      expect(screen.getByText("Card content")).toBeInTheDocument();
    });

    it("should render featured variant", () => {
      const { container } = render(<Card featured>Featured card</Card>);
      
      const card = container.firstChild;
      expect(card).toHaveClass("border-success");
    });

    it("should render all subcomponents together", () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
          </CardHeader>
          <CardContent>Card content text</CardContent>
        </Card>
      );
      
      expect(screen.getByText("Card Title")).toBeInTheDocument();
      expect(screen.getByText("Card content text")).toBeInTheDocument();
    });
  });

  describe("CardHeader", () => {
    it("should render header", () => {
      const { container } = render(
        <Card>
          <CardHeader>Header content</CardHeader>
        </Card>
      );
      
      expect(screen.getByText("Header content")).toBeInTheDocument();
    });

    it("should accept custom className", () => {
      const { container } = render(
        <Card>
          <CardHeader className="custom-header">Header</CardHeader>
        </Card>
      );
      
      const header = container.querySelector(".custom-header");
      expect(header).toBeInTheDocument();
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(
        <Card>
          <CardHeader ref={ref}>Header</CardHeader>
        </Card>
      );
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    });
  });

  describe("CardTitle", () => {
    it("should render as h3 element", () => {
      const { container } = render(
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
          </CardHeader>
        </Card>
      );
      
      const title = container.querySelector("h3");
      expect(title).toBeInTheDocument();
      expect(title).toHaveTextContent("Title");
    });

    it("should accept custom className", () => {
      const { container } = render(
        <Card>
          <CardHeader>
            <CardTitle className="custom-title">Title</CardTitle>
          </CardHeader>
        </Card>
      );
      
      const title = container.querySelector("h3");
      expect(title).toHaveClass("custom-title");
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(
        <Card>
          <CardHeader>
            <CardTitle ref={ref}>Title</CardTitle>
          </CardHeader>
        </Card>
      );
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLHeadingElement));
    });
  });

  describe("CardContent", () => {
    it("should render content", () => {
      render(
        <Card>
          <CardContent>Content text</CardContent>
        </Card>
      );
      
      expect(screen.getByText("Content text")).toBeInTheDocument();
    });

    it("should accept custom className", () => {
      const { container } = render(
        <Card>
          <CardContent className="custom-content">Content</CardContent>
        </Card>
      );
      
      const content = container.querySelector(".custom-content");
      expect(content).toBeInTheDocument();
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(
        <Card>
          <CardContent ref={ref}>Content</CardContent>
        </Card>
      );
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    });
  });

  describe("Styling", () => {
    it("should apply base card styles", () => {
      const { container } = render(<Card>Content</Card>);
      
      const card = container.firstChild;
      expect(card).toHaveClass("rounded-lg", "p-6", "shadow-md", "border");
    });

    it("should accept custom className", () => {
      const { container } = render(<Card className="custom-card">Content</Card>);
      
      const card = container.firstChild;
      expect(card).toHaveClass("custom-card");
    });
  });

  describe("Accessibility", () => {
    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(<Card ref={ref}>Content</Card>);
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    });

    it("should accept additional HTML attributes", () => {
      render(<Card data-testid="custom-card">Content</Card>);
      
      const card = screen.getByTestId("custom-card");
      expect(card).toBeInTheDocument();
    });
  });

  describe("Complex Layouts", () => {
    it("should support nested complex content", () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Complex Card</CardTitle>
          </CardHeader>
          <CardContent>
            <p>First paragraph</p>
            <p>Second paragraph</p>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
          </CardContent>
        </Card>
      );
      
      expect(screen.getByText("Complex Card")).toBeInTheDocument();
      expect(screen.getByText("First paragraph")).toBeInTheDocument();
      expect(screen.getByText("Item 1")).toBeInTheDocument();
    });
  });
});
