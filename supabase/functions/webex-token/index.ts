/**
 * Webex Token Edge Function
 *
 * Returns a valid Webex access token for the device (refreshing if needed).
 * Tokens are stored in display.oauth_tokens with secrets in vault.
 *
 * Authentication: Bearer token (app/device JWT).
 * Response: { access_token, expires_at }
 */

import { createClient } from "@supabase/supabase-js";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";
import { fetchDecryptedSecret, updateSecret } from "../_shared/vault.ts";
import { refreshWebexToken } from "../_shared/webex.ts";

interface TokenPayload {
  sub: string;
  pairing_code?: string;
  serial_number?: string;
  device_id?: string;
  token_type?: string;
  exp?: number;
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

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
    const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("DEVICE_JWT_SECRET");
    if (!tokenSecret) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try Supabase user auth first
    const { data: { user }, error: userError } = await supabase.auth.getUser(bearerToken);

    let tokenRow;
    let serialNumber = null;
    let pairingCode = null;

    if (user && !userError) {
      // User token path - lookup by user_id
      const { data, error } = await supabase
        .schema("display")
        .from("oauth_tokens")
        .select("id, access_token_id, refresh_token_id, expires_at")
        .eq("provider", "webex")
        .eq("user_id", user.id)
        .eq("token_scope", "user")
        .maybeSingle();
        
      if (error || !data) {
        console.warn("[webex-token] No token found for user:", user.id, error ? `(error: ${error.message})` : "");
        return new Response(JSON.stringify({ error: "Webex token not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      tokenRow = data;
    } else {
      // Device token path - existing logic with verifyDeviceToken()
      let tokenPayload: TokenPayload;
      try {
        tokenPayload = await verifyDeviceToken(bearerToken, tokenSecret);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const deviceUuid = tokenPayload.device_uuid ?? null;
      serialNumber = tokenPayload.serial_number ?? null;

      if (!deviceUuid && !serialNumber) {
        return new Response(JSON.stringify({ error: "Missing device selector" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Resolve user_uuid from pairings table
      let userUuid: string | null = null;
      if (deviceUuid) {
        const { data: pairing } = await supabase
          .schema("display")
          .from("pairings")
          .select("user_uuid")
          .eq("device_uuid", deviceUuid)
          .maybeSingle();
        userUuid = pairing?.user_uuid ?? null;
      } else if (serialNumber) {
        const { data: pairing } = await supabase
          .schema("display")
          .from("pairings")
          .select("user_uuid")
          .eq("serial_number", serialNumber)
          .maybeSingle();
        userUuid = pairing?.user_uuid ?? null;
      }

      if (!userUuid) {
        return new Response(JSON.stringify({ error: "Device not paired to a user" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Look up token by user_id (same pattern as user path)
      const { data, error: tokenErr } = await supabase
        .schema("display")
        .from("oauth_tokens")
        .select("id, serial_number, pairing_code, access_token_id, refresh_token_id, expires_at")
        .eq("provider", "webex")
        .eq("user_id", userUuid)
        .eq("token_scope", "user")
        .maybeSingle();

      if (tokenErr || !data) {
        return new Response(JSON.stringify({ error: "Webex token not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      tokenRow = data;
    }

    let accessToken = await fetchDecryptedSecret(supabase, tokenRow.access_token_id as string);
    let expiresAt = tokenRow.expires_at as string | null;

    const needsRefresh = (() => {
      if (!expiresAt) return true;
      const expMs = new Date(expiresAt).getTime();
      return expMs - Date.now() < 5 * 60 * 1000;
    })();

    if (needsRefresh && tokenRow.refresh_token_id) {
      const { data: clientRow, error: clientError } = await supabase
        .schema("display")
        .from("oauth_clients")
        .select("client_id, client_secret_id, redirect_uri, active")
        .eq("provider", "webex")
        .eq("active", true)
        .maybeSingle();

      if (clientError || !clientRow) {
        return new Response(JSON.stringify({ error: "Webex client not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const clientSecret = await fetchDecryptedSecret(supabase, clientRow.client_secret_id as string);
      const refreshToken = await fetchDecryptedSecret(supabase, tokenRow.refresh_token_id as string);

      const refreshed = await refreshWebexToken({
        clientId: clientRow.client_id as string,
        clientSecret,
        refreshToken,
      });

      accessToken = refreshed.access_token;
      const newRefresh = refreshed.refresh_token ?? refreshToken;
      const expiresIn = typeof refreshed.expires_in === "number" ? refreshed.expires_in : 3600;
      expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      const secretKey = user ? `user_${user.id}` : (serialNumber || pairingCode || "token");
      const accessTokenId = await updateSecret(
        supabase,
        tokenRow.access_token_id as string,
        accessToken,
        `webex_access_${secretKey}`,
      );
      const refreshTokenId = await updateSecret(
        supabase,
        tokenRow.refresh_token_id as string,
        newRefresh,
        `webex_refresh_${secretKey}`,
      );

      await supabase
        .schema("display")
        .from("oauth_tokens")
        .update({
          access_token_id: accessTokenId,
          refresh_token_id: refreshTokenId,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tokenRow.id);
    }

    return new Response(JSON.stringify({ access_token: accessToken, expires_at: expiresAt }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("webex-token error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
