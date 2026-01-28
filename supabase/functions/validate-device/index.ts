/**
 * Validate Device Edge Function
 *
 * Used by the bridge server to validate HMAC-signed device requests.
 * This function verifies the signature and returns device info.
 *
 * Request headers:
 *   X-Device-Serial: 8-char CRC32 serial
 *   X-Timestamp: Unix timestamp (seconds)
 *   X-Signature: Base64-encoded HMAC-SHA256 signature
 *
 * Response:
 * {
 *   "valid": true,
 *   "device": {
 *     "serial_number": "A1B2C3D4",
 *     "device_id": "webex-display-C3D4",
 *     "pairing_code": "ABC123",
 *     "debug_enabled": false
 *   }
 * }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Get body for signature validation
    const body = await req.text();

    // Validate HMAC signature
    const result = await validateHmacRequest(req, supabase, body);

    if (!result.valid) {
      return new Response(
        JSON.stringify({ valid: false, error: result.error }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Mark device as provisioned if not already
    await supabase
      .schema("display")
      .from("devices")
      .update({
        is_provisioned: true,
        provisioned_at: new Date().toISOString(),
      })
      .eq("serial_number", result.device!.serial_number)
      .eq("is_provisioned", false);

    return new Response(
      JSON.stringify({
        valid: true,
        device: result.device,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Validate device error:", err);
    return new Response(
      JSON.stringify({ valid: false, error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
