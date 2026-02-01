import { getSession } from "../auth";
import { supabaseUrl } from "../core";

/**
 * Edge function call options.
 */
export interface EdgeFunctionOptions {
  /** Custom headers to include in the request */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Whether to include debug headers in non-production environments */
  debug?: boolean;
}

/**
 * Call a Supabase Edge Function with automatic authentication.
 * 
 * This helper wraps the common pattern of calling Edge Functions with JWT authentication.
 * It automatically retrieves the access token from the current session and includes it
 * in the Authorization header.
 * 
 * @template TRequest - The type of the request body
 * @template TResponse - The expected type of the response body
 * @param functionName - Name of the Edge Function to call (without /functions/v1/ prefix)
 * @param body - Request body to send (will be JSON-encoded)
 * @param options - Additional configuration options
 * @returns Promise resolving to the response body
 * @throws Error if not authenticated, Supabase URL is not configured, or request fails
 * 
 * @example
 * // Create a user with Edge Function
 * const result = await callEdgeFunction<
 *   { email: string; password: string; role: string },
 *   { user_id: string; existing: boolean }
 * >(
 *   "admin-create-user",
 *   { email: "user@example.com", password: "secret", role: "user" }
 * );
 * 
 * @example
 * // Update user with custom timeout
 * await callEdgeFunction(
 *   "admin-update-user",
 *   { user_id: userId, email: newEmail },
 *   { timeoutMs: 15000 }
 * );
 * 
 * @example
 * // Call with debug headers in development
 * const client = await callEdgeFunction(
 *   "admin-upsert-oauth-client",
 *   { provider: "webex", client_id: "abc123" },
 *   { debug: true }
 * );
 */
export async function callEdgeFunction<TRequest = unknown, TResponse = unknown>(
  functionName: string,
  body: TRequest,
  options: EdgeFunctionOptions = {}
): Promise<TResponse> {
  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured.");
  }

  // Get authentication token from current session
  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  // Add debug header in non-production environments if requested
  if (options.debug && process.env.NODE_ENV !== "production") {
    headers["x-debug-auth"] = "1";
  }

  // Build request URL
  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  // Execute request with optional timeout
  const fetchPromise = fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const response = options.timeoutMs
    ? await Promise.race([
        fetchPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Edge function ${functionName} timed out`)),
            options.timeoutMs
          )
        ),
      ])
    : await fetchPromise;

  // Parse response body
  const responseBody = await response.json().catch(() => ({}));

  // Check for errors
  if (!response.ok) {
    throw new Error(
      (responseBody as { error?: string })?.error || 
      `Failed to call edge function: ${functionName}`
    );
  }

  return responseBody as TResponse;
}
