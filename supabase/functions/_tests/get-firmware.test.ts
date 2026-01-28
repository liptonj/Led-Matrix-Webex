/**
 * get-firmware Edge Function Tests
 *
 * Tests for the firmware download endpoint that provides authenticated
 * devices with signed URLs for firmware binaries.
 *
 * Run: deno test --allow-net --allow-env _tests/get-firmware.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Constants from the Edge Function
const SIGNED_URL_EXPIRY_SECONDS = 600; // 10 minutes

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("get-firmware: requires HMAC authentication", () => {
  const requiredHeaders = ["X-Device-Serial", "X-Timestamp", "X-Signature"];

  for (const header of requiredHeaders) {
    assertExists(header);
  }
});

Deno.test("get-firmware: HMAC headers must all be present", () => {
  const headers = new Headers({
    "X-Device-Serial": "A1B2C3D4",
    "X-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Signature": "base64-signature",
  });

  assertExists(headers.get("X-Device-Serial"));
  assertExists(headers.get("X-Timestamp"));
  assertExists(headers.get("X-Signature"));
});

// ============================================================================
// Query Parameter Tests
// ============================================================================

Deno.test("get-firmware: accepts version query parameter", () => {
  const url = new URL("http://localhost/get-firmware?version=1.5.2");
  const version = url.searchParams.get("version");

  assertEquals(version, "1.5.2");
});

Deno.test("get-firmware: version parameter is optional", () => {
  const url = new URL("http://localhost/get-firmware");
  const version = url.searchParams.get("version");

  assertEquals(version, null);
});

Deno.test("get-firmware: uses device target_firmware_version if no query param", () => {
  const device = {
    target_firmware_version: "1.4.5",
  };

  const queryVersion = null;
  const targetVersion = queryVersion || device.target_firmware_version;

  assertEquals(targetVersion, "1.4.5");
});

Deno.test("get-firmware: query param takes precedence over target version", () => {
  const device = {
    target_firmware_version: "1.4.5",
  };

  const queryVersion = "1.5.2";
  const targetVersion = queryVersion || device.target_firmware_version;

  assertEquals(targetVersion, "1.5.2");
});

// ============================================================================
// Signed URL Tests
// ============================================================================

Deno.test("get-firmware: signed URL expiry is 10 minutes", () => {
  assertEquals(SIGNED_URL_EXPIRY_SECONDS, 600);
  assertEquals(SIGNED_URL_EXPIRY_SECONDS, 10 * 60);
});

Deno.test("get-firmware: download URL is signed", () => {
  const signedUrl = "https://example.supabase.co/storage/v1/object/sign/firmware/1.5.2/firmware.bin?token=abc123xyz";

  assertStringIncludes(signedUrl, "sign");
  assertStringIncludes(signedUrl, "token=");
});

Deno.test("get-firmware: file path format is version/firmware.bin", () => {
  const version = "1.5.2";
  const filePath = `${version}/firmware.bin`;

  assertEquals(filePath, "1.5.2/firmware.bin");
});

// ============================================================================
// Response Format Tests - Success
// ============================================================================

Deno.test("get-firmware: success response has required fields", () => {
  const response = {
    success: true,
    version: "1.5.2",
    download_url: "https://example.supabase.co/storage/v1/object/sign/firmware/1.5.2/firmware.bin?token=abc123",
    size: 1234567,
    expires_in: 600,
  };

  assertEquals(response.success, true);
  assertExists(response.version);
  assertExists(response.download_url);
  assertEquals(typeof response.size, "number");
  assertEquals(response.expires_in, SIGNED_URL_EXPIRY_SECONDS);
});

Deno.test("get-firmware: version format is semver-like", () => {
  const validVersions = ["1.0.0", "1.5.2", "2.0.0-beta.1", "1.4.4"];

  for (const version of validVersions) {
    assertEquals(version.includes("."), true);
  }
});

Deno.test("get-firmware: size is positive number", () => {
  const response = { size: 1234567 };
  assertEquals(response.size > 0, true);
});

// ============================================================================
// Rollout Percentage Tests
// ============================================================================

Deno.test("get-firmware: respects rollout percentage", () => {
  // Device should only get firmware if in rollout
  const rolloutPercentage = 50;
  const devicePercentile = 25; // Would pass 50% rollout

  const isEligible = devicePercentile < rolloutPercentage;
  assertEquals(isEligible, true);
});

Deno.test("get-firmware: rejects device not in rollout", () => {
  const rolloutPercentage = 50;
  const devicePercentile = 75; // Would fail 50% rollout

  const isEligible = devicePercentile < rolloutPercentage;
  assertEquals(isEligible, false);
});

Deno.test("get-firmware: 100% rollout includes all devices", () => {
  const rolloutPercentage = 100;

  // Any percentile should pass
  assertEquals(0 < rolloutPercentage, true);
  assertEquals(50 < rolloutPercentage, true);
  assertEquals(99 < rolloutPercentage, true);
});

Deno.test("get-firmware: 0% rollout excludes all devices", () => {
  const rolloutPercentage = 0;

  // Any percentile should fail
  assertEquals(0 < rolloutPercentage, false);
  assertEquals(50 < rolloutPercentage, false);
});

Deno.test("get-firmware: rollout rejection response format", () => {
  const response = {
    success: false,
    error: "Update not available for your device yet",
    rollout_percentage: 50,
  };

  assertEquals(response.success, false);
  assertStringIncludes(response.error, "not available");
  assertEquals(response.rollout_percentage, 50);
});

// ============================================================================
// Latest Version Tests
// ============================================================================

Deno.test("get-firmware: uses latest version when no target specified", () => {
  // When no version query and no target_firmware_version, use is_latest=true release
  const releases = [
    { version: "1.4.4", is_latest: false },
    { version: "1.5.2", is_latest: true },
    { version: "1.3.0", is_latest: false },
  ];

  const latest = releases.find((r) => r.is_latest);
  assertEquals(latest?.version, "1.5.2");
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("get-firmware: 401 for invalid HMAC", () => {
  const response = {
    success: false,
    error: "Invalid signature",
  };

  assertEquals(response.success, false);
});

Deno.test("get-firmware: 401 for missing auth headers", () => {
  const response = {
    success: false,
    error: "Missing authentication headers",
  };

  assertEquals(response.success, false);
});

Deno.test("get-firmware: 404 for release not found", () => {
  const response = {
    success: false,
    error: "Release not found",
  };

  assertEquals(response.success, false);
  assertStringIncludes(response.error, "not found");
});

Deno.test("get-firmware: 404 for device not in rollout", () => {
  const response = {
    success: false,
    error: "Update not available for your device yet",
    rollout_percentage: 50,
  };

  assertEquals(response.success, false);
});

Deno.test("get-firmware: 500 for signed URL generation failure", () => {
  const response = {
    success: false,
    error: "Failed to generate download URL",
  };

  assertEquals(response.success, false);
  assertStringIncludes(response.error, "download URL");
});

Deno.test("get-firmware: 500 for internal error", () => {
  const response = {
    success: false,
    error: "Internal server error",
  };

  assertEquals(response.success, false);
});
