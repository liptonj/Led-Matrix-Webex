import { useCallback, useState } from 'react';

export interface UseAsyncOperationState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseAsyncOperationReturn<T, TArgs extends unknown[]> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (...args: TArgs) => Promise<T | null>;
  reset: () => void;
}

/**
 * Generic hook for managing async operations with loading and error states.
 * Replaces the common pattern of managing loading/error/data states manually.
 * 
 * @param operation - The async function to execute
 * @returns Object with data, loading, error states and execute/reset functions
 * 
 * @example
 * ```typescript
 * const { execute, loading, error, data } = useAsyncOperation(
 *   async (id: string) => await fetchData(id)
 * );
 * 
 * // Later in your component
 * await execute('123');
 * ```
 */
export function useAsyncOperation<T, TArgs extends unknown[] = []>(
  operation: (...args: TArgs) => Promise<T>,
): UseAsyncOperationReturn<T, TArgs> {
  const [state, setState] = useState<UseAsyncOperationState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(
    async (...args: TArgs): Promise<T | null> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      
      try {
        const result = await operation(...args);
        setState({ data: result, loading: false, error: null });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Operation failed';
        setState((prev) => ({ ...prev, loading: false, error: errorMessage }));
        return null;
      }
    },
    [operation],
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    execute,
    reset,
  };
}
