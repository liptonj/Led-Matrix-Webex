/**
 * Webex User Login Edge Function
 *
 * Initiates OAuth flow for user login (no PKCE - uses client_secret).
 * Generates authorization URL with state parameter.
 *
 * Request body (optional):
 * {
 *   "redirect_to": "/user"  // Where to redirect after login
 * }
 *
 * Response:
 * {
 *   "auth_url": "https://webexapis.com/v1/authorize?..."
 * }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getOAuthConfig } from "../_shared/oauth-config.ts";

const WEBEX_AUTH_URL = "https://webexapis.com/v1/authorize";

interface LoginRequest {
  redirect_to?: string;
}

function toBase64Url(input: string): string {
  // Base64 encode and convert to URL-safe format
  const base64 = btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return base64;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    // Fetch OAuth config from database (user authentication purpose)
    let oauthConfig;
    try {
      oauthConfig = await getOAuthConfig("webex", "user");
    } catch (error) {
      console.error("Failed to load OAuth config:", error);
      return new Response(
        JSON.stringify({ error: "Webex OAuth not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body: LoginRequest = await req.json().catch(() => ({}));
    const redirectTo = body.redirect_to || '/user';

    // Generate state with CSRF protection (no PKCE needed - using client_secret)
    const state = toBase64Url(
      JSON.stringify({
        nonce: crypto.randomUUID(),
        ts: Math.floor(Date.now() / 1000),
        redirect_to: redirectTo,
        flow: "unified_login",
      }),
    );

    // Build authorization URL (no PKCE - client_secret used in callback)
    const authUrl = new URL(WEBEX_AUTH_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", oauthConfig.clientId);
    authUrl.searchParams.set("redirect_uri", oauthConfig.redirectUri);
    authUrl.searchParams.set(
      "scope",
      "openid email profile spark:people_read",
    );
    authUrl.searchParams.set("state", state);

    return new Response(
      JSON.stringify({ auth_url: authUrl.toString() }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("webex-user-login error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
