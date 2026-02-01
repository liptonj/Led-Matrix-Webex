/**
 * Table Component Tests
 *
 * Tests for the Table UI component and its subcomponents.
 */

import { render, screen } from "@/test-utils";
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from "../Table";

describe("Table", () => {
  describe("Rendering", () => {
    it("should render table with content", () => {
      const { container } = render(
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Header</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      const table = container.querySelector("table");
      expect(table).toBeInTheDocument();
      expect(screen.getByText("Header")).toBeInTheDocument();
      expect(screen.getByText("Cell")).toBeInTheDocument();
    });

    it("should render responsive wrapper by default", () => {
      const { container } = render(<Table />);
      
      const wrapper = container.querySelector(".overflow-x-auto");
      expect(wrapper).toBeInTheDocument();
    });

    it("should not render responsive wrapper when responsive is false", () => {
      const { container } = render(<Table responsive={false} />);
      
      const wrapper = container.querySelector(".overflow-x-auto");
      expect(wrapper).not.toBeInTheDocument();
    });
  });

  describe("TableHead", () => {
    it("should render thead element", () => {
      const { container } = render(
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Header</TableHeader>
            </TableRow>
          </TableHead>
        </Table>
      );
      
      const thead = container.querySelector("thead");
      expect(thead).toBeInTheDocument();
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(
        <Table>
          <TableHead ref={ref}>
            <TableRow>
              <TableHeader>Header</TableHeader>
            </TableRow>
          </TableHead>
        </Table>
      );
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLTableSectionElement));
    });
  });

  describe("TableBody", () => {
    it("should render tbody element", () => {
      const { container } = render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      const tbody = container.querySelector("tbody");
      expect(tbody).toBeInTheDocument();
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(
        <Table>
          <TableBody ref={ref}>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLTableSectionElement));
    });
  });

  describe("TableRow", () => {
    it("should render tr element", () => {
      const { container } = render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      const tr = container.querySelector("tr");
      expect(tr).toBeInTheDocument();
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(
        <Table>
          <TableBody>
            <TableRow ref={ref}>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLTableRowElement));
    });
  });

  describe("TableHeader", () => {
    it("should render th element", () => {
      const { container } = render(
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Header</TableHeader>
            </TableRow>
          </TableHead>
        </Table>
      );
      
      const th = container.querySelector("th");
      expect(th).toBeInTheDocument();
      expect(th).toHaveTextContent("Header");
    });

    it("should have header styling", () => {
      const { container } = render(
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Header</TableHeader>
            </TableRow>
          </TableHead>
        </Table>
      );
      
      const th = container.querySelector("th");
      expect(th).toHaveClass("font-semibold", "border-b");
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader ref={ref}>Header</TableHeader>
            </TableRow>
          </TableHead>
        </Table>
      );
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLTableCellElement));
    });
  });

  describe("TableCell", () => {
    it("should render td element", () => {
      const { container } = render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell content</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      const td = container.querySelector("td");
      expect(td).toBeInTheDocument();
      expect(td).toHaveTextContent("Cell content");
    });

    it("should have cell styling", () => {
      const { container } = render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      const td = container.querySelector("td");
      expect(td).toHaveClass("p-3", "border-b");
    });

    it("should forward ref correctly", () => {
      const ref = jest.fn();
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell ref={ref}>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLTableCellElement));
    });
  });

  describe("Custom Styling", () => {
    it("should accept custom className on Table", () => {
      const { container } = render(<Table className="custom-table" />);
      
      const table = container.querySelector("table");
      expect(table).toHaveClass("custom-table");
    });

    it("should accept custom className on TableHeader", () => {
      const { container } = render(
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader className="custom-header">Header</TableHeader>
            </TableRow>
          </TableHead>
        </Table>
      );
      
      const th = container.querySelector("th");
      expect(th).toHaveClass("custom-header");
    });

    it("should accept custom className on TableCell", () => {
      const { container } = render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="custom-cell">Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      const td = container.querySelector("td");
      expect(td).toHaveClass("custom-cell");
    });
  });

  describe("Complex Table", () => {
    it("should render complete table structure", () => {
      render(
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Name</TableHeader>
              <TableHeader>Email</TableHeader>
              <TableHeader>Role</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>John Doe</TableCell>
              <TableCell>john@example.com</TableCell>
              <TableCell>Admin</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Jane Smith</TableCell>
              <TableCell>jane@example.com</TableCell>
              <TableCell>User</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("Role")).toBeInTheDocument();
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    });
  });
});
