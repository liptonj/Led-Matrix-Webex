/**
 * Acknowledge Command Edge Function
 *
 * Devices call this to acknowledge command completion (success or failure).
 *
 * Authentication: Bearer token (from device-auth) OR HMAC headers
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
import { validateHmacRequest } from "../_shared/hmac.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";

interface AckCommandRequest {
  command_id: string;
  success: boolean;
  response?: Record<string, unknown>;
  error?: string;
}

interface TokenPayload {
  sub: string;
  pairing_code: string;
  serial_number: string;
  token_type: string;
  exp: number;
  device_uuid?: string;
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

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Read body
    const body = await req.text();

    let deviceInfo: { serial_number: string; device_uuid: string | null };

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
      // Extract device_uuid from JWT token
      if (!tokenResult.device.device_uuid) {
        return new Response(
          JSON.stringify({ success: false, error: "Device UUID not found in token" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      deviceInfo = {
        serial_number: tokenResult.device.serial_number,
        device_uuid: tokenResult.device.device_uuid,
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
      // For HMAC, fetch device_uuid from devices table
      const { data: dev } = await supabase
        .schema("display")
        .from("devices")
        .select("id")
        .eq("serial_number", hmacResult.device.serial_number)
        .single();
      
      if (!dev?.id) {
        return new Response(
          JSON.stringify({ success: false, error: "Device UUID not found" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      
      deviceInfo = {
        serial_number: hmacResult.device.serial_number,
        device_uuid: dev.id,
      };
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

    // Fetch command
    const { data: command, error: fetchError } = await supabase
      .schema("display")
      .from("commands")
      .select("id, pairing_code, status")
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

    // Fetch pairing to get device_uuid for ownership verification
    const { data: pairing, error: pairingError } = await supabase
      .schema("display")
      .from("pairings")
      .select("device_uuid")
      .eq("pairing_code", command.pairing_code)
      .single();

    if (pairingError || !pairing) {
      console.log(`Pairing not found for command ${ackData.command_id}`);
      return new Response(
        JSON.stringify({ success: false, error: "Command not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Verify ownership using device_uuid
    if (pairing.device_uuid !== deviceInfo.device_uuid) {
      console.log(
        `Command ${ackData.command_id} belongs to device ${pairing.device_uuid}, not ${deviceInfo.device_uuid}`,
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
      .eq("id", ackData.command_id);

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
