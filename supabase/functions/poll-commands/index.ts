/**
 * Poll Commands Edge Function
 *
 * Devices poll for pending commands. Returns up to 10 oldest pending
 * commands for the device's pairing code.
 *
 * Authentication: Bearer token (from device-auth) OR HMAC headers
 *
 * Response:
 *   {
 *     success: true,
 *     commands: [
 *       {
 *         id: string,
 *         command: string,
 *         payload: object,
 *         created_at: string
 *       }
 *     ]
 *   }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";

const MAX_COMMANDS_PER_POLL = 10;

interface CommandItem {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface PollCommandsResponse {
  success: boolean;
  commands: CommandItem[];
}

interface TokenPayload {
  sub: string;
  pairing_code: string;
  serial_number: string;
  token_type: string;
  exp: number;
}

/**
 * Validate bearer token and return device info
 */
async function validateBearerToken(
  authHeader: string | null,
  tokenSecret: string,
): Promise<{ valid: boolean; error?: string; device?: TokenPayload }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.substring(7);

  try {
    const payload = await verifyDeviceToken(token, tokenSecret);

    // Verify token type
    if (payload.token_type !== "device") {
      return { valid: false, error: "Invalid token type" };
    }

    return { valid: true, device: payload };
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
    // Allow GET or POST requests
    if (req.method !== "GET" && req.method !== "POST") {
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

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Read body (might be empty for GET)
    let body = "";
    if (req.method === "POST") {
      body = await req.text();
    }

    let deviceInfo: { serial_number: string; pairing_code: string };

    // Try bearer token first, fall back to HMAC
    const authHeader = req.headers.get("Authorization");

    if (authHeader?.startsWith("Bearer ")) {
      const tokenResult = await validateBearerToken(authHeader, tokenSecret);
      if (!tokenResult.valid || !tokenResult.device) {
        return new Response(
          JSON.stringify({ success: false, error: tokenResult.error }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      deviceInfo = {
        serial_number: tokenResult.device.serial_number,
        pairing_code: tokenResult.device.pairing_code,
      };
    } else {
      // Fall back to HMAC authentication
      const hmacResult = await validateHmacRequest(req, supabase, body);
      if (!hmacResult.valid || !hmacResult.device) {
        return new Response(
          JSON.stringify({ success: false, error: hmacResult.error }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      deviceInfo = {
        serial_number: hmacResult.device.serial_number,
        pairing_code: hmacResult.device.pairing_code,
      };
    }

    // Query pending commands for this device's pairing code
    const { data: commands, error: queryError } = await supabase
      .schema("display")
      .from("commands")
      .select("id, command, payload, created_at")
      .eq("pairing_code", deviceInfo.pairing_code)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString()) // Only non-expired commands
      .order("created_at", { ascending: true })
      .limit(MAX_COMMANDS_PER_POLL);

    if (queryError) {
      console.error("Failed to query commands:", queryError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch commands" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Format response
    const commandItems: CommandItem[] = (commands || []).map((cmd) => ({
      id: cmd.id,
      command: cmd.command,
      payload: cmd.payload || {},
      created_at: cmd.created_at,
    }));

    const response: PollCommandsResponse = {
      success: true,
      commands: commandItems,
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
