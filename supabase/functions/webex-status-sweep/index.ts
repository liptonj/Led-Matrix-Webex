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
  normalizeWebexStatus,
  refreshWebexToken,
  CANONICAL_STATUSES,
  STATUS_ALIASES,
} from "../_shared/webex.ts";

const COLLISION_WINDOW_MS = 15_000; // skip only if embedded app updated very recently

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

    const { data: tokenRows, error: tokenError } = await supabase
      .schema("display")
      .from("oauth_tokens")
      .select(
        "id, provider, serial_number, pairing_code, access_token_id, refresh_token_id, expires_at",
      )
      .eq("provider", "webex");

    if (tokenError || !tokenRows) {
      return new Response(JSON.stringify({ error: "Failed to load tokens" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const tokenRow of tokenRows) {
      try {
        const pairingCode = tokenRow.pairing_code as string | null;
        if (!pairingCode) {
          skipped++;
          continue;
        }

        const { data: pairingRow } = await supabase
          .schema("display")
          .from("pairings")
          .select("pairing_code, app_last_seen, app_connected, webex_status")
          .eq("pairing_code", pairingCode)
          .maybeSingle();

        if (pairingRow?.app_last_seen && pairingRow?.app_connected === true) {
          const lastSeen = new Date(pairingRow.app_last_seen as string).getTime();
          if (!Number.isNaN(lastSeen) && now - lastSeen < COLLISION_WINDOW_MS) {
            skipped++;
            continue;
          }
        }

        let accessToken = await fetchDecryptedSecret(supabase, tokenRow.access_token_id as string);
        const refreshTokenId = tokenRow.refresh_token_id as string | null;
        const refreshToken = refreshTokenId
          ? await fetchDecryptedSecret(supabase, refreshTokenId)
          : null;

        const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at as string) : null;
        const shouldRefresh = !expiresAt || expiresAt.getTime() - now < 60_000;

        if (shouldRefresh && refreshToken) {
          const clientSecret = await fetchDecryptedSecret(
            supabase,
            clientRow.client_secret_id as string,
          );
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
            `webex_access_${pairingCode}`,
          );

          let refreshTokenIdUpdated = refreshTokenId;
          if (refreshed.refresh_token) {
            refreshTokenIdUpdated = await updateSecret(
              supabase,
              refreshTokenId,
              refreshed.refresh_token,
              `webex_refresh_${pairingCode}`,
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

        const webexStatus = await fetchWebexStatus(accessToken);
        const inCall = ["meeting", "call", "presenting", "busy"].includes(webexStatus);

        // Check if status actually changed before updating
        // This prevents triggering realtime notifications for unchanged status
        const currentStatus = pairingRow?.webex_status as string | null;
        if (currentStatus === webexStatus) {
          // Status unchanged - skip the update to avoid unnecessary realtime notifications
          skipped++;
          continue;
        }

        // Get device_uuid and user_uuid for broadcast
        const { data: pairingWithUuids } = await supabase
          .schema("display")
          .from("pairings")
          .select("device_uuid, user_uuid")
          .eq("pairing_code", pairingCode)
          .maybeSingle();

        await supabase
          .schema("display")
          .from("pairings")
          .update({
            webex_status: webexStatus,
            in_call: inCall,
          })
          .eq("pairing_code", pairingCode);

        // Broadcast to device channel if device_uuid is available
        if (pairingWithUuids?.device_uuid) {
          try {
            await sendBroadcast(
              `device:${pairingWithUuids.device_uuid}`,
              "webex_status",
              {
                webex_status: webexStatus,
                in_call: inCall,
                device_uuid: pairingWithUuids.device_uuid,
              },
            );
          } catch (broadcastError) {
            console.error("Failed to broadcast webex_status to device channel:", broadcastError);
            // Don't fail the request - status is already updated
          }
        }

        // Broadcast to user channel if user_uuid is available
        if (pairingWithUuids?.user_uuid) {
          try {
            await sendBroadcast(
              `user:${pairingWithUuids.user_uuid}`,
              "webex_status",
              {
                webex_status: webexStatus,
                in_call: inCall,
                user_uuid: pairingWithUuids.user_uuid,
              },
            );
          } catch (broadcastError) {
            console.error("Failed to broadcast webex_status to user channel:", broadcastError);
            // Don't fail the request - status is already updated
          }
        }

        updated++;
      } catch (err) {
        console.error("Sweep token failed:", err);
        failed++;
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
            .select("id, access_token_id, refresh_token_id, expires_at")
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
            // Get pairing code and UUIDs for this device
            const { data: pairing } = await supabase
              .schema("display")
              .from("pairings")
              .select("pairing_code, webex_status, device_uuid, user_uuid")
              .eq("serial_number", serialNumber)
              .maybeSingle();

            if (pairing && pairing.webex_status !== webexStatus) {
              await supabase
                .schema("display")
                .from("pairings")
                .update({ webex_status: webexStatus, in_call: inCall })
                .eq("pairing_code", pairing.pairing_code);

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
          console.error("User token sweep failed:", err);
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
