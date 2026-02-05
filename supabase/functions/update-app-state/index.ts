/**
 * Update App State Edge Function
 *
 * Embedded app calls this to update its Webex status in the pairings table.
 * The device polls this state via post-device-state or receives it via realtime.
 *
 * Authentication: Bearer token (from exchange-pairing-code)
 *
 * Request body:
 *   {
 *     webex_status: string,      // "active", "away", "dnd", "meeting", "offline", "busy", "ooo", etc.
 *     camera_on?: boolean,
 *     mic_muted?: boolean,
 *     in_call?: boolean,
 *     display_name?: string
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
import { corsHeaders } from "../_shared/cors.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";

interface UpdateAppStateRequest {
  webex_status?: string;
  camera_on?: boolean;
  mic_muted?: boolean;
  in_call?: boolean;
  display_name?: string;
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
 * Validate bearer token and return app info
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

    // Verify token type - app tokens have type "app_auth"
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

    // Validate app token
    const authHeader = req.headers.get("Authorization");
    const tokenResult = await validateAppToken(authHeader, tokenSecret);

    if (!tokenResult.valid || !tokenResult.token) {
      return new Response(
        JSON.stringify({ success: false, error: tokenResult.error }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const appInfo = tokenResult.token;

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
    if (stateData.webex_status && !VALID_STATUSES.includes(stateData.webex_status)) {
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

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // First, fetch current status values to check if anything actually changed
    const { data: currentPairing, error: fetchError } = await supabase
      .schema("display")
      .from("pairings")
      .select("webex_status, camera_on, mic_muted, in_call, display_name, app_connected")
      .eq("pairing_code", appInfo.pairing_code)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Failed to fetch current pairing:", fetchError);
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

    // ALWAYS update heartbeat table (does NOT trigger realtime to device)
    await supabase
      .schema("display")
      .from("connection_heartbeats")
      .upsert({
        pairing_code: appInfo.pairing_code,
        app_last_seen: now,
        app_connected: true,
      }, { onConflict: "pairing_code" });

    // Get device connection state from heartbeat table
    const { data: heartbeat } = await supabase
      .schema("display")
      .from("connection_heartbeats")
      .select("device_connected, device_last_seen")
      .eq("pairing_code", appInfo.pairing_code)
      .maybeSingle();

    // ONLY update pairings table if status actually changed (triggers realtime)
    let pairing = currentPairing;
    let updateError: { code?: string; message?: string } | null = null;

    if (hasStatusChange) {
      const { data, error } = await supabase
        .schema("display")
        .from("pairings")
        .update(statusUpdateData)
        .eq("pairing_code", appInfo.pairing_code)
        .select("webex_status, camera_on, mic_muted, in_call, display_name, app_connected")
        .single();
      
      pairing = data;
      updateError = error;
    }

    if (updateError) {
      // If pairing doesn't exist, try to create it
      if (updateError.code === "PGRST116") {
        // Look up serial_number from devices table
        const { data: device } = await supabase
          .schema("display")
          .from("devices")
          .select("serial_number, device_id")
          .eq("pairing_code", appInfo.pairing_code)
          .single();

        if (device) {
          const { error: insertError } = await supabase
            .schema("display")
            .from("pairings")
            .insert({
              pairing_code: appInfo.pairing_code,
              serial_number: device.serial_number,
              device_id: device.device_id,
              app_connected: true,
              ...stateData,
            });

          if (insertError) {
            console.error("Failed to create pairing:", insertError);
          }

          // Also create heartbeat record
          await supabase
            .schema("display")
            .from("connection_heartbeats")
            .upsert({
              pairing_code: appInfo.pairing_code,
              app_last_seen: now,
              app_connected: true,
            }, { onConflict: "pairing_code" });
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
