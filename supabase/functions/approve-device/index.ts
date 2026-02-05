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
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { isCodeExpired, validatePairingCode } from "../_shared/pairing_code.ts";
import { getUserFromRequest } from "../_shared/user_auth.ts";
import { sendBroadcast } from "../_shared/broadcast.ts";

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
    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

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

    // Look up device by pairing_code (include device UUID)
    const { data: device, error: deviceError } = await (supabase as any)
      .schema("display")
      .from("devices")
      .select("id, serial_number, user_approved_by, created_at")
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
    const { error: updateError } = await (supabase as any)
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

    // Create or update user_devices entry (include device_uuid)
    const { error: upsertError } = await (supabase as any)
      .schema("display")
      .from("user_devices")
      .upsert(
        {
          user_id: user.id,
          serial_number: device.serial_number,
          device_uuid: device.id,
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

    // Update pairings.user_uuid
    const { error: pairingUpdateError } = await (supabase as any)
      .schema("display")
      .from("pairings")
      .update({
        user_uuid: user.id,
      })
      .eq("pairing_code", normalizedCode);

    if (pairingUpdateError) {
      console.error("Failed to update pairings.user_uuid:", pairingUpdateError);
      // Don't fail the request - device is already approved
      // Just log the error
    }

    // Broadcast user_assigned event to device channel
    try {
      await sendBroadcast(
        `device:${device.id}`,
        "user_assigned",
        {
          user_uuid: user.id,
          device_uuid: device.id,
          pairing_code: normalizedCode,
        },
      );
      console.log(`Broadcasted user_assigned event to device:${device.id}`);
    } catch (broadcastError) {
      console.error("Failed to broadcast user_assigned event:", broadcastError);
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
