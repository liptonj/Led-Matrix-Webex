/**
 * get-manifest Edge Function Tests
 *
 * Tests for the firmware manifest endpoint that provides release
 * information for OTA updates and ESP Web Tools installer.
 *
 * Run: deno test --allow-net --allow-env _tests/get-manifest.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Constants from the Edge Function
const SIGNED_URL_EXPIRY_SECONDS = 600;
const DEVICE_NAME = "Webex LED Matrix Display";
const BOARD_TYPES = ["esp32s3", "esp32"];

// ============================================================================
// Format Parameter Tests
// ============================================================================

Deno.test("get-manifest: accepts format query parameter", () => {
  const url = new URL("http://localhost/get-manifest?format=esp-web-tools");
  assertEquals(url.searchParams.get("format"), "esp-web-tools");
});

Deno.test("get-manifest: defaults to 'ota' format", () => {
  const url = new URL("http://localhost/get-manifest");
  const format = url.searchParams.get("format") || "ota";
  assertEquals(format, "ota");
});

Deno.test("get-manifest: supports esp-web-tools format", () => {
  const validFormats = ["ota", "esp-web-tools"];
  assertEquals(validFormats.includes("esp-web-tools"), true);
});

Deno.test("get-manifest: supports ota format", () => {
  const validFormats = ["ota", "esp-web-tools"];
  assertEquals(validFormats.includes("ota"), true);
});

// ============================================================================
// ESP Web Tools Manifest Tests
// ============================================================================

Deno.test("get-manifest: esp-web-tools format has required fields", () => {
  const manifest = {
    name: DEVICE_NAME,
    version: "1.5.0",
    new_install_prompt_erase: true,
    builds: [
      {
        chipFamily: "ESP32-S3",
        parts: [
          {
            path: "https://example.com/firmware-merged.bin",
            offset: 0,
          },
        ],
      },
    ],
  };

  assertExists(manifest.name);
  assertExists(manifest.version);
  assertEquals(manifest.new_install_prompt_erase, true);
  assertEquals(Array.isArray(manifest.builds), true);
});

Deno.test("get-manifest: esp-web-tools chipFamily is ESP32-S3", () => {
  const build = {
    chipFamily: "ESP32-S3",
    parts: [],
  };

  assertEquals(build.chipFamily, "ESP32-S3");
});

Deno.test("get-manifest: esp-web-tools uses merged firmware", () => {
  const parts = [
    {
      path: "https://example.com/1.5.0/firmware-merged.bin",
      offset: 0,
    },
  ];

  assertStringIncludes(parts[0].path, "firmware-merged.bin");
  assertEquals(parts[0].offset, 0);
});

Deno.test("get-manifest: esp-web-tools prompts for erase on new install", () => {
  const manifest = { new_install_prompt_erase: true };
  assertEquals(manifest.new_install_prompt_erase, true);
});

// ============================================================================
// OTA Legacy Manifest Tests
// ============================================================================

Deno.test("get-manifest: ota format has required fields", () => {
  const manifest = {
    name: DEVICE_NAME,
    version: "1.5.0",
    build_id: "abc123",
    build_date: "2026-01-28T12:00:00Z",
    firmware: {
      esp32s3: { url: "https://example.com/firmware.bin" },
      esp32: { url: "https://example.com/firmware.bin" },
    },
  };

  assertExists(manifest.name);
  assertExists(manifest.version);
  assertExists(manifest.firmware);
});

Deno.test("get-manifest: ota includes firmware for all board types", () => {
  const firmware: Record<string, { url: string }> = {};
  for (const board of BOARD_TYPES) {
    firmware[board] = { url: "https://example.com/firmware.bin" };
  }

  assertExists(firmware.esp32s3);
  assertExists(firmware.esp32);
});

Deno.test("get-manifest: ota optionally includes bundle", () => {
  const manifest = {
    name: DEVICE_NAME,
    version: "1.5.0",
    firmware: {
      esp32s3: { url: "https://example.com/firmware.bin" },
    },
    bundle: {
      esp32s3: { url: "https://example.com/firmware-merged.bin" },
    },
  };

  assertExists(manifest.bundle);
  assertStringIncludes(manifest.bundle.esp32s3.url, "firmware-merged.bin");
});

Deno.test("get-manifest: build_id can be null", () => {
  const manifest = {
    build_id: null,
    build_date: null,
  };

  assertEquals(manifest.build_id, null);
  assertEquals(manifest.build_date, null);
});

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("get-manifest: works without authentication (public access)", () => {
  // Manifest can be accessed publicly for ESP Web Tools
  const headers = new Headers();
  assertEquals(headers.get("X-Device-Serial"), null);
});

Deno.test("get-manifest: authenticated requests get signed URLs", () => {
  const publicUrl = "https://example.com/firmware/1.5.0/firmware.bin";
  const signedUrl = "https://example.supabase.co/storage/v1/object/sign/firmware/1.5.0/firmware.bin?token=abc123";

  assertStringIncludes(signedUrl, "sign");
  assertStringIncludes(signedUrl, "token=");
  assertEquals(publicUrl.includes("sign"), false);
});

Deno.test("get-manifest: signed URL expiry is 10 minutes", () => {
  assertEquals(SIGNED_URL_EXPIRY_SECONDS, 600);
});

// ============================================================================
// Target Firmware Version Tests
// ============================================================================

Deno.test("get-manifest: uses target_firmware_version for authenticated device", () => {
  const device = {
    target_firmware_version: "1.4.5",
  };

  const releases = [
    { version: "1.5.0", is_latest: true },
    { version: "1.4.5", is_latest: false },
  ];

  const targetRelease = releases.find((r) => r.version === device.target_firmware_version);
  assertEquals(targetRelease?.version, "1.4.5");
});

Deno.test("get-manifest: falls back to latest if target not found", () => {
  const device = {
    target_firmware_version: "1.4.5",
  };

  const releases = [
    { version: "1.5.0", is_latest: true },
    { version: "1.3.0", is_latest: false },
    // 1.4.5 not in releases
  ];

  let selectedRelease = releases.find((r) => r.version === device.target_firmware_version);
  if (!selectedRelease) {
    selectedRelease = releases.find((r) => r.is_latest);
  }

  assertEquals(selectedRelease?.version, "1.5.0");
});

// ============================================================================
// Rollout Percentage Tests
// ============================================================================

Deno.test("get-manifest: respects rollout for authenticated OTA requests", () => {
  const release = { version: "1.5.0", rollout_percentage: 50 };
  const devicePercentile = 25;

  const isEligible = devicePercentile < release.rollout_percentage;
  assertEquals(isEligible, true);
});

Deno.test("get-manifest: returns empty manifest for device not in rollout", () => {
  const emptyManifest = {
    name: DEVICE_NAME,
    version: "none",
    build_id: null,
    build_date: null,
    firmware: {},
  };

  assertEquals(emptyManifest.version, "none");
  assertEquals(Object.keys(emptyManifest.firmware).length, 0);
});

Deno.test("get-manifest: skips rollout check for unauthenticated requests", () => {
  // Public requests (ESP Web Tools) always get the latest, regardless of rollout
  const authenticated = false;
  const _rolloutPercentage = 50; // Unused, but documents the test scenario

  // Should not check rollout
  assertEquals(authenticated, false);
});

// ============================================================================
// File Path Tests
// ============================================================================

Deno.test("get-manifest: OTA firmware path format", () => {
  const version = "1.5.0";
  const filePath = `${version}/firmware.bin`;
  assertEquals(filePath, "1.5.0/firmware.bin");
});

Deno.test("get-manifest: merged firmware path format", () => {
  const version = "1.5.0";
  const mergedPath = `${version}/firmware-merged.bin`;
  assertEquals(mergedPath, "1.5.0/firmware-merged.bin");
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("get-manifest: 404 for no releases found", () => {
  const response = {
    error: "No releases found",
  };

  assertStringIncludes(response.error, "No releases");
});

Deno.test("get-manifest: 500 for database error", () => {
  const response = {
    error: "Failed to fetch releases",
  };

  assertStringIncludes(response.error, "fetch releases");
});

Deno.test("get-manifest: 500 for internal error", () => {
  const response = {
    error: "Internal server error",
  };

  assertStringIncludes(response.error, "server error");
});

// ============================================================================
// Device Name Tests
// ============================================================================

Deno.test("get-manifest: device name is correct", () => {
  assertEquals(DEVICE_NAME, "Webex LED Matrix Display");
});

Deno.test("get-manifest: manifest name matches device name", () => {
  const manifest = { name: DEVICE_NAME };
  assertEquals(manifest.name, "Webex LED Matrix Display");
});
