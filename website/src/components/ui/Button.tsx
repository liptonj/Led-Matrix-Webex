import { cn } from '@/lib/utils';
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'link';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', block = false, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 border rounded-lg font-medium cursor-pointer transition-all no-underline',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          // Size variants
          size === 'sm' && 'px-3 py-1.5 text-xs',
          size === 'md' && 'px-4 py-2.5 text-sm',
          size === 'lg' && 'px-6 py-3.5 text-base',
          // Color variants
          variant === 'default' && 'border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]',
          variant === 'primary' && 'border-primary bg-primary text-white hover:bg-primary-dark',
          variant === 'success' && 'border-success bg-success text-white hover:brightness-90',
          variant === 'warning' && 'border-warning text-warning bg-transparent hover:bg-warning/15',
          variant === 'danger' && 'border-danger text-danger bg-transparent hover:bg-danger/15',
          variant === 'link' && 'border-0 bg-transparent text-primary p-0 hover:underline',
          // Block variant
          block && 'w-full',
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
