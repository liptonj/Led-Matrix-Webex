import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsyncOperation } from '../useAsyncOperation';

describe('useAsyncOperation', () => {
  it('should initialize with null data, no loading, and no error', () => {
    const mockOperation = jest.fn().mockResolvedValue('test-data');
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should set loading true when executing', async () => {
    const mockOperation = jest.fn().mockImplementation(() => 
      new Promise((resolve) => setTimeout(() => resolve('test-data'), 100))
    );
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    act(() => {
      result.current.execute();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should set data on successful execution', async () => {
    const mockData = { id: 1, name: 'Test' };
    const mockOperation = jest.fn().mockResolvedValue(mockData);
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockOperation).toHaveBeenCalledTimes(1);
  });

  it('should set error on failed execution', async () => {
    const mockError = new Error('Operation failed');
    const mockOperation = jest.fn().mockRejectedValue(mockError);
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Operation failed');
  });

  it('should handle non-Error exceptions', async () => {
    const mockOperation = jest.fn().mockRejectedValue('String error');
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe('Operation failed');
  });

  it('should pass arguments to operation', async () => {
    const mockOperation = jest.fn().mockResolvedValue('result');
    const { result } = renderHook(() => 
      useAsyncOperation((a: string, b: number) => mockOperation(a, b))
    );

    await act(async () => {
      await result.current.execute('test', 123);
    });

    expect(mockOperation).toHaveBeenCalledWith('test', 123);
  });

  it('should reset state', async () => {
    const mockOperation = jest.fn().mockResolvedValue('test-data');
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('test-data');

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return result from execute', async () => {
    const mockData = { id: 1 };
    const mockOperation = jest.fn().mockResolvedValue(mockData);
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    let returnValue;
    await act(async () => {
      returnValue = await result.current.execute();
    });

    expect(returnValue).toEqual(mockData);
  });

  it('should return null on error', async () => {
    const mockOperation = jest.fn().mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    let returnValue;
    await act(async () => {
      returnValue = await result.current.execute();
    });

    expect(returnValue).toBeNull();
  });

  it('should clear previous error when executing again', async () => {
    const mockOperation = jest.fn()
      .mockRejectedValueOnce(new Error('First error'))
      .mockResolvedValueOnce('Success');
    
    const { result } = renderHook(() => useAsyncOperation(mockOperation));

    // First execution fails
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBe('First error');

    // Second execution succeeds
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe('Success');
  });
});
