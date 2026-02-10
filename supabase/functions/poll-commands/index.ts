/**
 * Poll Commands Edge Function
 *
 * Devices poll for pending commands. Returns up to 10 oldest pending
 * commands for the device's UUID.
 *
 * Authentication: Bearer token (from device-auth) AND HMAC headers (both required)
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

import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { validateDeviceAuth } from "../_shared/device_auth.ts";

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

    // Authenticate: require both JWT + HMAC with serial cross-validation
    const authResult = await validateDeviceAuth(req, supabase, body);
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({ success: false, error: authResult.error }),
        {
          status: authResult.httpStatus || 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate device_uuid is available
    if (!authResult.deviceUuid) {
      return new Response(
        JSON.stringify({ success: false, error: "Device UUID not found" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Query pending commands for this device using device_uuid
    const { data: commands, error: queryError } = await supabase
      .schema("display")
      .from("commands")
      .select("id, command, payload, created_at")
      .eq("status", "pending")
      .eq("device_uuid", authResult.deviceUuid)
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
