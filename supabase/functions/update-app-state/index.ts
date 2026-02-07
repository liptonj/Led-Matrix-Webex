/**
 * @deprecated This Edge Function is no longer called by any clients.
 * Status updates are now handled via direct database writes and Supabase Realtime broadcasts.
 * Kept for reference only -- will be removed in a future cleanup.
 *
 * Update App State Edge Function
 *
 * Embedded app calls this to update its Webex status in the pairings table.
 * The device polls this state via post-device-state or receives it via realtime.
 *
 * Authentication: Bearer token (from exchange-pairing-code) OR user session token
 *
 * Request body:
 *   {
 *     webex_status?: string,      // "active", "away", "dnd", "meeting", "offline", "busy", "ooo", etc.
 *     camera_on?: boolean,
 *     mic_muted?: boolean,
 *     in_call?: boolean,
 *     display_name?: string,
 *     device_uuid?: string          // Optional: target specific device (user session only)
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     device_connected: boolean,
 *     device_last_seen: string | null
 *   }
 */

import { createClient } from "@supabase/supabase-js";
import { sendBroadcast } from "../_shared/broadcast.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";
import { getUserFromRequest } from "../_shared/user_auth.ts";

interface UpdateAppStateRequest {
  webex_status?: string;
  camera_on?: boolean;
  mic_muted?: boolean;
  in_call?: boolean;
  display_name?: string;
  device_uuid?: string; // Optional: target specific device (user session only)
}

interface UpdateAppStateResponse {
  success: boolean;
  device_connected: boolean;
  device_last_seen: string | null;
}

interface TokenPayload {
  sub: string;
  pairing_code: string;
  serial_number?: string;
  token_type: string;
  exp: number;
}

// Valid Webex status values (includes firmware-supported aliases)
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

const VALID_STATUSES = Array.from(
  new Set([...CANONICAL_STATUSES, ...Object.keys(STATUS_ALIASES)]),
);

function normalizeWebexStatus(value: string): string | null {
  const key = value.trim().toLowerCase();
  if (!key) return null;
  const normalized = STATUS_ALIASES[key] ?? key;
  return CANONICAL_STATUSES.includes(normalized) ? normalized : null;
}

/**
 * Validate bearer token and return app info (for app tokens)
 */
async function validateAppToken(
  authHeader: string | null,
  tokenSecret: string,
): Promise<{ valid: boolean; error?: string; token?: TokenPayload }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.substring(7);

  try {
    const payload = await verifyDeviceToken(token, tokenSecret);

    // Verify token type - app tokens have type "app"
    if (payload.token_type !== "app") {
      return { valid: false, error: "Invalid token type" };
    }

    return { valid: true, token: payload };
  } catch (err) {
    if (err instanceof Error && err.message.includes("expired")) {
      return { valid: false, error: "Token expired" };
    }
    return { valid: false, error: "Invalid token" };
  }
}

/**
 * Authentication result - either app token or user session
 */
