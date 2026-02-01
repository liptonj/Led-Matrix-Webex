import { SUPABASE_REQUEST_TIMEOUT_MS, withTimeout } from "../core";

/**
 * Result type from Supabase queries.
 * This is a simplified type that matches what Supabase returns from .then()
 */
interface QueryResult<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

/**
 * Execute a Supabase query with timeout handling.
 * 
 * This helper wraps common query patterns to reduce duplication across the codebase.
 * It automatically handles timeout errors and provides consistent error handling.
 * 
 * @template T - The expected return type of the query
 * @param queryBuilder - Function that builds and returns the Supabase query
 * @param timeoutMessage - Error message to show if the query times out
 * @param options - Additional configuration options
 * @param options.timeoutMs - Custom timeout in milliseconds (default: SUPABASE_REQUEST_TIMEOUT_MS)
 * @param options.signal - AbortSignal for cancelling the request
 * @param options.allowEmpty - If true, returns empty array instead of throwing on PGRST116 (not found)
 * @returns Promise resolving to the query data or empty array
 * @throws Error if query fails (unless allowEmpty is true for not found errors)
 * 
 * @example
 * // Basic query with default timeout
 * const devices = await queryWithTimeout(
 *   async () => {
 *     const supabase = await getSupabase();
 *     return supabase.schema("display")
 *       .from("devices")
 *       .select("*")
 *       .order("last_seen", { ascending: false });
 *   },
 *   "Timed out while loading devices."
 * );
 * 
 * @example
 * // Query with custom timeout and abort signal
 * const profile = await queryWithTimeout(
 *   async () => {
 *     const supabase = await getSupabase();
 *     return supabase.schema("display")
 *       .from("user_profiles")
 *       .select("*")
 *       .eq("user_id", userId)
 *       .single();
 *   },
 *   "Timed out while loading profile.",
 *   { timeoutMs: 5000, signal: abortSignal, allowEmpty: true }
 * );
 */
export async function queryWithTimeout<T>(
  queryBuilder: () => PromiseLike<QueryResult<T[]>>,
  timeoutMessage: string,
  options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    allowEmpty?: boolean;
  }
): Promise<T[]>;

/**
 * Execute a Supabase single-row query with timeout handling.
 * 
 * @template T - The expected return type of the query
 * @param queryBuilder - Function that builds and returns the Supabase query ending with .single()
 * @param timeoutMessage - Error message to show if the query times out
 * @param options - Additional configuration options
 * @returns Promise resolving to the single query result or null if not found
 */
export async function queryWithTimeout<T>(
  queryBuilder: () => PromiseLike<QueryResult<T>>,
  timeoutMessage: string,
  options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    allowEmpty?: boolean;
  }
): Promise<T | null>;

export async function queryWithTimeout<T>(
  queryBuilder: () => PromiseLike<QueryResult<T | T[]>>,
  timeoutMessage: string,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    allowEmpty?: boolean;
  } = {}
): Promise<T | T[] | null> {
  const { 
    timeoutMs = SUPABASE_REQUEST_TIMEOUT_MS,
    signal,
    allowEmpty = false
  } = options;

  const result = await withTimeout(
    queryBuilder(),
    timeoutMs,
    timeoutMessage,
    signal
  );

  const { data, error } = result;

  // Handle "not found" errors gracefully if allowEmpty is true
  if (error) {
    if (allowEmpty && error.code === "PGRST116") {
      return Array.isArray(data) ? [] : null;
    }
    throw error;
  }

  return data ?? (Array.isArray(data) ? [] : null);
}
