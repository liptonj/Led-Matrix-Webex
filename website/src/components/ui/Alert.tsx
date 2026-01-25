import { cn } from '@/lib/utils';
import { HTMLAttributes, forwardRef } from 'react';

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'success' | 'warning' | 'danger';
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'info', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          'p-4 rounded-lg border mb-4',
          'bg-[var(--color-surface-alt)]',
          variant === 'info' && 'border-primary bg-primary/10',
          variant === 'success' && 'border-success bg-success/10',
          variant === 'warning' && 'border-warning bg-warning/10',
          variant === 'danger' && 'border-danger bg-danger/10',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Alert.displayName = 'Alert';

interface AlertTitleProps extends HTMLAttributes<HTMLHeadingElement> {}

export const AlertTitle = forwardRef<HTMLHeadingElement, AlertTitleProps>(
  ({ className, ...props }, ref) => {
    return (
      <h4
        ref={ref}
        className={cn('mb-2 font-medium text-[0.9375rem]', className)}
        {...props}
      />
    );
  }
);

AlertTitle.displayName = 'AlertTitle';
