import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal, ModalFooter } from '../Modal';

describe('Modal', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    // Reset body overflow
    document.body.style.overflow = '';
  });

  describe('rendering', () => {
    it('does not render when open is false', () => {
      render(
        <Modal open={false} onClose={mockOnClose}>
          <p>Content</p>
        </Modal>
      );
      expect(screen.queryByText('Content')).not.toBeInTheDocument();
    });

    it('renders when open is true', () => {
      render(
        <Modal open={true} onClose={mockOnClose}>
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('renders title when provided', () => {
      render(
        <Modal open={true} onClose={mockOnClose} title="Test Modal">
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByText('Test Modal')).toBeInTheDocument();
    });

    it('renders close button by default', () => {
      render(
        <Modal open={true} onClose={mockOnClose} title="Test Modal">
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByLabelText('Close modal')).toBeInTheDocument();
    });

    it('hides close button when showCloseButton is false', () => {
      render(
        <Modal open={true} onClose={mockOnClose} showCloseButton={false}>
          <p>Content</p>
        </Modal>
      );
      expect(screen.queryByLabelText('Close modal')).not.toBeInTheDocument();
    });
  });

  describe('size variants', () => {
    it('applies small size class', () => {
      const { container } = render(
        <Modal open={true} onClose={mockOnClose} size="sm">
          <p>Content</p>
        </Modal>
      );
      const modal = container.querySelector('.max-w-sm');
      expect(modal).toBeInTheDocument();
    });

    it('applies medium size class by default', () => {
      const { container } = render(
        <Modal open={true} onClose={mockOnClose}>
          <p>Content</p>
        </Modal>
      );
      const modal = container.querySelector('.max-w-md');
      expect(modal).toBeInTheDocument();
    });

    it('applies large size class', () => {
      const { container } = render(
        <Modal open={true} onClose={mockOnClose} size="lg">
          <p>Content</p>
        </Modal>
      );
      const modal = container.querySelector('.max-w-lg');
      expect(modal).toBeInTheDocument();
    });

    it('applies extra large size class', () => {
      const { container } = render(
        <Modal open={true} onClose={mockOnClose} size="xl">
          <p>Content</p>
        </Modal>
      );
      const modal = container.querySelector('.max-w-xl');
      expect(modal).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onClose when close button is clicked', () => {
      render(
        <Modal open={true} onClose={mockOnClose} title="Test Modal">
          <p>Content</p>
        </Modal>
      );
      
      fireEvent.click(screen.getByLabelText('Close modal'));
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when backdrop is clicked', () => {
      const { container } = render(
        <Modal open={true} onClose={mockOnClose}>
          <p>Content</p>
        </Modal>
      );
      
      const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
      expect(backdrop).toBeInTheDocument();
      
      fireEvent.click(backdrop as Element);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when backdrop is clicked and closeOnOverlayClick is false', () => {
      const { container } = render(
        <Modal open={true} onClose={mockOnClose} closeOnOverlayClick={false}>
          <p>Content</p>
        </Modal>
      );
      
      const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
      fireEvent.click(backdrop as Element);
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('calls onClose when Escape key is pressed', () => {
      render(
        <Modal open={true} onClose={mockOnClose}>
          <p>Content</p>
        </Modal>
      );
      
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('body scroll lock', () => {
    it('prevents body scroll when modal is open', () => {
      render(
        <Modal open={true} onClose={mockOnClose}>
          <p>Content</p>
        </Modal>
      );
      
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body scroll when modal is closed', () => {
      const { rerender } = render(
        <Modal open={true} onClose={mockOnClose}>
          <p>Content</p>
        </Modal>
      );
      
      expect(document.body.style.overflow).toBe('hidden');
      
      rerender(
        <Modal open={false} onClose={mockOnClose}>
          <p>Content</p>
        </Modal>
      );
      
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('accessibility', () => {
    it('has correct ARIA attributes', () => {
      const { container } = render(
        <Modal open={true} onClose={mockOnClose} title="Test Modal">
          <p>Content</p>
        </Modal>
      );
      
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
    });

    it('forwards ref correctly', () => {
      const ref = jest.fn();
      render(
        <Modal open={true} onClose={mockOnClose} ref={ref}>
          <p>Content</p>
        </Modal>
      );
      expect(ref).toHaveBeenCalled();
    });
  });
});

describe('ModalFooter', () => {
  it('renders children', () => {
    render(
      <ModalFooter>
        <button>Cancel</button>
        <button>Confirm</button>
      </ModalFooter>
    );
    
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <ModalFooter className="custom-class">
        <button>Action</button>
      </ModalFooter>
    );
    
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('forwards ref correctly', () => {
    const ref = jest.fn();
    render(
      <ModalFooter ref={ref}>
        <button>Action</button>
      </ModalFooter>
    );
    expect(ref).toHaveBeenCalled();
  });
});
