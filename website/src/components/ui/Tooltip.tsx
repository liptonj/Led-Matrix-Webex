'use client';

import { cn } from '@/lib/utils';
import { HTMLAttributes, ReactNode, forwardRef, useState } from 'react';

interface TooltipProps extends Omit<HTMLAttributes<HTMLDivElement>, 'content'> {
  content: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

/**
 * Tooltip component for displaying additional information on hover/focus.
 * Fully keyboard accessible and respects theme colors.
 * 
 * @example
 * <Tooltip content="Full UUID: abc123-def456-...">
 *   <span className="truncate">abc123...</span>
 * </Tooltip>
 */
export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(
  ({ className, content, position = 'top', delay = 200, children, ...props }, ref) => {
    const [isVisible, setIsVisible] = useState(false);
    const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

    const handleMouseEnter = () => {
      const id = setTimeout(() => setIsVisible(true), delay);
      setTimeoutId(id);
    };

    const handleMouseLeave = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        setTimeoutId(null);
      }
      setIsVisible(false);
    };

    const handleFocus = () => {
      setIsVisible(true);
    };

    const handleBlur = () => {
      setIsVisible(false);
    };

    const positionClasses = {
      top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
      bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
      left: 'right-full top-1/2 -translate-y-1/2 mr-2',
      right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    };

    const arrowClasses = {
      top: 'top-full left-1/2 -translate-x-1/2 border-t-[var(--color-surface-alt)] border-x-transparent border-b-transparent',
      bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-[var(--color-surface-alt)] border-x-transparent border-t-transparent',
      left: 'left-full top-1/2 -translate-y-1/2 border-l-[var(--color-surface-alt)] border-y-transparent border-r-transparent',
      right: 'right-full top-1/2 -translate-y-1/2 border-r-[var(--color-surface-alt)] border-y-transparent border-l-transparent',
    };

    return (
      <div
        ref={ref}
        className={cn('relative inline-block', className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props}
      >
        {children}
        {isVisible && (
          <div
            className={cn(
              'absolute z-tooltip px-3 py-2 text-xs font-medium rounded-lg shadow-lg',
              'bg-surface-alt text-[var(--color-text)]',
              'border border-[var(--color-border)]',
              'whitespace-nowrap',
              'animate-fade-in',
              positionClasses[position]
            )}
            role="tooltip"
          >
            {content}
            {/* Arrow */}
            <div
              className={cn(
                'absolute w-0 h-0 border-4',
                arrowClasses[position]
              )}
            />
          </div>
        )}
      </div>
    );
  }
);

Tooltip.displayName = 'Tooltip';
