/**
 * Webex Status Sync Edge Function
 *
 * Fetches Webex status for a device using stored OAuth tokens and updates
 * display.pairings. Requires JWT + HMAC for device tokens; JWT only for app tokens.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { validateDeviceAuth } from "../_shared/device_auth.ts";
import { fetchDecryptedSecret, updateSecret } from "../_shared/vault.ts";
import {
  fetchWebexStatus,
  normalizeWebexStatus,
  refreshWebexToken,
  CANONICAL_STATUSES,
  STATUS_ALIASES,
} from "../_shared/webex.ts";

interface SyncRequest {
  device_uuid?: string;
  serial_number?: string;
  device_id?: string;
  camera_on?: boolean;
  mic_muted?: boolean;
  in_call?: boolean;
  display_name?: string;
  webex_status?: string;
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
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Read body as text first for HMAC verification
    const bodyText = await req.text();

    // Authenticate: require HMAC for device tokens, allow app tokens without HMAC
    const authResult = await validateDeviceAuth(req, supabase, bodyText, {
      requireDeviceTokenType: false,
      allowAppToken: true,
    });
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: authResult.error }), {
        status: authResult.httpStatus || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: SyncRequest = {};
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = {};
      }
    }

    // device_uuid comes from auth context (JWT claim or HMAC validation)
    const deviceUuid = authResult.deviceUuid || body.device_uuid || null;
    const serialNumber = body.serial_number || authResult.serialNumber || null;
    const deviceId = body.device_id || authResult.deviceId || null;

    if (!deviceUuid) {
      return new Response(JSON.stringify({ error: "Missing device_uuid from auth context" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve user_uuid from pairings table using device_uuid
    const { data: pairing } = await supabase
      .schema("display")
      .from("pairings")
      .select("user_uuid, device_uuid")
      .eq("device_uuid", deviceUuid)
      .maybeSingle();
    
    const userUuid = pairing?.user_uuid ?? null;
    const resolvedDeviceUuid = pairing?.device_uuid ?? deviceUuid;

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
        .select("id, provider, serial_number, access_token_id, refresh_token_id, expires_at")
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

      // Use device_uuid for rate limiting keys
      const secretKey = deviceUuid || userUuid || "token";
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
    }

    return new Response(
      JSON.stringify({
        success: true,
        webex_status: webexStatus,
        device_uuid: resolvedDeviceUuid,
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
