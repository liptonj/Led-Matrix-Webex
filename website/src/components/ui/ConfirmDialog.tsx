'use client';

import { forwardRef, HTMLAttributes, ReactNode, useState } from 'react';
import { Button } from './Button';
import { Modal, ModalFooter } from './Modal';

interface ConfirmDialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger' | 'warning';
  loading?: boolean;
}

/**
 * ConfirmDialog component for confirmation prompts.
 * Replaces window.confirm() with a more user-friendly modal.
 * 
 * @example
 * const [open, setOpen] = useState(false);
 * 
 * <ConfirmDialog
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   onConfirm={handleDelete}
 *   title="Delete Device"
 *   message="Delete device ESP32-ABC123? This cannot be undone."
 *   variant="danger"
 *   confirmLabel="Delete"
 * />
 */
export const ConfirmDialog = forwardRef<HTMLDivElement, ConfirmDialogProps>(
  ({ 
    open, 
    onClose, 
    onConfirm, 
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
    loading = false,
    children,
    ...props 
  }, ref) => {
    const handleConfirm = () => {
      onConfirm();
      onClose();
    };

    const buttonVariant = variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'primary';

    return (
      <Modal
        ref={ref}
        open={open}
        onClose={onClose}
        size="sm"
        closeOnOverlayClick={!loading}
        {...props}
      >
        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">
              {title}
            </h3>
            {message && (
              <p className="text-sm text-[var(--color-text-secondary)]">
                {message}
              </p>
            )}
          </div>

          {/* Custom content */}
          {children}
        </div>

        {/* Footer */}
        <ModalFooter className="px-0 py-0 mt-6 border-0">
          <Button
            type="button"
            variant="default"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={buttonVariant}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? 'Processing...' : confirmLabel}
          </Button>
        </ModalFooter>
      </Modal>
    );
  }
);

ConfirmDialog.displayName = 'ConfirmDialog';

/**
 * Hook for managing confirm dialog state
 * 
 * @example
 * const confirmDelete = useConfirmDialog();
 * 
 * <button onClick={() => confirmDelete.open()}>Delete</button>
 * 
 * <ConfirmDialog
 *   open={confirmDelete.isOpen}
 *   onClose={confirmDelete.close}
 *   onConfirm={handleDelete}
 *   title="Delete Item"
 *   message="Are you sure?"
 * />
 */
export function useConfirmDialog() {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((prev) => !prev),
  };
}
