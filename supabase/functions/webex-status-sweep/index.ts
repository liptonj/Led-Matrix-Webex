/**
 * Webex Status Sweep (Scheduled)
 *
 * Polls all active Webex OAuth tokens and updates display.pairings.
 * Intended to run via Supabase cron (minutely). Skips updates when
 * embedded app has posted recently to avoid collisions.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchDecryptedSecret, updateSecret } from "../_shared/vault.ts";
import {
  fetchWebexStatus,
  refreshWebexToken,
} from "../_shared/webex.ts";
import { sendBroadcast } from "../_shared/broadcast.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Allow GET or POST to trigger sweep
  if (req.method !== "GET" && req.method !== "POST") {
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

    const now = Date.now();
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    // Backfill user_id for legacy tokens (migration support)
    // Query tokens without user_id and try to resolve from pairings
    const { data: legacyTokens } = await supabase
      .schema("display")
      .from("oauth_tokens")
      .select("id, device_uuid, serial_number")
      .eq("provider", "webex")
      .is("user_id", null)
      .limit(100); // Process in batches

    if (legacyTokens?.length) {
      for (const token of legacyTokens) {
        try {
          let userUuid: string | null = null;
          
          if (token.device_uuid) {
            const { data: pairing } = await supabase
              .schema("display")
              .from("pairings")
              .select("user_uuid")
              .eq("device_uuid", token.device_uuid)
              .maybeSingle();
            userUuid = pairing?.user_uuid ?? null;
          } else if (token.serial_number) {
            const { data: pairing } = await supabase
              .schema("display")
              .from("pairings")
              .select("user_uuid")
              .eq("serial_number", token.serial_number)
              .maybeSingle();
            userUuid = pairing?.user_uuid ?? null;
          }

          if (userUuid) {
            // Backfill the token with user_id
            await supabase
              .schema("display")
              .from("oauth_tokens")
              .update({ user_id: userUuid, token_scope: "user" })
              .eq("id", token.id);
          }
        } catch (err) {
          console.error(`Backfill token failed for device_uuid ${token.device_uuid || token.serial_number}:`, err);
          // Continue processing other tokens
        }
      }
    }

    // Phase 2: Poll using user tokens for devices with webex_polling_enabled
    const { data: enabledDevices } = await supabase
      .schema("display")
      .from("user_devices")
      .select("user_id, serial_number")
      .eq("webex_polling_enabled", true);

    if (enabledDevices?.length) {
      // Group by user_id to avoid duplicate API calls per user
      const devicesByUser = new Map<string, string[]>();
      for (const d of enabledDevices) {
        const list = devicesByUser.get(d.user_id) || [];
        list.push(d.serial_number);
        devicesByUser.set(d.user_id, list);
      }

      for (const [userId, serialNumbers] of devicesByUser) {
        try {
          // Get user's Webex token
          const { data: userToken } = await supabase
            .schema("display")
            .from("oauth_tokens")
            .select("id, access_token_id, refresh_token_id, expires_at, user_id")
            .eq("user_id", userId)
            .eq("token_scope", "user")
            .eq("provider", "webex")
            .maybeSingle();

          if (!userToken) continue; // User hasn't connected Webex

          // Fetch and potentially refresh access token
          let accessToken = await fetchDecryptedSecret(supabase, userToken.access_token_id as string);
          const expiresAt = userToken.expires_at ? new Date(userToken.expires_at as string) : null;
          const shouldRefresh = !expiresAt || expiresAt.getTime() - now < 60_000;

          if (shouldRefresh && userToken.refresh_token_id) {
            const clientSecret = await fetchDecryptedSecret(
              supabase,
              clientRow.client_secret_id as string,
            );
            const refreshToken = await fetchDecryptedSecret(supabase, userToken.refresh_token_id as string);

            const refreshed = await refreshWebexToken({
              clientId: clientRow.client_id as string,
              clientSecret,
              refreshToken,
            });

            accessToken = refreshed.access_token;
            const accessTokenId = await updateSecret(
              supabase,
              userToken.access_token_id as string,
              accessToken,
              `webex_user_access_${userId}`,
            );

            let refreshTokenIdUpdated = userToken.refresh_token_id as string;
            if (refreshed.refresh_token) {
              refreshTokenIdUpdated = await updateSecret(
                supabase,
                userToken.refresh_token_id as string,
                refreshed.refresh_token,
                `webex_user_refresh_${userId}`,
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
              .eq("id", userToken.id);
          }

          // Poll Webex once for this user
          const webexStatus = await fetchWebexStatus(accessToken);
          const inCall = ["meeting", "call", "presenting", "busy"].includes(webexStatus);

          // Update all user's enabled devices
          for (const serialNumber of serialNumbers) {
            // Get device UUIDs and status for this device
            const { data: pairing } = await supabase
              .schema("display")
              .from("pairings")
              .select("webex_status, device_uuid, user_uuid")
              .eq("serial_number", serialNumber)
              .maybeSingle();

            if (pairing && pairing.webex_status !== webexStatus) {
              await supabase
                .schema("display")
                .from("pairings")
                .update({ webex_status: webexStatus, in_call: inCall })
                .eq("device_uuid", pairing.device_uuid);

              // Broadcast to device channel if device_uuid is available
              if (pairing.device_uuid) {
                try {
                  await sendBroadcast(
                    `device:${pairing.device_uuid}`,
                    "webex_status",
                    {
                      webex_status: webexStatus,
                      in_call: inCall,
                      device_uuid: pairing.device_uuid,
                    },
                  );
                } catch (broadcastError) {
                  console.error("Failed to broadcast webex_status to device channel:", broadcastError);
                  // Don't fail the request - status is already updated
                }
              }

              // Broadcast to user channel
              try {
                await sendBroadcast(
                  `user:${userId}`,
                  "webex_status",
                  {
                    webex_status: webexStatus,
                    in_call: inCall,
                    user_uuid: userId,
                  },
                );
              } catch (broadcastError) {
                console.error("Failed to broadcast webex_status to user channel:", broadcastError);
                // Don't fail the request - status is already updated
              }

              updated++;
            } else {
              skipped++;
            }
          }
        } catch (err) {
          console.error(`User token sweep failed for user ${userId}:`, err);
          failed++;
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, updated, skipped, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Webex status sweep error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
