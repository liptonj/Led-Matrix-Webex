/**
 * Webex Status Sync Edge Function
 *
 * Fetches Webex status for a device using stored OAuth tokens and updates
 * display.pairings. Accepts a device JWT (preferred) and optional selectors.
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

interface SyncRequest {
  pairing_code?: string;
  serial_number?: string;
  device_id?: string;
  camera_on?: boolean;
  mic_muted?: boolean;
  in_call?: boolean;
  display_name?: string;
  webex_status?: string;
}

const CANONICAL_STATUSES = [
  "active",
  "away",
  "dnd",
  "busy",
  "meeting",
  "call",
  "presenting",
  "ooo",
  "pending",
  "unknown",
  "offline",
];

const STATUS_ALIASES: Record<string, string> = {
  available: "active",
  inactive: "away",
  brb: "away",
  donotdisturb: "dnd",
  outofoffice: "ooo",
};

function normalizeWebexStatus(value: string | null | undefined): string {
  if (!value) return "unknown";
  const key = value.trim().toLowerCase();
  const normalized = STATUS_ALIASES[key] ?? key;
  return CANONICAL_STATUSES.includes(normalized) ? normalized : "unknown";
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const tokenHeader = req.headers.get("X-Device-Token") || req.headers.get("X-Auth-Token");
  return tokenHeader || null;
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

async function fetchWebexStatus(accessToken: string): Promise<string> {
  const response = await fetch("https://webexapis.com/v1/people/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.message || data?.error || "Webex API error";
    throw new Error(message);
  }

  const status = data?.status || data?.presence || data?.availability || data?.state || data?.activity;
  return normalizeWebexStatus(status);
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

    let body: SyncRequest = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const pairingCode = body.pairing_code || tokenPayload.pairing_code || null;
    const serialNumber = body.serial_number || tokenPayload.serial_number || null;
    const deviceId = body.device_id || tokenPayload.device_id || null;

    if (!serialNumber && !pairingCode) {
      return new Response(JSON.stringify({ error: "Missing device selector" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const hasLocalStatus = typeof body.webex_status === "string" && body.webex_status.trim().length > 0;
    let webexStatus: string;

    if (hasLocalStatus) {
      webexStatus = normalizeWebexStatus(body.webex_status);
    } else {
      let tokenQuery = supabase
        .schema("display")
        .from("oauth_tokens")
        .select("id, provider, serial_number, pairing_code, access_token_id, refresh_token_id, expires_at")
        .eq("provider", "webex");

      if (serialNumber) {
        tokenQuery = tokenQuery.eq("serial_number", serialNumber);
      } else if (pairingCode) {
        tokenQuery = tokenQuery.eq("pairing_code", pairingCode);
      }

      const { data: tokenRow, error: tokenError } = await tokenQuery.maybeSingle();
      if (tokenError || !tokenRow) {
        return new Response(JSON.stringify({ error: "Webex token not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: clientRow, error: clientError } = await supabase
        .schema("display")
        .from("oauth_clients")
        .select("client_id, client_secret_id, active")
        .eq("provider", "webex")
        .eq("active", true)
        .maybeSingle();

      if (clientError || !clientRow) {
        return new Response(JSON.stringify({ error: "Webex client configuration missing" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const secretKey = serialNumber || pairingCode || "token";
      let accessToken = await fetchDecryptedSecret(supabase, tokenRow.access_token_id);
      const refreshTokenId = tokenRow.refresh_token_id as string | null;
      const refreshToken = refreshTokenId
        ? await fetchDecryptedSecret(supabase, refreshTokenId)
        : null;

      const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at as string) : null;
      const now = new Date();
      const shouldRefresh = !expiresAt || expiresAt.getTime() - now.getTime() < 60 * 1000;

      if (shouldRefresh && refreshToken) {
        const clientSecret = await fetchDecryptedSecret(supabase, clientRow.client_secret_id as string);
        const refreshed = await refreshWebexToken({
          clientId: clientRow.client_id as string,
          clientSecret,
          refreshToken,
        });

        accessToken = refreshed.access_token;
        const accessTokenId = await updateSecret(
          supabase,
          tokenRow.access_token_id as string,
          accessToken,
          `webex_access_${secretKey}`,
        );

        let refreshTokenIdUpdated = refreshTokenId;
        if (refreshed.refresh_token) {
          refreshTokenIdUpdated = await updateSecret(
            supabase,
            refreshTokenId,
            refreshed.refresh_token,
            `webex_refresh_${secretKey}`,
          );
        }

        const newExpiresAt = refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
          : null;

        await supabase
          .schema("display")
          .from("oauth_tokens")
          .update({
            access_token_id: accessTokenId,
            refresh_token_id: refreshTokenIdUpdated,
            expires_at: newExpiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", tokenRow.id);
      }

      try {
        webexStatus = await fetchWebexStatus(accessToken);
      } catch (err) {
        if (refreshToken) {
          const clientSecret = await fetchDecryptedSecret(supabase, clientRow.client_secret_id as string);
          const refreshed = await refreshWebexToken({
            clientId: clientRow.client_id as string,
            clientSecret,
            refreshToken,
          });
          accessToken = refreshed.access_token;

          await updateSecret(
            supabase,
            tokenRow.access_token_id as string,
            accessToken,
            `webex_access_${secretKey}`,
          );

          webexStatus = await fetchWebexStatus(accessToken);
        } else {
          throw err;
        }
      }
    }

    if (pairingCode) {
      const updateData: Record<string, unknown> = {
        webex_status: webexStatus,
      };

      if (!hasLocalStatus) {
        updateData.app_connected = true;
        updateData.app_last_seen = new Date().toISOString();
      }

      if (typeof body.camera_on === "boolean") {
        updateData.camera_on = body.camera_on;
      }
      if (typeof body.mic_muted === "boolean") {
        updateData.mic_muted = body.mic_muted;
      }
      if (typeof body.in_call === "boolean") {
        updateData.in_call = body.in_call;
      }
      if (typeof body.display_name === "string" && body.display_name.trim()) {
        updateData.display_name = body.display_name.trim();
      }

      await supabase
        .schema("display")
        .from("pairings")
        .update(updateData)
        .eq("pairing_code", pairingCode);
    }

    return new Response(
      JSON.stringify({
        success: true,
        webex_status: webexStatus,
        pairing_code: pairingCode,
        device_id: deviceId,
        serial_number: serialNumber,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Webex status sync error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
