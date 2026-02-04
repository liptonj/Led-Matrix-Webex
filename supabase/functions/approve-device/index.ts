/**
 * Approve Device Edge Function
 *
 * Allows authenticated users to approve devices by pairing code.
 * Updates devices table with user_approved_by and approved_at.
 * Creates entry in user_devices table.
 *
 * Request body:
 * {
 *   "pairing_code": "ABC123"  // 6 characters
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Device approved successfully"
 * }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getUserFromRequest } from "../_shared/user_auth.ts";
import { validatePairingCode, isCodeExpired } from "../_shared/pairing_code.ts";

interface ApproveRequest {
  pairing_code: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    // Authenticate user
    const authResult = await getUserFromRequest(req);
    if (authResult.error) {
      return authResult.error;
    }
    const { user } = authResult;

    // Parse and validate pairing code
    const body: ApproveRequest = await req.json();
    const validation = validatePairingCode(body.pairing_code);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const normalizedCode = validation.code!;

    // Use service role client for database operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Look up device by pairing_code
    const { data: device, error: deviceError } = await supabase
      .schema("display")
      .select("serial_number, user_approved_by, created_at")
      .eq("pairing_code", normalizedCode)
      .single();

    if (deviceError || !device) {
      return new Response(
        JSON.stringify({ error: "Device not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if pairing code expired
    if (isCodeExpired(device.created_at)) {
      return new Response(
        JSON.stringify({ error: "Pairing code has expired" }),
        {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if already approved by this user
    if (device.user_approved_by === user.id) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Device already approved by you",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Update device with approval
    const { error: updateError } = await supabase
      .schema("display")
      .from("devices")
      .update({
        user_approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("pairing_code", normalizedCode);

    if (updateError) {
      console.error("Failed to update device approval:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to approve device" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Create or update user_devices entry
    const { error: upsertError } = await supabase
      .schema("display")
      .from("user_devices")
      .upsert(
        {
          user_id: user.id,
          serial_number: device.serial_number,
          created_by: user.id,
          provisioning_method: "user_approved",
          provisioned_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,serial_number",
          ignoreDuplicates: false,
        },
      );

    if (upsertError) {
      console.error("Failed to create user_devices entry:", upsertError);
      // Don't fail the request - device is already approved
      // Just log the error
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Device approved successfully",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Approve device error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
