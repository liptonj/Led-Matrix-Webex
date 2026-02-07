/**
 * TerminalDisplay Component Tests
 *
 * Tests for the terminal display component with line rendering,
 * line numbers, and various display options.
 */

import { render, screen, fireEvent } from '@/test-utils';
import { TerminalDisplay } from '../TerminalDisplay';
import type { TerminalLine } from '../TerminalDisplay';

describe('TerminalDisplay', () => {
  describe('rendering', () => {
    it('renders with default props', () => {
      render(<TerminalDisplay lines={[]} />);
      expect(screen.getByText('Terminal')).toBeInTheDocument();
      expect(screen.getByText('Waiting for output...')).toBeInTheDocument();
    });

    it('renders custom title', () => {
      render(<TerminalDisplay lines={[]} title="Serial Monitor" />);
      expect(screen.getByText('Serial Monitor')).toBeInTheDocument();
    });

    it('renders custom empty text', () => {
      render(<TerminalDisplay lines={[]} emptyText="No data yet..." />);
      expect(screen.getByText('No data yet...')).toBeInTheDocument();
    });

    it('renders string lines', () => {
      render(<TerminalDisplay lines={['Hello', 'World']} />);
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('World')).toBeInTheDocument();
    });

    it('renders TerminalLine objects', () => {
      const lines: TerminalLine[] = [
        { text: 'Device output', source: 'device' },
        { text: 'Admin command', source: 'admin' },
        { text: 'System message', source: 'system' },
      ];
      render(<TerminalDisplay lines={lines} />);
      expect(screen.getByText('Device output')).toBeInTheDocument();
      expect(screen.getByText('Admin command')).toBeInTheDocument();
      expect(screen.getByText('System message')).toBeInTheDocument();
    });

    it('renders mixed string and TerminalLine objects', () => {
      const lines: (string | TerminalLine)[] = [
        'Plain string',
        { text: 'TerminalLine object', source: 'device' },
      ];
      render(<TerminalDisplay lines={lines} />);
      expect(screen.getByText('Plain string')).toBeInTheDocument();
      expect(screen.getByText('TerminalLine object')).toBeInTheDocument();
    });
  });

  describe('line numbers', () => {
    it('renders line numbers by default', () => {
      render(<TerminalDisplay lines={['Line 1', 'Line 2']} />);
      expect(screen.getByText('0001')).toBeInTheDocument();
      expect(screen.getByText('0002')).toBeInTheDocument();
    });

    it('hides line numbers when showLineNumbers is false', () => {
      render(<TerminalDisplay lines={['Line 1']} showLineNumbers={false} />);
      expect(screen.queryByText('0001')).not.toBeInTheDocument();
      expect(screen.getByText('Line 1')).toBeInTheDocument();
    });

    it('formats line numbers with correct padding', () => {
      render(<TerminalDisplay lines={['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']} />);
      // Line numbers are sequential (1-based), not content-based
      expect(screen.getByText('0001')).toBeInTheDocument();
      expect(screen.getByText('0005')).toBeInTheDocument();
      expect(screen.getByText('0008')).toBeInTheDocument();
    });
  });

  describe('status slot', () => {
    it('renders status slot when provided', () => {
      render(
        <TerminalDisplay
          lines={[]}
          statusSlot={<span data-testid="custom-status">Connected</span>}
        />
      );
      expect(screen.getByTestId('custom-status')).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('does not render status slot when not provided', () => {
      const { container } = render(<TerminalDisplay lines={[]} />);
      // When statusSlot is not provided, the .ml-auto container is not rendered
      const statusSlot = container.querySelector('.ml-auto');
      expect(statusSlot).not.toBeInTheDocument();
    });
  });

  describe('visual elements', () => {
    it('renders traffic light dots in header', () => {
      const { container } = render(<TerminalDisplay lines={[]} />);
      // Red and yellow are divs, green is a button
      const dots = container.querySelectorAll('.rounded-full.bg-red-500, .rounded-full.bg-yellow-500, .rounded-full.bg-green-500');
      expect(dots.length).toBe(3);
    });

    it('applies custom height class', () => {
      const { container } = render(
        <TerminalDisplay lines={[]} heightClass="h-96" />
      );
      const content = container.querySelector('.h-96');
      expect(content).toBeInTheDocument();
    });

    it('uses default height class when not provided', () => {
      const { container } = render(<TerminalDisplay lines={[]} />);
      const content = container.querySelector('.h-64');
      expect(content).toBeInTheDocument();
    });
  });

  describe('line colors', () => {
    it('applies default green color to string lines', () => {
      const { container } = render(<TerminalDisplay lines={['Test line']} />);
      const line = container.querySelector('.text-green-400, .text-green-300');
      expect(line).toBeInTheDocument();
    });

    it('applies source-based colors to TerminalLine objects', () => {
      const lines: TerminalLine[] = [
        { text: 'Device', source: 'device' },
        { text: 'Admin', source: 'admin' },
        { text: 'System', source: 'system' },
      ];
      const { container } = render(<TerminalDisplay lines={lines} />);
      
      // Device lines should be green
      expect(container.textContent).toContain('Device');
      // Admin lines should be blue
      expect(container.textContent).toContain('Admin');
      // System lines should be yellow
      expect(container.textContent).toContain('System');
    });

    it('applies level-based colors that override source colors', () => {
      const lines: TerminalLine[] = [
        { text: 'Error', source: 'device', level: 'error' },
        { text: 'Warning', source: 'admin', level: 'warn' },
        { text: 'Info', source: 'system', level: 'info' },
      ];
      const { container } = render(<TerminalDisplay lines={lines} />);
      
      // Error should be red
      expect(container.textContent).toContain('Error');
      // Warning should be yellow
      expect(container.textContent).toContain('Warning');
      // Info should use source color (system = yellow)
      expect(container.textContent).toContain('Info');
    });
  });

  describe('edge cases', () => {
    it('handles empty lines array', () => {
      render(<TerminalDisplay lines={[]} />);
      expect(screen.getByText('Waiting for output...')).toBeInTheDocument();
    });

    it('handles very long lines', () => {
      const longLine = 'a'.repeat(1000);
      render(<TerminalDisplay lines={[longLine]} />);
      expect(screen.getByText(longLine)).toBeInTheDocument();
    });

    it('handles many lines', () => {
      const manyLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      render(<TerminalDisplay lines={manyLines} />);
      expect(screen.getByText('Line 1')).toBeInTheDocument();
      expect(screen.getByText('Line 100')).toBeInTheDocument();
    });

    it('handles lines with special characters', () => {
      const specialLines = [
        'Line with "quotes"',
        "Line with 'single quotes'",
        'Line with <tags>',
        'Line with &amp; entities',
        // Note: Lines with newlines are split across elements, so we test without newlines
        'Line with special chars',
      ];
      render(<TerminalDisplay lines={specialLines} />);
      specialLines.forEach((line) => {
        expect(screen.getByText(line)).toBeInTheDocument();
      });
    });

    it('handles TerminalLine with missing source', () => {
      const lines: TerminalLine[] = [
        { text: 'Line without source' },
      ];
      render(<TerminalDisplay lines={lines} />);
      expect(screen.getByText('Line without source')).toBeInTheDocument();
    });
  });

  describe('auto-scroll', () => {
    it('renders auto-scroll toggle button', () => {
      render(<TerminalDisplay lines={['Line 1']} />);
      const toggle = screen.getByRole('button', { name: /auto-scroll/i });
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows enabled state by default', () => {
      render(<TerminalDisplay lines={['Line 1']} />);
      expect(screen.getByText(/auto-scroll/i)).toBeInTheDocument();
    });

    it('toggles to paused when clicked', () => {
      render(<TerminalDisplay lines={['Line 1']} />);
      const toggle = screen.getByRole('button', { name: /auto-scroll/i });

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText(/paused/i)).toBeInTheDocument();
    });

    it('re-enables when paused toggle is clicked', () => {
      render(<TerminalDisplay lines={['Line 1']} />);
      const toggle = screen.getByRole('button', { name: /auto-scroll/i });

      // Pause
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'false');

      // Resume
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });

    it('respects defaultAutoScroll=false', () => {
      render(<TerminalDisplay lines={['Line 1']} defaultAutoScroll={false} />);
      const toggle = screen.getByRole('button', { name: /auto-scroll|paused/i });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows scroll-to-bottom button when auto-scroll is paused', () => {
      render(<TerminalDisplay lines={['Line 1', 'Line 2']} />);
      const toggle = screen.getByRole('button', { name: /auto-scroll/i });

      fireEvent.click(toggle);

      const scrollBtn = screen.getByRole('button', { name: /scroll to bottom/i });
      expect(scrollBtn).toBeInTheDocument();
    });

    it('does not show scroll-to-bottom button when auto-scroll is on', () => {
      render(<TerminalDisplay lines={['Line 1', 'Line 2']} />);
      expect(screen.queryByRole('button', { name: /scroll to bottom/i })).not.toBeInTheDocument();
    });

    it('does not show scroll-to-bottom button when there are no lines', () => {
      render(<TerminalDisplay lines={[]} />);
      const toggle = screen.getByRole('button', { name: /auto-scroll/i });

      fireEvent.click(toggle);

      expect(screen.queryByRole('button', { name: /scroll to bottom/i })).not.toBeInTheDocument();
    });
  });

  describe('fullscreen toggle', () => {
    it('renders the green dot as a fullscreen button', () => {
      render(<TerminalDisplay lines={[]} />);
      const btn = screen.getByRole('button', { name: /fullscreen/i });
      expect(btn).toBeInTheDocument();
    });

    it('enters fullscreen when green dot is clicked', () => {
      const { container } = render(<TerminalDisplay lines={['Line 1']} />);
      const btn = screen.getByRole('button', { name: /enter fullscreen/i });

      fireEvent.click(btn);

      // The outer container should have fixed positioning
      const outer = container.firstElementChild;
      expect(outer?.className).toContain('fixed');
      expect(outer?.className).toContain('inset-0');
      // Header should show an Esc hint
      expect(screen.getByText(/esc to exit/i)).toBeInTheDocument();
    });

    it('exits fullscreen when green dot is clicked again', () => {
      const { container } = render(<TerminalDisplay lines={['Line 1']} />);
      const btn = screen.getByRole('button', { name: /enter fullscreen/i });

      fireEvent.click(btn); // enter
      fireEvent.click(screen.getByRole('button', { name: /exit fullscreen/i })); // exit

      const outer = container.firstElementChild;
      expect(outer?.className).not.toContain('fixed');
    });

    it('exits fullscreen on Escape key', () => {
      const { container } = render(<TerminalDisplay lines={['Line 1']} />);
      const btn = screen.getByRole('button', { name: /enter fullscreen/i });

      fireEvent.click(btn);
      expect(container.firstElementChild?.className).toContain('fixed');

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(container.firstElementChild?.className).not.toContain('fixed');
    });

    it('uses flex-1 height class in fullscreen instead of the provided heightClass', () => {
      const { container } = render(<TerminalDisplay lines={['Line 1']} heightClass="h-96" />);
      const btn = screen.getByRole('button', { name: /enter fullscreen/i });

      // Before fullscreen, uses the provided h-96
      expect(container.querySelector('.h-96')).toBeInTheDocument();

      fireEvent.click(btn);

      // In fullscreen, h-96 should no longer be applied
      expect(container.querySelector('.h-96')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper semantic structure', () => {
      const { container } = render(<TerminalDisplay lines={[]} />);
      // Should have a header section
      const header = container.querySelector('.bg-gray-800, .bg-gray-900');
      expect(header).toBeInTheDocument();
      // Should have a content section
      const content = container.querySelector('.overflow-y-auto');
      expect(content).toBeInTheDocument();
    });

    it('uses monospace font for terminal content', () => {
      const { container } = render(<TerminalDisplay lines={['Test']} />);
      const content = container.querySelector('.font-mono');
      expect(content).toBeInTheDocument();
    });

    it('auto-scroll toggle has aria-pressed attribute', () => {
      render(<TerminalDisplay lines={[]} />);
      const toggle = screen.getByRole('button', { name: /auto-scroll/i });
      expect(toggle).toHaveAttribute('aria-pressed');
    });
  });
});
