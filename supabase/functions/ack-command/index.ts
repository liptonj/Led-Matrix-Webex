/**
 * Acknowledge Command Edge Function
 *
 * Devices call this to acknowledge command completion (success or failure).
 *
 * Authentication: Bearer token (from device-auth) AND HMAC headers (both required)
 *
 * Request body:
 *   {
 *     command_id: string,
 *     success: boolean,
 *     response?: object,
 *     error?: string
 *   }
 *
 * Response:
 *   { success: true }
 */

import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { validateDeviceAuth } from "../_shared/device_auth.ts";

interface AckCommandRequest {
  command_id: string;
  success: boolean;
  response?: Record<string, unknown>;
  error?: string;
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

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Read body for HMAC verification
    const body = await req.text();

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

    // Validate device_uuid is present
    if (!authResult.deviceUuid) {
      return new Response(
        JSON.stringify({ success: false, error: "Device UUID not found" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Parse request body
    let ackData: AckCommandRequest;
    try {
      ackData = JSON.parse(body);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate required fields
    if (!ackData.command_id || typeof ackData.command_id !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid command_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (typeof ackData.success !== "boolean") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid success field" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fetch command with device_uuid directly from commands table
    const { data: command, error: fetchError } = await supabase
      .schema("display")
      .from("commands")
      .select("id, device_uuid, status, command")
      .eq("id", ackData.command_id)
      .single();

    if (fetchError || !command) {
      console.log(`Command not found: ${ackData.command_id}`);
      return new Response(
        JSON.stringify({ success: false, error: "Command not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Verify ownership using device_uuid directly from command
    if (!command.device_uuid || command.device_uuid !== authResult.deviceUuid) {
      console.log(
        `Command ${ackData.command_id} belongs to device ${command.device_uuid || "unknown"}, not ${authResult.deviceUuid}`,
      );
      return new Response(
        JSON.stringify({ success: false, error: "Command not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if already acked
    if (command.status !== "pending") {
      console.log(`Command ${ackData.command_id} already in status: ${command.status}`);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Command already ${command.status}`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Update command status
    const updateData: Record<string, unknown> = {
      status: ackData.success ? "acked" : "failed",
      acked_at: new Date().toISOString(),
    };

    if (ackData.response) {
      updateData.response = ackData.response;
    }

    if (ackData.error) {
      updateData.error = ackData.error;
    }

    const { error: updateError } = await supabase
      .schema("display")
      .from("commands")
      .update(updateData)
      .eq("id", ackData.command_id)
      .eq("device_uuid", authResult.deviceUuid);

    if (updateError) {
      console.error("Failed to update command:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to acknowledge command" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Persist config snapshot for config-related commands
    if (
      (command.command === 'get_config' || command.command === 'set_config') &&
      ackData.success &&
      ackData.response
    ) {
      const { error: configError } = await supabase
        .schema('display')
        .from('pairings')
        .update({ config: ackData.response })
        .eq('device_uuid', command.device_uuid);

      if (configError) {
        console.warn(
          `Failed to persist config for ${command.device_uuid}:`,
          configError.message,
        );
      }
    }

    console.log(
      `Command ${ackData.command_id} acknowledged: ${ackData.success ? "success" : "failed"}`,
    );

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
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
