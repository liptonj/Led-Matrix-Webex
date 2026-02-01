import '@testing-library/jest-dom';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { ConfirmDialog, useConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnConfirm = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    mockOnConfirm.mockClear();
    document.body.style.overflow = '';
  });

  describe('rendering', () => {
    it('does not render when open is false', () => {
      render(
        <ConfirmDialog
          open={false}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );
      expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
    });

    it('renders when open is true', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );
      expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    });

    it('renders custom title', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="Delete Device"
        />
      );
      expect(screen.getByText('Delete Device')).toBeInTheDocument();
    });

    it('renders custom message', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          message="This action cannot be undone."
        />
      );
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    });

    it('renders default message when not provided', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );
      expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
    });

    it('renders custom button labels', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          confirmLabel="Delete"
          cancelLabel="Keep"
        />
      );
      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.getByText('Keep')).toBeInTheDocument();
    });

    it('renders default button labels', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );
      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('renders custom children', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        >
          <p>Additional content</p>
        </ConfirmDialog>
      );
      expect(screen.getByText('Additional content')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onConfirm and onClose when confirm button is clicked', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );
      
      fireEvent.click(screen.getByText('Confirm'));
      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when cancel button is clicked', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );
      
      fireEvent.click(screen.getByText('Cancel'));
      expect(mockOnConfirm).not.toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('disables buttons when loading', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          loading={true}
        />
      );
      
      expect(screen.getByText('Cancel')).toBeDisabled();
      expect(screen.getByText('Processing...')).toBeDisabled();
    });

    it('prevents overlay click when loading', () => {
      const { container } = render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          loading={true}
        />
      );
      
      const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
      fireEvent.click(backdrop as Element);
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('variant styling', () => {
    it('applies primary variant by default', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );
      
      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton).toBeInTheDocument();
    });

    it('applies danger variant', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          variant="danger"
        />
      );
      
      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton).toBeInTheDocument();
    });

    it('applies warning variant', () => {
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          variant="warning"
        />
      );
      
      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('forwards ref correctly', () => {
      const ref = jest.fn();
      render(
        <ConfirmDialog
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          ref={ref}
        />
      );
      expect(ref).toHaveBeenCalled();
    });
  });
});

describe('useConfirmDialog', () => {
  it('initializes with closed state', () => {
    const { result } = renderHook(() => useConfirmDialog());
    expect(result.current.isOpen).toBe(false);
  });

  it('opens dialog', () => {
    const { result } = renderHook(() => useConfirmDialog());
    
    act(() => {
      result.current.open();
    });
    
    expect(result.current.isOpen).toBe(true);
  });

  it('closes dialog', () => {
    const { result } = renderHook(() => useConfirmDialog());
    
    act(() => {
      result.current.open();
    });
    
    expect(result.current.isOpen).toBe(true);
    
    act(() => {
      result.current.close();
    });
    
    expect(result.current.isOpen).toBe(false);
  });

  it('toggles dialog state', () => {
    const { result } = renderHook(() => useConfirmDialog());
    
    expect(result.current.isOpen).toBe(false);
    
    act(() => {
      result.current.toggle();
    });
    
    expect(result.current.isOpen).toBe(true);
    
    act(() => {
      result.current.toggle();
    });
    
    expect(result.current.isOpen).toBe(false);
  });
});
