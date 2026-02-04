/**
 * Webex User Callback Edge Function
 *
 * Completes OAuth flow, exchanges tokens, creates/updates users.
 * Handles PKCE code verifier validation and user profile creation.
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

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getOAuthConfig } from "../_shared/oauth-config.ts";

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

    if (!code || !state) {
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

    // Validate state and get PKCE verifier
    const { data: stateData, error: stateError } = await supabase
      .schema("display")
      .from("oauth_state")
      .select("code_verifier, expires_at")
      .eq("state_key", state)
      .single();

    if (stateError || !stateData) {
      return new Response(
        JSON.stringify({ error: "Invalid state" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (new Date(stateData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "State expired" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Clean up state
    await supabase
      .schema("display")
      .from("oauth_state")
      .delete()
      .eq("state_key", state);

    // Decode state to get redirect URI and redirect_to
    let stateObj;
    let redirectTo = '/user'; // Default fallback
    try {
      stateObj = JSON.parse(fromBase64Url(state));
      // Extract redirect_to from state, default to '/user' if missing or invalid
      if (stateObj && typeof stateObj.redirect_to === 'string') {
        redirectTo = stateObj.redirect_to;
      }
    } catch {
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

    // Exchange code for tokens
    const tokenResponse = await fetch(WEBEX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${btoa(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: stateObj.redirect,
        code_verifier: stateData.code_verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error("Token exchange failed:", err);
      return new Response(
        JSON.stringify({ error: "Token exchange failed" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

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

    // Determine redirect based on admin status
    // If they're an admin, redirect to admin portal, otherwise user portal
    const finalRedirect = adminCheck ? '/admin' : '/user';

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
