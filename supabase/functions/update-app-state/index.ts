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
 *     webex_status: string,      // "active", "away", "dnd", "meeting", "offline"
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";

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

// Valid Webex status values
const VALID_STATUSES = ["active", "away", "dnd", "meeting", "offline", "call", "presenting"];

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
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(tokenSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );

    const payload = (await verify(token, key)) as unknown as TokenPayload;

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

    // Build update data - only app-owned columns
    const updateData: Record<string, unknown> = {
      app_connected: true,
      app_last_seen: new Date().toISOString(),
    };

    if (typeof stateData.webex_status === "string") {
      updateData.webex_status = stateData.webex_status;
    }
    if (typeof stateData.camera_on === "boolean") {
      updateData.camera_on = stateData.camera_on;
    }
    if (typeof stateData.mic_muted === "boolean") {
      updateData.mic_muted = stateData.mic_muted;
    }
    if (typeof stateData.in_call === "boolean") {
      updateData.in_call = stateData.in_call;
    }
    if (typeof stateData.display_name === "string") {
      updateData.display_name = stateData.display_name;
    }

    // Update pairings table and get device connection state
    const { data: pairing, error: updateError } = await supabase
      .schema("display")
      .from("pairings")
      .update(updateData)
      .eq("pairing_code", appInfo.pairing_code)
      .select("device_connected, device_last_seen")
      .single();

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
              app_last_seen: new Date().toISOString(),
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
    let deviceConnected = pairing?.device_connected ?? false;
    if (deviceConnected && pairing?.device_last_seen) {
      const lastSeen = new Date(pairing.device_last_seen).getTime();
      const now = Date.now();
      if (now - lastSeen > 60000) {
        deviceConnected = false;
      }
    }

    const response: UpdateAppStateResponse = {
      success: true,
      device_connected: deviceConnected,
      device_last_seen: pairing?.device_last_seen ?? null,
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
