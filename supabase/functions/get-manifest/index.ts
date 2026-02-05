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
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";
import { isDeviceInRollout } from "../_shared/rollout.ts";

const SIGNED_URL_EXPIRY_SECONDS = 600;
const DEVICE_NAME = "Webex LED Matrix Display";

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
  id: string;
  version: string;
  firmware_url: string | null;
  firmware_merged_url: string | null;
  build_id: string | null;
  build_date: string | null;
  is_latest: boolean;
  is_prerelease: boolean;
  rollout_percentage: number;
  release_channel: string;
}

interface ReleaseArtifact {
  board_type: string;
  chip_family: string;
  firmware_url: string;
  firmware_merged_url: string | null;
  firmware_size: number | null;
}

// Supabase client type is complex - using explicit any with lint ignore
// deno-lint-ignore no-explicit-any
async function buildLegacyManifest(
  release: ReleaseRow,
  supabase: any, // deno-lint-ignore-line
  authenticated: boolean,
): Promise<LegacyManifest> {
  const firmware: Record<string, { url: string }> = {};
  const bundle: Record<string, { url: string }> = {};

  // Fetch board-specific artifacts from database
  const { data: artifacts, error } = await supabase
    .schema("display")
    .from("release_artifacts")
    .select("board_type, chip_family, firmware_url, firmware_merged_url, firmware_size")
    .eq("release_id", release.id);

  if (error) {
    console.error("Failed to fetch release artifacts:", error);
    // Fallback to empty firmware object
    return {
      name: DEVICE_NAME,
      version: release.version,
      build_id: release.build_id,
      build_date: release.build_date,
      firmware: {},
    };
  }

  // Generate signed URLs for each board if authenticated
  for (const artifact of (artifacts as ReleaseArtifact[] || [])) {
    const boardOtaPath = `${release.version}/firmware-${artifact.board_type}.bin`;
    const boardMergedPath = `${release.version}/firmware-merged-${artifact.board_type}.bin`;

    let otaUrl = artifact.firmware_url;
    let mergedUrl = artifact.firmware_merged_url || "";

    if (authenticated) {
      // Generate signed URLs
      const { data: signedOta } = await supabase.storage
        .from("firmware")
        .createSignedUrl(boardOtaPath, SIGNED_URL_EXPIRY_SECONDS);

      if (signedOta) {
        otaUrl = signedOta.signedUrl;
      }

      if (artifact.firmware_merged_url) {
        const { data: signedMerged } = await supabase.storage
          .from("firmware")
          .createSignedUrl(boardMergedPath, SIGNED_URL_EXPIRY_SECONDS);

        if (signedMerged) {
          mergedUrl = signedMerged.signedUrl;
        }
      }
    }

    firmware[artifact.board_type] = { url: otaUrl };
    if (mergedUrl) {
      bundle[artifact.board_type] = { url: mergedUrl };
    }
  }

  const manifest: LegacyManifest = {
    name: DEVICE_NAME,
    version: release.version,
    build_id: release.build_id,
    build_date: release.build_date,
    firmware,
  };

  if (Object.keys(bundle).length > 0) {
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

    // Get device's release channel (defaults to 'production')
    let deviceChannel = 'production';
    if (authenticated && deviceSerialNumber) {
      const { data: deviceRecord } = await supabase
        .schema("display")
        .from("devices")
        .select("release_channel")
        .eq("serial_number", deviceSerialNumber)
        .single();
      
      if (deviceRecord?.release_channel) {
        deviceChannel = deviceRecord.release_channel;
      }
    }

    // Get releases
    const { data: releases, error } = await supabase
      .schema("display")
      .from("releases")
      .select(
        "id, version, firmware_url, firmware_merged_url, build_id, build_date, is_latest, is_prerelease, rollout_percentage, release_channel",
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

      // Fetch all board artifacts for this release
      const { data: artifacts, error: artifactsError } = await supabase
        .schema("display")
        .from("release_artifacts")
        .select("board_type, chip_family, firmware_merged_url")
        .eq("release_id", latestRelease.id);

      if (artifactsError) {
        console.error("Failed to fetch artifacts for ESP Web Tools:", artifactsError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch firmware artifacts" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Generate builds array with signed URLs for each board
      const builds = [];
      for (const artifact of (artifacts as ReleaseArtifact[] || [])) {
        if (!artifact.firmware_merged_url) {
          continue; // Skip if no merged firmware available
        }

        const mergedPath = `${latestRelease.version}/firmware-merged-${artifact.board_type}.bin`;
        
        // Always provide signed URL for web install
        const { data: signedUrl } = await supabase.storage
          .from("firmware")
          .createSignedUrl(mergedPath, SIGNED_URL_EXPIRY_SECONDS);

        if (signedUrl) {
          builds.push({
            chipFamily: artifact.chip_family,
            parts: [
              {
                path: signedUrl.signedUrl,
                offset: 0,
              },
            ],
          });
        }
      }

      if (builds.length === 0) {
        return new Response(
          JSON.stringify({ error: "No firmware builds available" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const manifest: EspWebToolsManifest = {
        name: DEVICE_NAME,
        version: latestRelease.version,
        new_install_prompt_erase: true,
        builds,
      };

      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // OTA legacy manifest format (firmware expects this shape)
    // Filter releases to device's channel
    const channelReleases = (releases as ReleaseRow[] | undefined)?.filter(
      (r) => r.release_channel === deviceChannel
    ) || [];

    // If authenticated device has a target firmware version, use that
    let selectedRelease: ReleaseRow | undefined;
    if (authenticated && targetVersion) {
      selectedRelease = channelReleases.find((r) => r.version === targetVersion);
      if (selectedRelease) {
        console.log(
          `Using target firmware ${targetVersion} for device ${deviceSerialNumber} (channel: ${deviceChannel})`,
        );
      }
    }
    // Fall back to latest release for this channel
    if (!selectedRelease) {
      selectedRelease = channelReleases.find((r) => r.is_latest) || channelReleases[0];
    }

    console.log(`Device ${deviceSerialNumber || 'anonymous'} channel: ${deviceChannel}, selected release: ${selectedRelease?.version || 'none'}`);

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

    // Build manifest using database artifacts
    const legacy = await buildLegacyManifest(
      selectedRelease,
      supabase,
      authenticated,
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
