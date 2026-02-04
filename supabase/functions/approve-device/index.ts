/**
 * Approve Device Edge Function
 *
 * Allows authenticated users to approve devices by serial number.
 * Updates devices table with user_approved_by and approved_at.
 * Creates entry in user_devices table.
 *
 * Request body:
 * {
 *   "serial_number": "A1B2C3D4"  // 8 hex characters
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

interface ApproveRequest {
  serial_number: string;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get user from Bearer token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing Bearer token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.slice(7);
    const userSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body: ApproveRequest = await req.json();
    const { serial_number } = body;

    if (!serial_number) {
      return new Response(
        JSON.stringify({ error: "Missing serial_number" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate serial number format (8 hex characters)
    if (!/^[A-Fa-f0-9]{8}$/.test(serial_number)) {
      return new Response(
        JSON.stringify({
          error: "Invalid serial_number format. Expected 8 hex characters.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const normalizedSerial = serial_number.toUpperCase();

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, serviceKey);

    // Check if device exists
    const { data: device, error: deviceError } = await supabase
      .schema("display")
      .from("devices")
      .select("serial_number, user_approved_by")
      .eq("serial_number", normalizedSerial)
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
      .eq("serial_number", normalizedSerial);

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
          serial_number: normalizedSerial,
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
