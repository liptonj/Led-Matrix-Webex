/**
 * Insert Command Edge Function
 *
 * Embedded app calls this to queue a command for the device.
 * The device polls for commands via poll-commands or receives them via realtime.
 *
 * Authentication: Bearer token (from exchange-pairing-code)
 *
 * Request body:
 *   {
 *     command: string,           // Command name (e.g., "set_brightness", "reboot")
 *     payload?: object           // Optional command parameters
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     command_id: string,
 *     expires_at: string
 *   }
 */

import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";
import { sendBroadcast } from "../_shared/broadcast.ts";

// Command expiry (5 minutes)
const COMMAND_EXPIRY_SECONDS = 300;

interface InsertCommandRequest {
  command: string;
  payload?: Record<string, unknown>;
  device_uuid?: string; // Optional device UUID (preferred over serial_number)
}

interface InsertCommandResponse {
  success: boolean;
  command_id: string;
  expires_at: string;
}

interface TokenPayload {
  sub: string;
  pairing_code: string;
  serial_number: string;
  token_type: string;
  exp: number;
  device_uuid?: string;
  user_uuid?: string | null;
}

// Valid command names (whitelist for security)
const VALID_COMMANDS = [
  "set_brightness",
  "set_config",
  "get_config",
  "get_status",
  "get_telemetry",
  "get_troubleshooting_status",
  "reboot",
  "factory_reset",
  "ota_update",
  "set_display_name",
  "set_time_zone",
  "clear_wifi",
  "test_display",
  "ping",
];

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

    // Create Supabase client with service role (needed before first use)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Parse request body
    let commandData: InsertCommandRequest;
    try {
      commandData = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Determine device_uuid: prefer from request body, then from token, then look up from pairing_code
    let deviceUuid: string | undefined = commandData.device_uuid || appInfo.device_uuid;

    // If device_uuid not available, look it up from pairing_code
    if (!deviceUuid) {
      const { data: pairingRecord } = await supabase
        .schema("display")
        .from("pairings")
        .select("device_uuid")
        .eq("pairing_code", appInfo.pairing_code)
        .maybeSingle();

      deviceUuid = pairingRecord?.device_uuid;
    }

    if (!deviceUuid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Device UUID not found. Device may not be properly registered.",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate command name
    if (!commandData.command || typeof commandData.command !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid command" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate command is in whitelist
    if (!VALID_COMMANDS.includes(commandData.command)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid command. Valid commands: ${VALID_COMMANDS.join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate payload if provided
    if (commandData.payload && typeof commandData.payload !== "object") {
      return new Response(
        JSON.stringify({ success: false, error: "Payload must be an object" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Calculate expiry
    const expiresAt = new Date(Date.now() + COMMAND_EXPIRY_SECONDS * 1000);

    // Insert command with device_uuid
    const { data: command, error: insertError } = await supabase
      .schema("display")
      .from("commands")
      .insert({
        pairing_code: appInfo.pairing_code,
        serial_number: appInfo.serial_number, // Keep for backward compatibility
        device_uuid: deviceUuid,
        command: commandData.command,
        payload: commandData.payload || {},
        status: "pending",
        expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Failed to insert command:", insertError);

      // Check if it's a foreign key error (pairing doesn't exist)
      if (insertError.code === "23503") {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Pairing not found. Device may not be connected.",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({ success: false, error: "Failed to queue command" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `Command ${commandData.command} queued for device ${deviceUuid} (pairing: ${appInfo.pairing_code}, id: ${command.id})`,
    );

    // Broadcast to user channel if user_uuid is available
    if (appInfo.user_uuid) {
      try {
        await sendBroadcast(`user:${appInfo.user_uuid}`, "command", {
          device_uuid: deviceUuid,
          command: {
            id: command.id,
            command: commandData.command,
            payload: commandData.payload || {},
            status: "pending",
            expires_at: expiresAt.toISOString(),
          },
        });
      } catch (broadcastError) {
        console.error("Failed to broadcast to user channel:", broadcastError);
        // Don't fail the request - command is already queued
      }
    }

    const response: InsertCommandResponse = {
      success: true,
      command_id: command.id,
      expires_at: expiresAt.toISOString(),
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
