/**
 * Webex Token Edge Function
 *
 * Returns a valid Webex access token for the device (refreshing if needed).
 * Tokens are stored in display.oauth_tokens with secrets in vault.
 *
 * Authentication: Bearer token (app/device JWT).
 * Response: { access_token, expires_at }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";

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

async function fetchDecryptedSecret(
  client: ReturnType<typeof createClient>,
  secretId: string,
): Promise<string> {
  const { data, error } = await client.schema("display").rpc("vault_read_secret", {
    p_secret_id: secretId,
  });

  if (error || !data) {
    throw new Error("Failed to read secret from vault");
  }
  return data as string;
}

async function updateSecret(
  client: ReturnType<typeof createClient>,
  secretId: string | null,
  secretValue: string,
  nameHint: string,
): Promise<string> {
  if (secretId) {
    const { error } = await client.schema("display").rpc("vault_update_secret", {
      p_secret_id: secretId,
      p_secret: secretValue,
      p_name: null,
      p_description: null,
      p_key_id: null,
    });

    if (error) {
      throw new Error("Failed to update vault secret");
    }

    return secretId;
  }

  const { data, error } = await client.schema("display").rpc("vault_create_secret", {
    p_secret: secretValue,
    p_name: nameHint,
  });

  if (error || !data) {
    throw new Error("Failed to create vault secret");
  }

  return data as string;
}

async function refreshWebexToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", args.refreshToken);
  body.set("client_id", args.clientId);
  body.set("client_secret", args.clientSecret);

  const response = await fetch("https://webexapis.com/v1/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error_description || data?.error || "Failed to refresh token";
    throw new Error(message);
  }

  return data as { access_token: string; refresh_token?: string; expires_in?: number };
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

    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let tokenPayload: TokenPayload;
    try {
      tokenPayload = await verifyDeviceToken(bearerToken, tokenSecret);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const pairingCode = tokenPayload.pairing_code ?? null;
    const serialNumber = tokenPayload.serial_number ?? null;

    if (!serialNumber && !pairingCode) {
      return new Response(JSON.stringify({ error: "Missing device selector" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let tokenQuery = supabase
      .schema("display")
      .from("oauth_tokens")
      .select("id, serial_number, pairing_code, access_token_id, refresh_token_id, expires_at")
      .eq("provider", "webex");

    if (serialNumber) {
      tokenQuery = tokenQuery.eq("serial_number", serialNumber);
    } else if (pairingCode) {
      tokenQuery = tokenQuery.eq("pairing_code", pairingCode);
    }

    const { data: tokenRow, error: tokenErr } = await tokenQuery.maybeSingle();
    if (tokenErr || !tokenRow) {
      return new Response(JSON.stringify({ error: "Webex token not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

      const secretKey = serialNumber || pairingCode || "token";
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
