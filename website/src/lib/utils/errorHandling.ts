/**
 * Extracts a user-friendly error message from an unknown error value
 * Handles Error objects, strings, and objects with message properties
 */
export function getErrorMessage(err: unknown, fallback?: string): string {
  // Handle Error objects
  if (err instanceof Error) {
    return err.message;
  }

  // Handle string errors
  if (typeof err === "string") {
    return err;
  }

  // Handle objects with message property
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof err.message === "string"
  ) {
    return err.message;
  }

  // Return fallback or generic error message
  return fallback ?? "An unknown error occurred";
}

/**
 * Creates a standardized error message with a context prefix
 */
export function formatErrorMessage(
  err: unknown,
  context: string,
  fallback?: string,
): string {
  const message = getErrorMessage(err, fallback);
  return `${context}: ${message}`;
}

/**
 * Type guard to check if an error is an Error object
 */
export function isError(err: unknown): err is Error {
  return err instanceof Error;
}

/**
 * Type guard to check if an error has a specific error code
 */
export function hasErrorCode(
  err: unknown,
  code: string,
): err is Error & { code: string } {
  return (
    isError(err) &&
    "code" in err &&
    typeof err.code === "string" &&
    err.code === code
  );
}

/**
 * Wraps an async function with error handling
 * Returns [data, null] on success or [null, error] on failure
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
): Promise<[T, null] | [null, Error]> {
  try {
    const result = await fn();
    return [result, null];
  } catch (err) {
    if (err instanceof Error) {
      return [null, err];
    }
    return [null, new Error(getErrorMessage(err))];
  }
}

/**
 * Wraps a sync function with error handling
 * Returns [data, null] on success or [null, error] on failure
 */
export function tryCatchSync<T>(
  fn: () => T,
): [T, null] | [null, Error] {
  try {
    const result = fn();
    return [result, null];
  } catch (err) {
    if (err instanceof Error) {
      return [null, err];
    }
    return [null, new Error(getErrorMessage(err))];
  }
}
