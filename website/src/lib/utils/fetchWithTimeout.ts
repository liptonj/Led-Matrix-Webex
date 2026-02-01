/**
 * Error thrown when a fetch request times out
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Fetches a URL with a timeout
 * Throws TimeoutError if the request takes longer than the specified timeout
 */
export async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError(
        `Request to ${url} timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  }
}

/**
 * Fetches JSON data with a timeout
 * Throws TimeoutError if the request takes longer than the specified timeout
 * Throws Error if the response is not OK or if JSON parsing fails
 */
export async function fetchJsonWithTimeout<T>(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 30000,
): Promise<T> {
  const response = await fetchWithTimeout(url, options, timeoutMs);

  if (!response.ok) {
    throw new Error(
      `HTTP error! status: ${response.status} ${response.statusText}`,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new Error(`Failed to parse JSON response: ${err}`);
  }
}

/**
 * Generic timeout wrapper for any promise
 * Throws TimeoutError if the promise takes longer than the specified timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new TimeoutError(
          errorMessage ?? `Operation timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    throw err;
  }
}
