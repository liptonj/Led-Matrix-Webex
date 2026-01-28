/**
 * Get Manifest Edge Function
 *
 * Returns the firmware manifest for OTA updates.
 * If called with valid HMAC authentication, returns signed URLs for downloads.
 * Otherwise, returns public manifest (for ESP Web Tools installer).
 *
 * Request headers (optional for authenticated access):
 *   X-Device-Serial: 8-char CRC32 serial
 *   X-Timestamp: Unix timestamp (seconds)
 *   X-Signature: Base64-encoded HMAC-SHA256 signature
 *
 * Query parameters:
 *   format: "esp-web-tools" for installer manifest, "ota" for OTA manifest (default)
 *
 * Response (OTA format):
 * {
 *   "name": "Webex LED Matrix Display",
 *   "builds": [
 *     {
 *       "chipFamily": "ESP32-S3",
 *       "version": "1.4.4",
 *       "parts": [{ "path": "...", "offset": 0 }]
 *     }
 *   ]
 * }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";
import { isDeviceInRollout } from "../_shared/rollout.ts";

const SIGNED_URL_EXPIRY_SECONDS = 600;
const DEVICE_NAME = "Webex LED Matrix Display";
const BOARD_TYPES = ["esp32s3", "esp32"] as const;

interface EspWebToolsManifest {
  name: string;
  version: string;
  new_install_prompt_erase: boolean;
  builds: {
    chipFamily: string;
    parts: { path: string; offset: number }[];
  }[];
}

interface LegacyManifest {
  name: string;
  version: string;
  build_id: string | null;
  build_date: string | null;
  firmware: Record<string, { url: string }>;
  bundle?: Record<string, { url: string }>;
}

interface ReleaseRow {
  version: string;
  firmware_url: string | null;
  firmware_merged_url: string | null;
  build_id: string | null;
  build_date: string | null;
  is_latest: boolean;
  is_prerelease: boolean;
  rollout_percentage: number;
}

function buildLegacyManifest(
  release: ReleaseRow,
  otaUrl: string,
  mergedUrl?: string,
): LegacyManifest {
  const firmware: Record<string, { url: string }> = {};
  const bundle: Record<string, { url: string }> = {};

  for (const board of BOARD_TYPES) {
    firmware[board] = { url: otaUrl };
    if (mergedUrl) {
      bundle[board] = { url: mergedUrl };
    }
  }

  const manifest: LegacyManifest = {
    name: DEVICE_NAME,
    version: release.version,
    build_id: release.build_id,
    build_date: release.build_date,
    firmware,
  };

  if (mergedUrl) {
    manifest.bundle = bundle;
  }

  return manifest;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "ota";

    // Check if request is authenticated
    let authenticated = false;
    let targetVersion: string | null = null;
    let deviceSerialNumber: string | null = null;
    const serialHeader = req.headers.get("X-Device-Serial");

    if (serialHeader) {
      const result = await validateHmacRequest(req, supabase, "");
      authenticated = result.valid;
      if (authenticated && result.device) {
        targetVersion = result.device.target_firmware_version;
        deviceSerialNumber = result.device.serial_number;
      }
    }

    // Get releases
    const { data: releases, error } = await supabase
      .schema("display")
      .from("releases")
      .select(
        "version, firmware_url, firmware_merged_url, build_id, build_date, is_latest, is_prerelease, rollout_percentage",
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch releases:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch releases" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (format === "esp-web-tools") {
      // ESP Web Tools installer manifest (uses latest release)
      const latestRelease = releases?.find((r) => r.is_latest) || releases?.[0];

      if (!latestRelease) {
        return new Response(JSON.stringify({ error: "No releases found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const firmwarePath = `${latestRelease.version}/firmware-merged.bin`;
      let firmwareUrl = latestRelease.firmware_merged_url || "";

      // Always provide a signed URL for web install
      const { data: signedUrl } = await supabase.storage
        .from("firmware")
        .createSignedUrl(firmwarePath, SIGNED_URL_EXPIRY_SECONDS);

      if (signedUrl) {
        firmwareUrl = signedUrl.signedUrl;
      }

      const manifest: EspWebToolsManifest = {
        name: DEVICE_NAME,
        version: latestRelease.version,
        new_install_prompt_erase: true,
        builds: [
          {
            chipFamily: "ESP32-S3",
            parts: [
              {
                path: firmwareUrl || "",
                offset: 0,
              },
            ],
          },
        ],
      };

      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // OTA legacy manifest format (firmware expects this shape)
    // If authenticated device has a target firmware version, use that instead of latest
    let selectedRelease: ReleaseRow | undefined;
    if (authenticated && targetVersion) {
      selectedRelease = releases?.find((r) => r.version === targetVersion);
      if (selectedRelease) {
        console.log(
          `Using target firmware ${targetVersion} for device ${deviceSerialNumber}`,
        );
      }
    }
    // Fall back to latest release
    if (!selectedRelease) {
      selectedRelease = releases?.find((r) => r.is_latest) || releases?.[0];
    }

    if (!selectedRelease) {
      return new Response(JSON.stringify({ error: "No releases found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check rollout percentage for authenticated OTA requests
    // If device is not in rollout, return empty manifest (no update available)
    const rolloutPercentage = selectedRelease.rollout_percentage ?? 100;
    if (authenticated && rolloutPercentage < 100 && deviceSerialNumber) {
      if (
        !isDeviceInRollout(
          deviceSerialNumber,
          selectedRelease.version,
          rolloutPercentage,
        )
      ) {
        console.log(
          `Device ${deviceSerialNumber} not in ${rolloutPercentage}% rollout for ${selectedRelease.version}`,
        );
        // Return empty manifest - device should not see any update
        const emptyManifest: LegacyManifest = {
          name: DEVICE_NAME,
          version: "none",
          build_id: null,
          build_date: null,
          firmware: {},
        };
        return new Response(JSON.stringify(emptyManifest), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let otaUrl = selectedRelease.firmware_url || "";
    const filePath = `${selectedRelease.version}/firmware.bin`;

    // Generate signed URL if authenticated
    if (authenticated) {
      const { data: signedUrl } = await supabase.storage
        .from("firmware")
        .createSignedUrl(filePath, SIGNED_URL_EXPIRY_SECONDS);

      if (signedUrl) {
        otaUrl = signedUrl.signedUrl;
      }
    }

    let mergedUrl = selectedRelease.firmware_merged_url || "";
    const mergedPath = `${selectedRelease.version}/firmware-merged.bin`;
    if (authenticated) {
      const { data: signedMerged } = await supabase.storage
        .from("firmware")
        .createSignedUrl(mergedPath, SIGNED_URL_EXPIRY_SECONDS);

      if (signedMerged) {
        mergedUrl = signedMerged.signedUrl;
      }
    }

    const legacy = buildLegacyManifest(
      selectedRelease,
      otaUrl,
      mergedUrl || undefined,
    );

    return new Response(JSON.stringify(legacy), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Get manifest error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
