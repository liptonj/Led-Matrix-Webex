/**
 * Webex OAuth Callback
 *
 * Exchanges the auth code for tokens and stores them in vault + display.oauth_tokens.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { decodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";

interface StatePayload {
  pairing_code: string;
  serial: string;
  ts: string;
  sig: string;
  token: string;
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bytes = decodeBase64(padded);
  return new TextDecoder().decode(bytes);
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
    const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("DEVICE_JWT_SECRET");

    if (!tokenSecret) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { code, state } = await req.json();
    if (!code || !state) {
      return new Response(JSON.stringify({ error: "Missing code or state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedState: StatePayload;
    try {
      parsedState = JSON.parse(fromBase64Url(state));
    } catch {
      return new Response(JSON.stringify({ error: "Invalid state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = `Bearer ${parsedState.token}`;
    const payload = await verifyDeviceToken(parsedState.token, tokenSecret);
    if (payload.token_type !== "device" && payload.token_type !== "app") {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let pairingCode = parsedState.pairing_code || payload.pairing_code;
    let serialNumber = parsedState.serial || payload.serial_number;
    let deviceId = parsedState.device_id || payload.device_id;

    if (payload.token_type === "device") {
      const hmacRequest = new Request("https://local", {
        headers: {
          "X-Device-Serial": parsedState.serial,
          "X-Timestamp": parsedState.ts,
          "X-Signature": parsedState.sig,
          Authorization: authHeader,
        },
      });

      const hmacResult = await validateHmacRequest(hmacRequest, supabase, "");
      if (!hmacResult.valid || !hmacResult.device) {
        return new Response(JSON.stringify({ error: hmacResult.error || "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (hmacResult.device.serial_number !== payload.serial_number) {
        return new Response(JSON.stringify({ error: "Token does not match device" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      pairingCode = hmacResult.device.pairing_code;
      serialNumber = hmacResult.device.serial_number;
      deviceId = hmacResult.device.device_id;
    } else {
      if (!pairingCode || !serialNumber || !deviceId) {
        return new Response(JSON.stringify({ error: "Token missing device identity" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (parsedState.pairing_code && parsedState.pairing_code !== payload.pairing_code) {
        return new Response(JSON.stringify({ error: "Token does not match pairing" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (parsedState.serial && parsedState.serial !== payload.serial_number) {
        return new Response(JSON.stringify({ error: "Token does not match serial" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    let existingQuery = supabase
      .schema("display")
      .from("oauth_tokens")
      .select("id, access_token_id, refresh_token_id")
      .eq("provider", "webex");

    if (serialNumber) {
      existingQuery = existingQuery.eq("serial_number", serialNumber);
    } else if (pairingCode) {
      existingQuery = existingQuery.eq("pairing_code", pairingCode);
    }

    const { data: existing } = await existingQuery.maybeSingle();

    const secretKey = serialNumber || pairingCode || "token";

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
      await supabase
        .schema("display")
        .from("oauth_tokens")
        .update({
          access_token_id: accessTokenId,
          refresh_token_id: refreshTokenId,
          expires_at: expiresAt,
          pairing_code: pairingCode,
          serial_number: serialNumber,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase
        .schema("display")
        .from("oauth_tokens")
        .insert({
          provider: "webex",
          serial_number: serialNumber,
          pairing_code: pairingCode,
          access_token_id: accessTokenId,
          refresh_token_id: refreshTokenId,
          expires_at: expiresAt,
        });
    }

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
