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
import { sendBroadcast } from "../_shared/broadcast.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";

// Command expiry (5 minutes)
const COMMAND_EXPIRY_SECONDS = 300;

interface InsertCommandRequest {
  command: string;
  payload?: Record<string, unknown>;
  device_uuid?: string; // Required for user session auth, optional for app tokens
}

interface InsertCommandResponse {
  success: boolean;
  command_id: string;
  expires_at: string;
}

interface AppTokenPayload {
  sub: string;
  pairing_code: string;
  serial_number: string;
  token_type: string;
  exp: number;
  device_uuid?: string;
  user_uuid?: string | null;
}

/**
 * Authenticated caller info - unified across both auth paths
 */
interface CallerInfo {
  auth_type: "app" | "user";
  user_uuid: string | null;
  pairing_code?: string;
  serial_number?: string;
  device_uuid?: string;
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
 * Validate bearer token - supports both app tokens and Supabase user session tokens
 */
async function validateToken(
  authHeader: string | null,
  tokenSecret: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<{ valid: boolean; error?: string; caller?: CallerInfo }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.substring(7);

  // Path 1: Try app token validation (from exchange-pairing-code)
  try {
    const payload = await verifyDeviceToken(token, tokenSecret) as AppTokenPayload;
    if (payload.token_type === "app") {
      return {
        valid: true,
        caller: {
          auth_type: "app",
          user_uuid: payload.user_uuid || null,
          pairing_code: payload.pairing_code,
          serial_number: payload.serial_number,
          device_uuid: payload.device_uuid,
        },
      };
    }
    // Token verified but not an app token - fall through to user session check
  } catch {
    // Not a valid app token - fall through to user session check
  }

  // Path 2: Try Supabase user session token
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return { valid: false, error: "Invalid or expired token" };
    }

    return {
      valid: true,
      caller: {
        auth_type: "user",
        user_uuid: user.id,
      },
    };
  } catch {
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

    // Get Supabase config
    const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("DEVICE_JWT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // Validate token (supports both app tokens and user session tokens)
    const authHeader = req.headers.get("Authorization");
    const authResult = await validateToken(authHeader, tokenSecret, supabaseUrl, supabaseKey);

    if (!authResult.valid || !authResult.caller) {
      return new Response(
        JSON.stringify({ success: false, error: authResult.error }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const caller = authResult.caller;
    console.log(`Command request from ${caller.auth_type} auth (user: ${caller.user_uuid || "none"})`);

    // Create Supabase client with service role
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

    // Determine device_uuid based on auth type
    let deviceUuid: string | undefined;

    if (caller.auth_type === "user") {
      // User session auth: device_uuid MUST come from request body
      deviceUuid = commandData.device_uuid;
      if (!deviceUuid) {
        return new Response(
          JSON.stringify({ success: false, error: "device_uuid is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Verify the device belongs to this user
      const { data: userDevice, error: deviceError } = await supabase
        .schema("display")
        .from("user_devices")
        .select("device_uuid")
        .eq("user_id", caller.user_uuid!)
        .eq("device_uuid", deviceUuid)
        .maybeSingle();

      if (deviceError || !userDevice) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Device not found or not assigned to your account",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    } else {
      // App token auth: prefer request body, then token, then look up from pairing_code
      deviceUuid = commandData.device_uuid || caller.device_uuid;

      if (!deviceUuid && caller.pairing_code) {
        const { data: pairingRecord } = await supabase
          .schema("display")
          .from("pairings")
          .select("device_uuid")
          .eq("pairing_code", caller.pairing_code)
          .maybeSingle();

        deviceUuid = pairingRecord?.device_uuid;
      }
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

    // Look up pairing_code for the device (needed for DB insert)
    let pairingCode = caller.pairing_code;
    let serialNumber = caller.serial_number;
    if (!pairingCode || !serialNumber) {
      const { data: device } = await supabase
        .schema("display")
        .from("devices")
        .select("pairing_code, serial_number")
        .eq("id", deviceUuid)
        .maybeSingle();

      pairingCode = pairingCode || device?.pairing_code;
      serialNumber = serialNumber || device?.serial_number;
    }

    // Insert command with device_uuid
    const { data: command, error: insertError } = await supabase
      .schema("display")
      .from("commands")
      .insert({
        pairing_code: pairingCode || "unknown",
        serial_number: serialNumber || "unknown",
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
      `Command ${commandData.command} queued for device ${deviceUuid} (id: ${command.id}, auth: ${caller.auth_type})`,
    );

    // Broadcast to device channel for command delivery
    if (deviceUuid) {
      try {
        await sendBroadcast(`device:${deviceUuid}`, "command", {
          device_uuid: deviceUuid,
          command: {
            id: command.id,
            command: commandData.command,
            payload: commandData.payload || {},
            status: "pending",
            created_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
          },
        });
        console.log(`Command broadcast to device:${deviceUuid}`);
      } catch (broadcastError) {
        console.error("Failed to broadcast to device channel:", broadcastError);
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