type AuthResult =
  | { type: "app"; pairingCode: string }
  | { type: "user"; userUuid: string };

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only allow POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get Supabase JWT signing secret (required for PostgREST/Realtime auth)
    const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("DEVICE_JWT_SECRET");
    if (!tokenSecret) {
      console.error("SUPABASE_JWT_SECRET/DEVICE_JWT_SECRET not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Authenticate: Try user session first, then fall back to app token
    const authHeader = req.headers.get("Authorization");
    let authResult: AuthResult | null = null;

    // Try user session authentication first
    const userAuthResult = await getUserFromRequest(req);
    if (userAuthResult.user && !userAuthResult.error) {
      authResult = { type: "user", userUuid: userAuthResult.user.id };
    } else {
      // Fall back to app token authentication
      const tokenResult = await validateAppToken(authHeader, tokenSecret);
      if (tokenResult.valid && tokenResult.token) {
        authResult = { type: "app", pairingCode: tokenResult.token.pairing_code };
      }
    }

    if (!authResult) {
      return new Response(
        JSON.stringify({ success: false, error: "Authentication required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Parse request body
    let stateData: UpdateAppStateRequest;
    try {
      stateData = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // For user sessions, device_uuid is optional
    // If not provided, we'll broadcast to user channel instead of updating DB
    const targetDeviceUuid = stateData.device_uuid;

    // Validate webex_status if provided (for app tokens and user sessions with device_uuid)
    // User sessions without device_uuid will validate in the broadcast-only branch
    if (typeof stateData.webex_status === "string" && (authResult.type === "app" || targetDeviceUuid)) {
      const normalizedStatus = normalizeWebexStatus(stateData.webex_status);
      if (!normalizedStatus) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Invalid webex_status. Must be one of: ${VALID_STATUSES.join(", ")}`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      stateData.webex_status = normalizedStatus;
    }

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Determine pairing lookup based on auth type
    let pairingQuery = supabase
      .schema("display")
      .from("pairings")
      .select("pairing_code, webex_status, camera_on, mic_muted, in_call, display_name, app_connected, device_uuid, user_uuid");

    if (authResult.type === "app") {
      // App token: use pairing_code
      pairingQuery = pairingQuery.eq("pairing_code", authResult.pairingCode);
    } else {
      // User session: use device_uuid if provided, otherwise we'll broadcast only
      if (targetDeviceUuid) {
        pairingQuery = pairingQuery.eq("device_uuid", targetDeviceUuid);
      } else {
        // No device_uuid: broadcast to user channel only (no DB update)
        // Validate webex_status if provided
        if (typeof stateData.webex_status === "string") {
          const normalizedStatus = normalizeWebexStatus(stateData.webex_status);
          if (!normalizedStatus) {
            return new Response(
              JSON.stringify({
                success: false,
                error: `Invalid webex_status. Must be one of: ${VALID_STATUSES.join(", ")}`,
              }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          stateData.webex_status = normalizedStatus;
        }

        // Broadcast to user channel
        const broadcastPayload: Record<string, unknown> = {
          webex_status: stateData.webex_status,
          updated_at: new Date().toISOString(),
        };
        if (typeof stateData.camera_on === "boolean") {
          broadcastPayload.camera_on = stateData.camera_on;
        }
        if (typeof stateData.mic_muted === "boolean") {
          broadcastPayload.mic_muted = stateData.mic_muted;
        }
        if (typeof stateData.in_call === "boolean") {
          broadcastPayload.in_call = stateData.in_call;
        }
        if (typeof stateData.display_name === "string") {
          broadcastPayload.display_name = stateData.display_name;
        }

        try {
          await sendBroadcast(
            `user:${authResult.userUuid}`,
            "webex_status",
            broadcastPayload,
          );
        } catch (broadcastError) {
          console.error("Failed to broadcast to user channel:", broadcastError);
          return new Response(
            JSON.stringify({ success: false, error: "Failed to broadcast status" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Return success response (no device connection info for broadcast-only)
        return new Response(
          JSON.stringify({
            success: true,
            device_connected: false,
            device_last_seen: null,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // Fetch current status values to check if anything actually changed
    let { data: currentPairing, error: fetchError } = await pairingQuery.maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Failed to fetch current pairing:", fetchError);
    }

    // If no pairing exists for user session with device_uuid, create one
    // This handles the case where a user connects to a device that has no pairing row yet
    if (!currentPairing && authResult.type === "user" && targetDeviceUuid) {
      // Look up device info to create pairing
      const { data: device, error: deviceLookupError } = await supabase
        .schema("display")
        .from("devices")
        .select("pairing_code, serial_number, device_id")
        .eq("id", targetDeviceUuid)
        .single();

      if (device && !deviceLookupError) {
        // Build pairing data with provided state
        const pairingData: Record<string, unknown> = {
          pairing_code: device.pairing_code,
          serial_number: device.serial_number,
          device_id: device.device_id,
          device_uuid: targetDeviceUuid,
          user_uuid: authResult.userUuid,
          app_connected: true,
        };

        // Include any status fields provided in the request
        if (typeof stateData.webex_status === "string") {
          pairingData.webex_status = stateData.webex_status;
        }
        if (typeof stateData.camera_on === "boolean") {
          pairingData.camera_on = stateData.camera_on;
        }
        if (typeof stateData.mic_muted === "boolean") {
          pairingData.mic_muted = stateData.mic_muted;
        }
        if (typeof stateData.in_call === "boolean") {
          pairingData.in_call = stateData.in_call;
        }
        if (typeof stateData.display_name === "string") {
          pairingData.display_name = stateData.display_name;
        }

        // Upsert pairing (in case of race condition with device-auth)
        const { data: newPairing, error: insertError } = await supabase
          .schema("display")
          .from("pairings")
          .upsert(pairingData, { onConflict: "pairing_code" })
          .select("pairing_code, webex_status, camera_on, mic_muted, in_call, display_name, app_connected, device_uuid, user_uuid")
          .single();

        if (newPairing && !insertError) {
          currentPairing = newPairing;
          console.log(`Created pairing for user session: device_uuid=${targetDeviceUuid}`);
        } else if (insertError) {
          console.error("Failed to create pairing for user session:", insertError);
        }
      } else {
        console.error("Device not found for user session pairing creation:", targetDeviceUuid, deviceLookupError);
      }
    }

    // Track if any status-relevant fields are changing
    let hasStatusChange = false;
    const statusUpdateData: Record<string, unknown> = {};

    // Only include status fields if they differ from current values
    if (typeof stateData.webex_status === "string") {
      if (!currentPairing || currentPairing.webex_status !== stateData.webex_status) {
        statusUpdateData.webex_status = stateData.webex_status;
        hasStatusChange = true;
      }
    }
    if (typeof stateData.camera_on === "boolean") {
      if (!currentPairing || currentPairing.camera_on !== stateData.camera_on) {
        statusUpdateData.camera_on = stateData.camera_on;
        hasStatusChange = true;
      }
    }
    if (typeof stateData.mic_muted === "boolean") {
      if (!currentPairing || currentPairing.mic_muted !== stateData.mic_muted) {
        statusUpdateData.mic_muted = stateData.mic_muted;
        hasStatusChange = true;
      }
    }
    if (typeof stateData.in_call === "boolean") {
      if (!currentPairing || currentPairing.in_call !== stateData.in_call) {
        statusUpdateData.in_call = stateData.in_call;
        hasStatusChange = true;
      }
    }
    if (typeof stateData.display_name === "string" && stateData.display_name.trim()) {
      if (!currentPairing || currentPairing.display_name !== stateData.display_name) {
        statusUpdateData.display_name = stateData.display_name;
        hasStatusChange = true;
      }
    }

    // Check if app_connected state is changing (was disconnected, now connected)
    const wasDisconnected = !currentPairing || !currentPairing.app_connected;
    if (wasDisconnected) {
      statusUpdateData.app_connected = true;
      hasStatusChange = true;
    }

    const now = new Date().toISOString();

    // Get pairing_code for validation
    const pairingCode = currentPairing?.pairing_code || (authResult.type === "app" ? authResult.pairingCode : null);
    
    if (!pairingCode) {
      return new Response(
        JSON.stringify({ success: false, error: "Pairing not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get device connection state from pairings table (heartbeat tracking now handled by DB trigger)
    const { data: heartbeat } = await supabase
      .schema("display")
      .from("pairings")
      .select("device_connected, device_last_seen")
      .eq("pairing_code", pairingCode)
      .maybeSingle();

    // ONLY update pairings table if status actually changed (triggers realtime)
    let pairing = currentPairing;
    let updateError: { code?: string; message?: string } | null = null;

    if (hasStatusChange) {
      // Build update query - support both pairing_code and device_uuid
      let updateQuery = supabase
        .schema("display")
        .from("pairings")
        .update(statusUpdateData);

      if (authResult.type === "app") {
        updateQuery = updateQuery.eq("pairing_code", authResult.pairingCode);
      } else if (targetDeviceUuid) {
        updateQuery = updateQuery.eq("device_uuid", targetDeviceUuid);
      } else {
        // Should not happen - we already handled broadcast-only case
        return new Response(
          JSON.stringify({ success: false, error: "Invalid request" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data, error } = await updateQuery
        .select("webex_status, camera_on, mic_muted, in_call, display_name, app_connected, device_uuid, user_uuid")
        .single();
      
      pairing = data;
      updateError = error;

      // If update succeeded and we have user_uuid, also broadcast to user channel
      if (!error && pairing?.user_uuid) {
        const broadcastPayload: Record<string, unknown> = {
          device_uuid: pairing.device_uuid || null,
          webex_status: pairing.webex_status,
          updated_at: new Date().toISOString(),
        };
        if (typeof pairing.camera_on === "boolean") {
          broadcastPayload.camera_on = pairing.camera_on;
        }
        if (typeof pairing.mic_muted === "boolean") {
          broadcastPayload.mic_muted = pairing.mic_muted;
        }
        if (typeof pairing.in_call === "boolean") {
          broadcastPayload.in_call = pairing.in_call;
        }
        if (typeof pairing.display_name === "string") {
          broadcastPayload.display_name = pairing.display_name;
        }

        try {
          await sendBroadcast(
            `user:${pairing.user_uuid}`,
            "webex_status",
            broadcastPayload,
          );
        } catch (broadcastError) {
          // Log but don't fail the request - DB update succeeded
          console.error("Failed to broadcast to user channel:", broadcastError);
        }
      }
    }

    if (updateError) {
      // If pairing doesn't exist, try to create it (only for app tokens)
      if (updateError.code === "PGRST116" && authResult.type === "app") {
        // Look up device info from devices table (including id for device_uuid)
        const { data: device } = await supabase
          .schema("display")
          .from("devices")
          .select("id, serial_number, device_id")
          .eq("pairing_code", authResult.pairingCode)
          .single();

        if (device) {
          const { error: insertError } = await supabase
            .schema("display")
            .from("pairings")
            .insert({
              pairing_code: authResult.pairingCode,
              serial_number: device.serial_number,
              device_id: device.device_id,
              device_uuid: device.id,
              app_connected: true,
              ...stateData,
            });

          if (insertError) {
            console.error("Failed to create pairing:", insertError);
          }
        }

        // Return default response for new pairing
        const response: UpdateAppStateResponse = {
          success: true,
          device_connected: false,
          device_last_seen: null,
        };

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.error("Failed to update pairing:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update state" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if device connection is stale (no heartbeat in 60s)
    // Use heartbeat table data instead of pairings table
    let deviceConnected = heartbeat?.device_connected ?? false;
    if (deviceConnected && heartbeat?.device_last_seen) {
      const lastSeen = new Date(heartbeat.device_last_seen as string).getTime();
      const nowMs = Date.now();
      if (nowMs - lastSeen > 60000) {
        deviceConnected = false;
      }
    }

    const response: UpdateAppStateResponse = {
      success: true,
      device_connected: deviceConnected,
      device_last_seen: (heartbeat?.device_last_seen as string) ?? null,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
