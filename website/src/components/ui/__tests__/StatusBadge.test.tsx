import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  describe('rendering', () => {
    it('renders with default label for online status', () => {
      render(<StatusBadge status="online" />);
      expect(screen.getByText('Online')).toBeInTheDocument();
    });

    it('renders with custom label', () => {
      render(<StatusBadge status="online" label="Connected" />);
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('renders dot indicator by default', () => {
      const { container } = render(<StatusBadge status="online" />);
      // Dot is the first span with aria-hidden, has rounded-full class
      const dot = container.querySelector('span.rounded-full[aria-hidden="true"]');
      expect(dot).toBeInTheDocument();
    });

    it('hides dot indicator when showDot is false', () => {
      const { container } = render(<StatusBadge status="online" showDot={false} />);
      // Check that the dot (rounded-full) is not present
      const dot = container.querySelector('span.rounded-full[aria-hidden="true"]');
      expect(dot).not.toBeInTheDocument();
    });

    it('renders icon for accessibility', () => {
      render(<StatusBadge status="online" />);
      // Icon is always present - check for checkmark (✓) for online status
      expect(screen.getByText('✓')).toBeInTheDocument();
    });

    it('renders appropriate icon for each status', () => {
      const statusIcons: Record<string, string> = {
        online: '✓',
        offline: '○',
        pending: '⚠',
        warning: '⚠',
        rejected: '✕',
        danger: '✕',
        active: 'ℹ',
      };

      Object.entries(statusIcons).forEach(([status, icon]) => {
        const { rerender } = render(
          <StatusBadge status={status as import('../StatusBadge').StatusVariant} />
        );
        expect(screen.getByText(icon)).toBeInTheDocument();
        rerender(<div />); // Clear for next iteration
      });
    });
  });

  describe('status variants', () => {
    const variants: Array<{ status: import('../StatusBadge').StatusVariant; defaultLabel: string }> = [
      { status: 'online', defaultLabel: 'Online' },
      { status: 'offline', defaultLabel: 'Offline' },
      { status: 'pending', defaultLabel: 'Pending' },
      { status: 'approved', defaultLabel: 'Approved' },
      { status: 'rejected', defaultLabel: 'Rejected' },
      { status: 'active', defaultLabel: 'Active' },
      { status: 'inactive', defaultLabel: 'Inactive' },
      { status: 'success', defaultLabel: 'Success' },
      { status: 'warning', defaultLabel: 'Warning' },
      { status: 'danger', defaultLabel: 'Error' },
      { status: 'info', defaultLabel: 'Info' },
    ];

    variants.forEach(({ status, defaultLabel }) => {
      it(`renders ${status} status with default label`, () => {
        render(<StatusBadge status={status} />);
        expect(screen.getByText(defaultLabel)).toBeInTheDocument();
      });
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      const { container } = render(
        <StatusBadge status="online" className="custom-class" />
      );
      const badge = container.firstChild;
      expect(badge).toHaveClass('custom-class');
    });

    it('applies success color for online status', () => {
      const { container } = render(<StatusBadge status="online" />);
      const badge = container.firstChild;
      expect(badge).toHaveClass('text-success');
    });

    it('applies warning color for pending status', () => {
      const { container } = render(<StatusBadge status="pending" />);
      const badge = container.firstChild;
      expect(badge).toHaveClass('text-warning');
    });

    it('applies danger color for rejected status', () => {
      const { container } = render(<StatusBadge status="rejected" />);
      const badge = container.firstChild;
      expect(badge).toHaveClass('text-danger');
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA role and label', () => {
      render(<StatusBadge status="online" label="Device Online" />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveAttribute('aria-label', 'Status: Device Online');
    });

    it('uses default label in ARIA when no custom label provided', () => {
      render(<StatusBadge status="pending" />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveAttribute('aria-label', 'Status: Pending');
    });

    it('forwards ref correctly', () => {
      const ref = jest.fn();
      render(<StatusBadge status="online" ref={ref} />);
      expect(ref).toHaveBeenCalled();
    });

    it('spreads HTML attributes', () => {
      render(<StatusBadge status="online" data-testid="status-badge" />);
      expect(screen.getByTestId('status-badge')).toBeInTheDocument();
    });
  });
});
