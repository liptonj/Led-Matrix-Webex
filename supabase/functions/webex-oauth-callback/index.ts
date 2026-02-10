/**
 * Webex OAuth Callback
 *
 * Exchanges the auth code for tokens and stores them in vault + display.oauth_tokens.
 * Uses nonce-based state lookup instead of JWT extraction.
 */

import { createClient } from "@supabase/supabase-js";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchDecryptedSecret, updateSecret } from "../_shared/vault.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { code, state } = await req.json();
    if (!code || !state) {
      return new Response(JSON.stringify({ error: "Missing code or state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Look up nonce from oauth_nonces table
    const { data: nonceRow, error: nonceError } = await supabase
      .schema("display")
      .from("oauth_nonces")
      .select("serial_number, device_id, device_uuid, user_uuid, token_type")
      .eq("nonce", state)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (nonceError || !nonceRow) {
      return new Response(JSON.stringify({ error: "Invalid or expired nonce" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract device identity from nonce row
    const serialNumber = nonceRow.serial_number;
    const deviceId = nonceRow.device_id;
    const deviceUuid = nonceRow.device_uuid;
    const userUuid = nonceRow.user_uuid;

    const { data: clientRow, error: clientError } = await supabase
      .schema("display")
      .from("oauth_clients")
      .select("client_id, client_secret_id, redirect_uri, active")
      .eq("provider", "webex")
      .eq("purpose", "device")
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (clientError || !clientRow) {
      return new Response(JSON.stringify({ error: "Webex client not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientSecret = await fetchDecryptedSecret(supabase, clientRow.client_secret_id as string);

    const tokenResponse = await fetch("https://webexapis.com/v1/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientRow.client_id as string,
        client_secret: clientSecret,
        code: String(code),
        redirect_uri: clientRow.redirect_uri as string,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return new Response(JSON.stringify({ error: tokenData?.error_description || "Token exchange failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = tokenData.access_token as string;
    const refreshToken = tokenData.refresh_token as string | undefined;
    const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Look up existing tokens using priority: user_uuid > device_uuid > serial_number
    let existingQuery = supabase
      .schema("display")
      .from("oauth_tokens")
      .select("id, access_token_id, refresh_token_id")
      .eq("provider", "webex");

    if (userUuid) {
      existingQuery = existingQuery.eq("user_id", userUuid).eq("token_scope", "user");
    } else if (deviceUuid) {
      existingQuery = existingQuery.eq("device_uuid", deviceUuid);
    } else {
      existingQuery = existingQuery.eq("serial_number", serialNumber);
    }

    const { data: existing } = await existingQuery.maybeSingle();

    // Use user_uuid or device_uuid for vault secret naming (not pairing_code)
    const secretKey = userUuid || deviceUuid || serialNumber || "token";

    const accessTokenId = await updateSecret(
      supabase,
      existing?.access_token_id ?? null,
      accessToken,
      `webex_access_${secretKey}`,
    );

    const refreshTokenId = refreshToken
      ? await updateSecret(
          supabase,
          existing?.refresh_token_id ?? null,
          refreshToken,
          `webex_refresh_${secretKey}`,
        )
      : existing?.refresh_token_id ?? null;

    if (existing?.id) {
      const updatePayload: Record<string, unknown> = {
        access_token_id: accessTokenId,
        refresh_token_id: refreshTokenId,
        expires_at: expiresAt,
        serial_number: serialNumber,
        updated_at: new Date().toISOString(),
      };
      
      // Include device_uuid and user_uuid from nonce
      if (userUuid) {
        updatePayload.user_id = userUuid;
      }
      if (deviceUuid) {
        updatePayload.device_uuid = deviceUuid;
      }
      
      await supabase
        .schema("display")
        .from("oauth_tokens")
        .update(updatePayload)
        .eq("id", existing.id);
    } else {
      const insertPayload: Record<string, unknown> = {
        provider: "webex",
        serial_number: serialNumber,
        access_token_id: accessTokenId,
        refresh_token_id: refreshTokenId,
        expires_at: expiresAt,
        token_scope: "user", // Webex tokens belong to users
      };
      
      // Include device_uuid and user_uuid from nonce
      if (userUuid) {
        insertPayload.user_id = userUuid;
      }
      if (deviceUuid) {
        insertPayload.device_uuid = deviceUuid;
      }
      
      await supabase
        .schema("display")
        .from("oauth_tokens")
        .insert(insertPayload);
    }

    // Delete the nonce after successful use (single-use)
    await supabase.schema("display").from("oauth_nonces").delete().eq("nonce", state);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("webex-oauth-callback error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
