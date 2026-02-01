import { forwardRef, HTMLAttributes, ReactNode } from 'react';
import { Alert } from './Alert';
import { Spinner } from './Spinner';

interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  loading: boolean;
  error?: string | Error | null;
  loadingText?: string;
  errorTitle?: string;
  emptyState?: ReactNode;
  isEmpty?: boolean;
}

/**
 * LoadingState component that combines loading spinner and error display patterns.
 * Shows loading spinner, error alert, or content based on state.
 * 
 * @example
 * <LoadingState loading={loading} error={error}>
 *   <DeviceList devices={devices} />
 * </LoadingState>
 * 
 * @example
 * <LoadingState 
 *   loading={loading} 
 *   error={error}
 *   isEmpty={devices.length === 0}
 *   emptyState={<p>No devices found</p>}
 * >
 *   <DeviceList devices={devices} />
 * </LoadingState>
 */
export const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ 
    className = '',
    loading, 
    error, 
    loadingText = 'Loading...',
    errorTitle = 'Error',
    emptyState,
    isEmpty = false,
    children,
    ...props 
  }, ref) => {
    // Show loading spinner
    if (loading) {
      return (
        <div 
          ref={ref}
          className={`flex flex-col items-center justify-center py-12 ${className}`}
          {...props}
        >
          <Spinner size="lg" />
          {loadingText && (
            <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
              {loadingText}
            </p>
          )}
        </div>
      );
    }

    // Show error state
    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return (
        <div ref={ref} className={className} {...props}>
          <Alert variant="danger">
            <h4 className="font-semibold mb-1">{errorTitle}</h4>
            <p className="text-sm">{errorMessage}</p>
          </Alert>
        </div>
      );
    }

    // Show empty state
    if (isEmpty && emptyState) {
      return (
        <div 
          ref={ref}
          className={`flex items-center justify-center py-12 text-[var(--color-text-secondary)] ${className}`}
          {...props}
        >
          {emptyState}
        </div>
      );
    }

    // Show content
    return (
      <div ref={ref} className={className} {...props}>
        {children}
      </div>
    );
  }
);

LoadingState.displayName = 'LoadingState';

/**
 * Centered loading state for full-page loading
 */
interface CenteredLoadingProps {
  text?: string;
}

export function CenteredLoading({ text = 'Loading...' }: CenteredLoadingProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <Spinner size="lg" />
      <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
        {text}
      </p>
    </div>
  );
}
