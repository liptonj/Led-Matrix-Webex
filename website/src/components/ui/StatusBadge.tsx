import { cn } from '@/lib/utils';
import { HTMLAttributes, forwardRef } from 'react';

export type StatusVariant = 
  | 'online' 
  | 'offline' 
  | 'pending' 
  | 'approved' 
  | 'rejected'
  | 'active'
  | 'inactive'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: StatusVariant;
  label?: string;
  showDot?: boolean;
}

/**
 * StatusBadge component for displaying status indicators with consistent styling.
 * 
 * @example
 * <StatusBadge status="online" />
 * <StatusBadge status="pending" label="Pending Approval" />
 * <StatusBadge status="approved" showDot={false} />
 */
export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, status, label, showDot = true, ...props }, ref) => {
    const statusConfig: Record<StatusVariant, { color: string; defaultLabel: string }> = {
      online: { 
        color: 'bg-success/10 text-success border-success', 
        defaultLabel: 'Online' 
      },
      offline: { 
        color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600', 
        defaultLabel: 'Offline' 
      },
      pending: { 
        color: 'bg-warning/10 text-warning border-warning', 
        defaultLabel: 'Pending' 
      },
      approved: { 
        color: 'bg-success/10 text-success border-success', 
        defaultLabel: 'Approved' 
      },
      rejected: { 
        color: 'bg-danger/10 text-danger border-danger', 
        defaultLabel: 'Rejected' 
      },
      active: { 
        color: 'bg-primary/10 text-primary border-primary', 
        defaultLabel: 'Active' 
      },
      inactive: { 
        color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600', 
        defaultLabel: 'Inactive' 
      },
      success: { 
        color: 'bg-success/10 text-success border-success', 
        defaultLabel: 'Success' 
      },
      warning: { 
        color: 'bg-warning/10 text-warning border-warning', 
        defaultLabel: 'Warning' 
      },
      danger: { 
        color: 'bg-danger/10 text-danger border-danger', 
        defaultLabel: 'Error' 
      },
      info: { 
        color: 'bg-primary/10 text-primary border-primary', 
        defaultLabel: 'Info' 
      },
    };

    const config = statusConfig[status];
    const displayLabel = label ?? config.defaultLabel;

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
          config.color,
          className
        )}
        {...props}
      >
        {showDot && (
          <span 
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              status === 'online' && 'bg-success',
              status === 'offline' && 'bg-gray-400 dark:bg-gray-500',
              status === 'pending' && 'bg-warning',
              status === 'approved' && 'bg-success',
              status === 'rejected' && 'bg-danger',
              status === 'active' && 'bg-primary',
              status === 'inactive' && 'bg-gray-400 dark:bg-gray-500',
              status === 'success' && 'bg-success',
              status === 'warning' && 'bg-warning',
              status === 'danger' && 'bg-danger',
              status === 'info' && 'bg-primary',
            )}
            aria-hidden="true"
          />
        )}
        {displayLabel}
      </span>
    );
  }
);

StatusBadge.displayName = 'StatusBadge';
