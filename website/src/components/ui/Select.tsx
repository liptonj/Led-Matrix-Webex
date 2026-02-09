import { cn } from '@/lib/utils';
import { forwardRef, SelectHTMLAttributes } from 'react';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
}

/**
 * Select component with proper theming and contrast for light/dark modes.
 * 
 * @example
 * <Select size="sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
 *   <option value="all">All</option>
 *   <option value="pending">Pending</option>
 * </Select>
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = 'md', error = false, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'rounded-md border transition-colors',
          'bg-surface-alt text-[var(--color-text)]',
          'border-[var(--color-border)]',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'hover:border-[var(--color-text-muted)]',
          // Size variants
          size === 'sm' && 'text-xs px-2 py-1',
          size === 'md' && 'text-sm px-3 py-2',
          size === 'lg' && 'text-base px-4 py-2.5',
          // Error state
          error && 'border-danger focus:ring-danger focus:border-danger',
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';
