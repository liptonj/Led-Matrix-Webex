/**
 * Webex Status Sync Edge Function
 *
 * Fetches Webex status for a device using stored OAuth tokens and updates
 * display.pairings. Accepts a device JWT (preferred) and optional selectors.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";
import { fetchDecryptedSecret, updateSecret } from "../_shared/vault.ts";
import {
  fetchWebexStatus,
  normalizeWebexStatus,
  refreshWebexToken,
  CANONICAL_STATUSES,
  STATUS_ALIASES,
} from "../_shared/webex.ts";

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

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const tokenHeader = req.headers.get("X-Device-Token") || req.headers.get("X-Auth-Token");
  return tokenHeader || null;
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

    const deviceUuid = tokenPayload.device_uuid || body.device_uuid || null;
    const pairingCode = body.pairing_code || tokenPayload.pairing_code || null;
    const serialNumber = body.serial_number || tokenPayload.serial_number || null;
    const deviceId = body.device_id || tokenPayload.device_id || null;

    if (!deviceUuid && !serialNumber && !pairingCode) {
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

    // Resolve user_uuid from pairings table
    let userUuid: string | null = null;
    let resolvedDeviceUuid: string | null = deviceUuid;
    
    if (deviceUuid) {
      const { data: pairing } = await supabase
        .schema("display")
        .from("pairings")
        .select("user_uuid, device_uuid")
        .eq("device_uuid", deviceUuid)
        .maybeSingle();
      userUuid = pairing?.user_uuid ?? null;
      resolvedDeviceUuid = pairing?.device_uuid ?? deviceUuid;
    } else if (serialNumber) {
      const { data: pairing } = await supabase
        .schema("display")
        .from("pairings")
        .select("user_uuid, device_uuid")
        .eq("serial_number", serialNumber)
        .maybeSingle();
      userUuid = pairing?.user_uuid ?? null;
      resolvedDeviceUuid = pairing?.device_uuid ?? null;
    } else if (pairingCode) {
      const { data: pairing } = await supabase
        .schema("display")
        .from("pairings")
        .select("user_uuid, device_uuid")
        .eq("pairing_code", pairingCode)
        .maybeSingle();
      userUuid = pairing?.user_uuid ?? null;
      resolvedDeviceUuid = pairing?.device_uuid ?? null;
    }

    const hasLocalStatus = typeof body.webex_status === "string" && body.webex_status.trim().length > 0;
    let webexStatus: string;

    if (hasLocalStatus) {
      webexStatus = normalizeWebexStatus(body.webex_status);
    } else {
      if (!userUuid) {
        return new Response(JSON.stringify({ error: "Device not paired to a user" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Look up token by user_id (same pattern as webex-token)
      const { data: tokenRow, error: tokenError } = await supabase
        .schema("display")
        .from("oauth_tokens")
        .select("id, provider, serial_number, pairing_code, access_token_id, refresh_token_id, expires_at")
        .eq("provider", "webex")
        .eq("user_id", userUuid)
        .eq("token_scope", "user")
        .maybeSingle();

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
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (clientError || !clientRow) {
        return new Response(JSON.stringify({ error: "Webex client configuration missing" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const secretKey = userUuid || serialNumber || pairingCode || "token";
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

    if (resolvedDeviceUuid) {
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
        .eq("device_uuid", resolvedDeviceUuid);
    } else {
      // All devices now get device_uuid from device-auth, so this should not happen
      console.warn("Skipping pairings update: device_uuid not available", {
        pairing_code: pairingCode,
        serial_number: serialNumber,
        device_id: deviceId,
      });
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
