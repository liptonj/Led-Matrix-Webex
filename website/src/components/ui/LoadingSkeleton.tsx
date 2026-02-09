import { cn } from '@/lib/utils';
import { HTMLAttributes, forwardRef } from 'react';

interface LoadingSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'rectangular' | 'circular';
  width?: string | number;
  height?: string | number;
  lines?: number;
}

/**
 * LoadingSkeleton component for showing loading states that match final content.
 * 
 * @example
 * <LoadingSkeleton variant="text" lines={3} />
 * <LoadingSkeleton variant="circular" width={48} height={48} />
 * <LoadingSkeleton variant="rectangular" width="100%" height={200} />
 */
export const LoadingSkeleton = forwardRef<HTMLDivElement, LoadingSkeletonProps>(
  ({ className, variant = 'text', width, height, lines = 1, ...props }, ref) => {
    const baseClasses = cn(
      'animate-pulse bg-surface-alt',
      'relative overflow-hidden',
      'before:absolute before:inset-0',
      'before:bg-gradient-to-r before:from-transparent before:via-[var(--color-bg-hover)] before:to-transparent',
      'before:animate-shimmer',
    );

    if (variant === 'text' && lines > 1) {
      return (
        <div ref={ref} className={cn('space-y-2', className)} {...props}>
          {Array.from({ length: lines }).map((_, i) => (
            <div
              key={i}
              className={cn(baseClasses, 'h-4 rounded')}
              style={{
                width: i === lines - 1 ? '80%' : '100%',
              }}
            />
          ))}
        </div>
      );
    }

    const shapeClasses = cn(
      variant === 'text' && 'h-4 rounded',
      variant === 'rectangular' && 'rounded-lg',
      variant === 'circular' && 'rounded-full'
    );

    const style: React.CSSProperties = {};
    if (width) style.width = typeof width === 'number' ? `${width}px` : width;
    if (height) style.height = typeof height === 'number' ? `${height}px` : height;

    return (
      <div
        ref={ref}
        className={cn(baseClasses, shapeClasses, className)}
        style={style}
        {...props}
      />
    );
  }
);

LoadingSkeleton.displayName = 'LoadingSkeleton';

/**
 * DeviceCardSkeleton - Skeleton for device info cards
 */
export function DeviceCardSkeleton() {
  return (
    <div className="panel space-y-3">
      <LoadingSkeleton variant="text" width="60%" />
      <LoadingSkeleton variant="text" lines={4} />
    </div>
  );
}

/**
 * DeviceListSkeleton - Skeleton for device list items
 */
export function DeviceListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
          <div className="flex items-center justify-between">
            <LoadingSkeleton variant="text" width="40%" />
            <LoadingSkeleton variant="rectangular" width={80} height={24} />
          </div>
          <LoadingSkeleton variant="text" lines={2} />
        </div>
      ))}
    </div>
  );
}
