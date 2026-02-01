/**
 * Breadcrumbs Component Tests
 *
 * Tests for the Breadcrumbs navigation component.
 */

import { render, screen } from "@/test-utils";
import { Breadcrumbs } from "../Breadcrumbs";

// Mock Next.js usePathname
const mockPathname = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

describe("Breadcrumbs", () => {
  describe("Rendering", () => {
    it("should not render on homepage", () => {
      mockPathname.mockReturnValue("/");
      
      const { container } = render(<Breadcrumbs />);
      
      expect(container.firstChild).toBeNull();
    });

    it("should render breadcrumbs for single segment", () => {
      mockPathname.mockReturnValue("/install");
      
      render(<Breadcrumbs />);
      
      expect(screen.getByText("Home")).toBeInTheDocument();
      expect(screen.getByText("Install")).toBeInTheDocument();
    });

    it("should render breadcrumbs for multiple segments", () => {
      mockPathname.mockReturnValue("/docs/api-docs");
      
      render(<Breadcrumbs />);
      
      expect(screen.getByText("Home")).toBeInTheDocument();
      expect(screen.getByText("Docs")).toBeInTheDocument();
      expect(screen.getByText("API Docs")).toBeInTheDocument();
    });

    it("should use custom page titles when available", () => {
      mockPathname.mockReturnValue("/troubleshooting");
      
      render(<Breadcrumbs />);
      
      expect(screen.getByText("Troubleshooting")).toBeInTheDocument();
    });

    it("should capitalize unknown segments", () => {
      mockPathname.mockReturnValue("/unknown-page");
      
      render(<Breadcrumbs />);
      
      expect(screen.getByText("Unknown-page")).toBeInTheDocument();
    });
  });

  describe("Navigation", () => {
    it("should have home link", () => {
      mockPathname.mockReturnValue("/install");
      
      render(<Breadcrumbs />);
      
      const homeLink = screen.getByText("Home").closest("a");
      expect(homeLink).toHaveAttribute("href", "/");
    });

    it("should have intermediate links", () => {
      mockPathname.mockReturnValue("/docs/api-docs");
      
      render(<Breadcrumbs />);
      
      const docsLink = screen.getByText("Docs").closest("a");
      expect(docsLink).toHaveAttribute("href", "/docs");
    });

    it("should not link last segment", () => {
      mockPathname.mockReturnValue("/install");
      
      render(<Breadcrumbs />);
      
      const installElement = screen.getByText("Install");
      expect(installElement.tagName).toBe("SPAN");
      expect(installElement.closest("a")).toBeNull();
    });
  });

  describe("Accessibility", () => {
    it("should have breadcrumb navigation landmark", () => {
      mockPathname.mockReturnValue("/install");
      
      render(<Breadcrumbs />);
      
      const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(nav).toBeInTheDocument();
    });

    it("should mark current page with aria-current", () => {
      mockPathname.mockReturnValue("/install");
      
      render(<Breadcrumbs />);
      
      const currentPage = screen.getByText("Install");
      expect(currentPage).toHaveAttribute("aria-current", "page");
    });

    it("should hide separators from screen readers", () => {
      mockPathname.mockReturnValue("/install");
      
      const { container } = render(<Breadcrumbs />);
      
      const separator = container.querySelector('[aria-hidden="true"]');
      expect(separator).toBeInTheDocument();
      expect(separator).toHaveTextContent("/");
    });
  });

  describe("Complex Paths", () => {
    it("should handle deeply nested paths", () => {
      mockPathname.mockReturnValue("/docs/api/v1/endpoints");
      
      render(<Breadcrumbs />);
      
      expect(screen.getByText("Home")).toBeInTheDocument();
      expect(screen.getByText("Docs")).toBeInTheDocument();
      expect(screen.getByText("Api")).toBeInTheDocument();
      expect(screen.getByText("V1")).toBeInTheDocument();
      expect(screen.getByText("Endpoints")).toBeInTheDocument();
    });

    it("should build correct links for nested paths", () => {
      mockPathname.mockReturnValue("/docs/api/v1");
      
      render(<Breadcrumbs />);
      
      const docsLink = screen.getByText("Docs").closest("a");
      expect(docsLink).toHaveAttribute("href", "/docs");
      
      const apiLink = screen.getByText("Api").closest("a");
      expect(apiLink).toHaveAttribute("href", "/docs/api");
      
      const v1Element = screen.getByText("V1");
      expect(v1Element.closest("a")).toBeNull(); // Last segment not linked
    });
  });
});
