/**
 * Webex Status Sweep (Scheduled)
 *
 * Polls all active Webex OAuth tokens and updates display.pairings.
 * Intended to run via Supabase cron (minutely). Skips updates when
 * embedded app has posted recently to avoid collisions.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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

const COLLISION_WINDOW_MS = 15_000; // skip only if embedded app updated very recently

function normalizeWebexStatus(value: string | null | undefined): string {
  if (!value) return "unknown";
  const key = value.trim().toLowerCase();
  const normalized = STATUS_ALIASES[key] ?? key;
  return CANONICAL_STATUSES.includes(normalized) ? normalized : "unknown";
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

        await supabase
          .schema("display")
          .from("pairings")
          .update({
            webex_status: webexStatus,
            in_call: inCall,
          })
          .eq("pairing_code", pairingCode);

        updated++;
      } catch (err) {
        console.error("Sweep token failed:", err);
        failed++;
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
