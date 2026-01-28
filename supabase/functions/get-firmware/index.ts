/**
 * Get Firmware Edge Function
 *
 * Authenticates a device via HMAC and returns a short-lived signed URL
 * for firmware download from Supabase Storage.
 *
 * Request headers:
 *   X-Device-Serial: 8-char CRC32 serial
 *   X-Timestamp: Unix timestamp (seconds)
 *   X-Signature: Base64-encoded HMAC-SHA256 signature
 *
 * Query parameters:
 *   version: Target firmware version (optional, uses target or latest if not specified)
 *
 * Response:
 * {
 *   "success": true,
 *   "version": "1.4.4",
 *   "download_url": "https://...signed-url..."
 * }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";
import { isDeviceInRollout } from "../_shared/rollout.ts";

const SIGNED_URL_EXPIRY_SECONDS = 600; // 10 minutes

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Validate HMAC signature
    const result = await validateHmacRequest(req, supabase, "");

    if (!result.valid) {
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Determine target version
    const url = new URL(req.url);
    let targetVersion = url.searchParams.get("version");

    if (!targetVersion && result.device?.target_firmware_version) {
      targetVersion = result.device.target_firmware_version;
    }

    // Get release info
    let releaseQuery = supabase
      .schema("display")
      .from("releases")
      .select("version, firmware_url, firmware_size, rollout_percentage");

    if (targetVersion) {
      releaseQuery = releaseQuery.eq("version", targetVersion);
    } else {
      releaseQuery = releaseQuery.eq("is_latest", true);
    }

    const { data: release, error: releaseError } = await releaseQuery.single();

    if (releaseError || !release) {
      return new Response(
        JSON.stringify({ success: false, error: "Release not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check rollout percentage
    const rolloutPercentage = release.rollout_percentage ?? 100;
    if (rolloutPercentage < 100) {
      const serialNumber = result.device?.serial_number || "";
      if (!isDeviceInRollout(serialNumber, release.version, rolloutPercentage)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Update not available for your device yet",
            rollout_percentage: rolloutPercentage,
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // Extract file path from storage URL
    // Expected format: firmware/{version}/firmware.bin
    const filePath = `${release.version}/firmware.bin`;

    // Generate signed URL
    const { data: signedUrl, error: urlError } = await supabase.storage
      .from("firmware")
      .createSignedUrl(filePath, SIGNED_URL_EXPIRY_SECONDS);

    if (urlError || !signedUrl) {
      console.error("Failed to generate signed URL:", urlError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to generate download URL",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        version: release.version,
        download_url: signedUrl.signedUrl,
        size: release.firmware_size,
        expires_in: SIGNED_URL_EXPIRY_SECONDS,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Get firmware error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
