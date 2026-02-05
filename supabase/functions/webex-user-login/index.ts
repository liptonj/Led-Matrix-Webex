/**
 * Webex User Login Edge Function
 *
 * Initiates OAuth flow for user login with PKCE.
 * Generates authorization URL and stores PKCE code verifier.
 *
 * Request body (optional):
 * {
 *   "redirect_uri": "https://display.5ls.us/auth/callback"  // Optional, uses default if not provided
 * }
 *
 * Response:
 * {
 *   "auth_url": "https://webexapis.com/v1/authorize?..."
 * }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { getOAuthConfig } from "../_shared/oauth-config.ts";

const WEBEX_AUTH_URL = "https://webexapis.com/v1/authorize";

interface LoginRequest {
  redirect_uri?: string;
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
    const redirectUri = body.redirect_uri || oauthConfig.redirectUri;
    const redirectTo = body.redirect_to || '/user';

    // Generate state with CSRF protection
    const state = toBase64Url(
      JSON.stringify({
        nonce: crypto.randomUUID(),
        ts: Math.floor(Date.now() / 1000),
        redirect: redirectUri,
        redirect_to: redirectTo,
        flow: "unified_login", // Distinguish from device pairing
      }),
    );

    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const codeChallenge = toBase64Url(
      String.fromCharCode(...new Uint8Array(digest)),
    );

    // Store code verifier for callback (in oauth_state table)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Store PKCE verifier temporarily (5 min expiry)
    const { error: stateError } = await supabase
      .schema("display")
      .from("oauth_state")
      .upsert({
        state_key: state,
        code_verifier: codeVerifier,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

    if (stateError) {
      console.error("Failed to store OAuth state:", stateError);
      return new Response(
        JSON.stringify({ error: "Failed to initialize OAuth flow" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Build authorization URL
    const authUrl = new URL(WEBEX_AUTH_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", oauthConfig.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set(
      "scope",
      "openid email profile spark:people_read",
    );
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

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
