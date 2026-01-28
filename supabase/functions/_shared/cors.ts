/**
 * CORS headers for Edge Functions
 *
 * SECURITY NOTE: The wildcard origin (*) is intentionally used here because:
 *
 * 1. **Embedded App in Webex**: The embedded app runs inside the Webex client
 *    which may load content from multiple Webex domains (webex.com, teams.webex.com,
 *    *.wbx2.com, etc.). We cannot predict all possible origins.
 *
 * 2. **Firmware Devices**: ESP32 devices make direct HTTP requests which are not
 *    subject to browser CORS restrictions.
 *
 * 3. **Website**: Our website at display.5ls.us needs access to these endpoints.
 *
 * The wildcard is acceptable here because:
 * - Authentication is enforced via API keys, HMAC signatures, and tokens
 * - Sensitive operations require device authentication (x-device-serial, x-signature)
 * - No cookies/credentials are used (credentials mode is not 'include')
 *
 * For production deployments requiring stricter CORS:
 * - Set the ALLOWED_ORIGINS environment variable to a comma-separated list of origins
 * - Example: ALLOWED_ORIGINS=https://display.5ls.us,https://webex.com
 */

// Get allowed origins from environment, defaulting to wildcard
const allowedOriginsEnv = Deno.env.get("ALLOWED_ORIGINS");
const allowedOrigins = allowedOriginsEnv
  ? allowedOriginsEnv.split(",").map((o) => o.trim())
  : null;

/**
 * Get CORS headers for a specific request origin.
 * If ALLOWED_ORIGINS is configured, validates the origin against the allowlist.
 * Otherwise, returns wildcard (*) for maximum compatibility.
 */
export function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  let origin = "*";

  if (allowedOrigins && requestOrigin) {
    // Check if the request origin is in our allowlist
    if (allowedOrigins.includes(requestOrigin)) {
      origin = requestOrigin;
    } else {
      // Check for wildcard subdomain matching (e.g., *.wbx2.com)
      const isAllowed = allowedOrigins.some((allowed) => {
        if (allowed.startsWith("*.")) {
          const domain = allowed.slice(2);
          try {
            const originUrl = new URL(requestOrigin);
            return originUrl.hostname.endsWith(domain);
          } catch {
            return false;
          }
        }
        return false;
      });
      if (isAllowed) {
        origin = requestOrigin;
      }
    }
  } else if (allowedOrigins) {
    // ALLOWED_ORIGINS is set but no request origin provided - use first allowed origin
    origin = allowedOrigins[0];
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-device-serial, x-timestamp, x-signature",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    // Only add Vary header when using dynamic origin
    ...(allowedOrigins ? { "Vary": "Origin" } : {}),
  };
}

/**
 * Default CORS headers (legacy, uses wildcard)
 * @deprecated Use getCorsHeaders(request.headers.get("origin")) for better security
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-serial, x-timestamp, x-signature",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};
