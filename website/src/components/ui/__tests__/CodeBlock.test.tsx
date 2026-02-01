/**
 * CodeBlock Component Tests
 *
 * Tests for the CodeBlock UI component.
 */

import { render, screen } from "@/test-utils";
import { CodeBlock } from "../CodeBlock";

describe("CodeBlock", () => {
  describe("Rendering", () => {
    it("should render code content", () => {
      const code = "const hello = 'world';";
      render(<CodeBlock code={code} />);
      
      expect(screen.getByText(code)).toBeInTheDocument();
    });

    it("should render multiline code", () => {
      const code = `function test() {
  console.log('test');
}`;
      const { container } = render(<CodeBlock code={code} />);
      
      const codeElement = container.querySelector("code");
      expect(codeElement).toBeInTheDocument();
      expect(codeElement?.textContent).toContain("function test()");
      expect(codeElement?.textContent).toContain("console.log");
    });

    it("should render empty code", () => {
      const { container } = render(<CodeBlock code="" />);
      
      const codeElement = container.querySelector("code");
      expect(codeElement).toBeInTheDocument();
      expect(codeElement).toHaveTextContent("");
    });
  });

  describe("Styling", () => {
    it("should have proper code styling classes", () => {
      const { container } = render(<CodeBlock code="test" />);
      
      const codeElement = container.querySelector("code");
      expect(codeElement).toHaveClass("font-mono", "whitespace-pre-wrap");
    });

    it("should accept custom className", () => {
      const { container } = render(<CodeBlock code="test" className="custom-class" />);
      
      const wrapper = container.querySelector(".custom-class");
      expect(wrapper).toBeInTheDocument();
    });

    it("should have overflow-x-auto for long lines", () => {
      const { container } = render(<CodeBlock code="very long line of code" />);
      
      const wrapper = container.querySelector(".overflow-x-auto");
      expect(wrapper).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(<CodeBlock code="test" ref={ref} />);
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLPreElement));
    });

    it("should accept additional HTML attributes", () => {
      render(<CodeBlock code="test" data-testid="custom-code" />);
      
      const preElement = screen.getByTestId("custom-code");
      expect(preElement).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("should handle special characters", () => {
      const code = "<div>&nbsp;</div>";
      render(<CodeBlock code={code} />);
      
      expect(screen.getByText(code)).toBeInTheDocument();
    });

    it("should preserve code content", () => {
      const code = "  indented\n    more indented";
      const { container } = render(<CodeBlock code={code} />);
      
      const codeElement = container.querySelector("code");
      expect(codeElement).toBeInTheDocument();
      expect(codeElement?.textContent).toContain("indented");
      expect(codeElement?.textContent).toContain("more indented");
    });
  });
});
