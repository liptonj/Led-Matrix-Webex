/**
 * Webex User Callback Edge Function
 *
 * Completes OAuth flow, exchanges tokens, creates/updates users.
 * Uses client_secret for token exchange (no PKCE).
 *
 * Called by the Next.js /user/auth-callback page after Webex redirects.
 *
 * Request body (POST):
 * {
 *   "code": "authorization_code_from_webex",
 *   "state": "state_parameter_from_webex"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "user": {
 *     "id": "user_uuid",
 *     "email": "user@example.com",
 *     "name": "User Name"
 *   },
 *   "redirect_url": "/user?token=..." or "/admin?token=..."
 * }
 */

import { createClient } from "@supabase/supabase-js";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getOAuthConfig } from "../_shared/oauth-config.ts";
import { updateSecret } from "../_shared/vault.ts";

const WEBEX_TOKEN_URL = "https://webexapis.com/v1/access_token";
const WEBEX_USERINFO_URL = "https://webexapis.com/v1/userinfo";

interface CallbackRequest {
  code: string;
  state: string;
}

function fromBase64Url(input: string): string {
  // Convert URL-safe base64 back to regular base64
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
  try {
    return atob(padded);
  } catch {
    throw new Error("Invalid base64url encoding");
  }
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
    const body: CallbackRequest = await req.json();
    const code = body.code;
    const state = body.state;

    console.log("[webex-user-callback] Received request", { 
      hasCode: !!code, 
      hasState: !!state,
      codeLength: code?.length 
    });

    if (!code || !state) {
      console.error("[webex-user-callback] Missing code or state");
      return new Response(
        JSON.stringify({ error: "Missing code or state" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Decode state to get redirect_to (no PKCE - state is just for CSRF protection)
    let stateObj;
    let redirectTo = '/user'; // Default fallback
    try {
      stateObj = JSON.parse(fromBase64Url(state));
      console.log("[webex-user-callback] Decoded state", { 
        flow: stateObj?.flow,
        redirect_to: stateObj?.redirect_to,
        hasRedirect: !!stateObj?.redirect
      });
      // Extract redirect_to from state, default to '/user' if missing or invalid
      if (stateObj && typeof stateObj.redirect_to === 'string') {
        redirectTo = stateObj.redirect_to;
      }
    } catch (decodeErr) {
      console.error("[webex-user-callback] Failed to decode state:", decodeErr);
      return new Response(
        JSON.stringify({ error: "Invalid state format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fetch OAuth config from database (user authentication purpose)
    let oauthConfig;
    try {
      oauthConfig = await getOAuthConfig("webex", "user");
      console.log("[webex-user-callback] OAuth config loaded", { 
        redirectUri: oauthConfig.redirectUri,
        hasClientId: !!oauthConfig.clientId,
        hasClientSecret: !!oauthConfig.clientSecret
      });
    } catch (error) {
      console.error("[webex-user-callback] Failed to load OAuth config:", error);
      return new Response(
        JSON.stringify({ error: "Webex OAuth not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Exchange code for tokens (no PKCE - using client_secret)
    console.log("[webex-user-callback] Exchanging code for tokens", {
      tokenUrl: WEBEX_TOKEN_URL,
      redirectUri: oauthConfig.redirectUri
    });

    const tokenResponse = await fetch(WEBEX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        code: code,
        redirect_uri: oauthConfig.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error("[webex-user-callback] Token exchange failed:", {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: err,
        redirectUri: oauthConfig.redirectUri
      });
      return new Response(
        JSON.stringify({ error: "Token exchange failed", details: err }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("[webex-user-callback] Token exchange successful");

    const tokens = await tokenResponse.json();

    // Get user info from Webex
    const userInfoResponse = await fetch(WEBEX_USERINFO_URL, {
      headers: { "Authorization": `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to get user info" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const webexUser = await userInfoResponse.json();

    // Store user's Webex tokens in vault
    const accessTokenId = await updateSecret(
      supabase, null, tokens.access_token, `webex_user_access_${webexUser.sub}`
    );

    const refreshTokenId = tokens.refresh_token 
      ? await updateSecret(supabase, null, tokens.refresh_token, `webex_user_refresh_${webexUser.sub}`)
      : null;

    // Check if user exists, create or update
    const { data: existingProfile } = await supabase
      .schema("display")
      .from("user_profiles")
      .select("user_id")
      .eq("webex_user_id", webexUser.sub)
      .single();

    let userId: string;

    if (existingProfile) {
      // Update existing profile
      userId = existingProfile.user_id;
      await supabase
        .schema("display")
        .from("user_profiles")
        .update({
          email: webexUser.email,
          display_name: webexUser.name,
          webex_email: webexUser.email,
          avatar_url: webexUser.avatar || null,
          auth_provider: "webex",
        })
        .eq("user_id", userId);
    } else {
      // Check if email exists (might have been created as admin)
      const { data: emailProfile } = await supabase
        .schema("display")
        .from("user_profiles")
        .select("user_id")
        .eq("email", webexUser.email)
        .single();

      if (emailProfile) {
        // Link Webex to existing account
        userId = emailProfile.user_id;
        await supabase
          .schema("display")
          .from("user_profiles")
          .update({
            webex_user_id: webexUser.sub,
            webex_email: webexUser.email,
            display_name: webexUser.name,
            avatar_url: webexUser.avatar || null,
            auth_provider: "webex",
          })
          .eq("user_id", userId);
      } else {
        // Create new Supabase Auth user
        const { data: newUser, error: createError } = await supabase.auth.admin
          .createUser({
            email: webexUser.email,
            email_confirm: true,
            user_metadata: {
              webex_user_id: webexUser.sub,
              name: webexUser.name,
              avatar_url: webexUser.avatar,
            },
          });

        if (createError || !newUser.user) {
          console.error("Failed to create user:", createError);
          return new Response(
            JSON.stringify({ error: "Failed to create user" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        userId = newUser.user.id;

        // Create user profile
        const { error: profileError } = await supabase
          .schema("display")
          .from("user_profiles")
          .insert({
            user_id: userId,
            email: webexUser.email,
            webex_user_id: webexUser.sub,
            webex_email: webexUser.email,
            display_name: webexUser.name,
            avatar_url: webexUser.avatar || null,
            role: "user",
            auth_provider: "webex",
          });

        if (profileError) {
          console.error("Failed to create user profile:", profileError);
          // Continue anyway - user was created in auth
        }
      }
    }

    // Store OAuth tokens in oauth_tokens table
    await supabase.schema("display").from("oauth_tokens").upsert({
      provider: "webex",
      user_id: userId,
      token_scope: "user",
      serial_number: null,
      pairing_code: null,
      access_token_id: accessTokenId,
      refresh_token_id: refreshTokenId,
      expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
    }, { onConflict: "provider,user_id", ignoreDuplicates: false });

    // Generate Supabase session for the user
    const { data: sessionData, error: sessionError } = await supabase.auth.admin
      .generateLink({
        type: "magiclink",
        email: webexUser.email,
      });

    if (sessionError) {
      console.error("Failed to create session:", sessionError);
      return new Response(
        JSON.stringify({ error: "Failed to create session" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if user is an admin to determine redirect
    const { data: adminCheck } = await supabase
      .schema("display")
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .single();

    // Check if user is disabled
    const { data: profileCheck } = await supabase
      .schema("display")
      .from("user_profiles")
      .select("disabled")
      .eq("user_id", userId)
      .single();

    // If disabled, redirect to login with error
    if (profileCheck?.disabled) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Account is disabled",
          redirect_url: "/user/login?error=disabled",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Determine redirect based on redirect_to parameter and admin status
    // For embedded app flow, respect redirect_to; for portal flow, check admin status
    const finalRedirect = redirectTo.startsWith('/embedded') 
      ? redirectTo  // Embedded app flow - use requested redirect
      : (adminCheck ? '/admin' : '/user');  // Portal flow - check admin status

    // Build redirect URL with session token
    const redirectUrl = sessionData.properties?.hashed_token
      ? `${finalRedirect}?token=${sessionData.properties.hashed_token}`
      : finalRedirect;

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: userId,
          email: webexUser.email,
          name: webexUser.name,
        },
        redirect_url: redirectUrl,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("webex-user-callback error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
