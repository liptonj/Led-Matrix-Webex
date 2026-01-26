#!/usr/bin/env node

/**
 * Generate firmware version manifest from GitHub releases
 * This script fetches release information and creates manifest.json
 *
 * Note: Web assets are now embedded in firmware. OTA updates only download
 * firmware.bin - no more LMWB bundles or separate LittleFS downloads.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const GITHUB_API =
  "https://api.github.com/repos/liptonj/Led-Matrix-Webex/releases";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN;
// Output to public folder (Next.js copies this to out/ during build)
const OUTPUT_FILE = path.join(__dirname, "../public/updates/manifest.json");

// Base URL for firmware hosted on the website (not GitHub)
// Files are downloaded by deploy workflow and placed in /updates/firmware/
const WEBSITE_FIRMWARE_BASE = "https://display.5ls.us/updates/firmware";

function fetchReleases() {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "LED-Matrix-Webex-Website",
      Accept: "application/vnd.github.v3+json",
    };

    if (GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }

    const options = {
      headers: {
        ...headers,
      },
    };

    https
      .get(GITHUB_API, options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

function transformRelease(release) {
  // Filter to firmware binary files (web assets now embedded in firmware)
  const firmwareFiles = release.assets
    .filter((asset) => {
      const name = asset.name.toLowerCase();
      return (
        name.endsWith(".bin") &&
        name.includes("firmware") &&
        !name.includes("bootstrap")
      );
    })
    .map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
    }));

  return {
    tag: release.tag_name,
    version: extractVersion(release.tag_name),
    name: release.name,
    build_id: extractBuildId(release),
    build_date: release.published_at,
    notes: release.body ? release.body.split("\n")[0] : "",
    prerelease: release.prerelease,
    firmware: firmwareFiles, // Renamed from bundles - now firmware-only
  };
}

/**
 * Extract version string from tag (strips 'v' prefix if present)
 */
function extractVersion(tag) {
  if (!tag) return null;
  return tag.startsWith("v") || tag.startsWith("V") ? tag.substring(1) : tag;
}

/**
 * Find asset URL for a specific board type
 * @param {Array} assets - Release assets array
 * @param {string} boardType - 'esp32s3' (only supported board now)
 * @returns {string|null} - Asset download URL or null if not found
 */
function findFirmwareUrl(assets, boardType) {
  // Look for firmware-{boardType}.bin pattern (web assets now embedded)
  const patterns = [
    `firmware-${boardType}.bin`,
    `firmware_${boardType}.bin`,
    // Legacy: also check for OTA bundles for backwards compatibility
    `firmware-ota-${boardType}.bin`,
    `firmware_ota_${boardType}.bin`,
  ];

  for (const pattern of patterns) {
    const asset = assets.find((a) => {
      const name = a.name.toLowerCase();
      // Skip bootstrap files
      if (name.includes("bootstrap")) {
        return false;
      }
      // Skip merged files (used for web installer, not OTA)
      if (name.includes("merged")) {
        return false;
      }
      return name === pattern.toLowerCase();
    });
    if (asset) {
      return asset.browser_download_url;
    }
  }

  // Fallback: partial match for board-specific firmware files
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    if (name.includes("bootstrap") || name.includes("merged")) {
      continue;
    }
    if (!name.endsWith(".bin") || !name.includes("firmware")) {
      continue;
    }

    // Check board type match
    if (boardType === "esp32s3") {
      if (name.includes("esp32s3") || name.includes("esp32-s3")) {
        return asset.browser_download_url;
      }
    }
  }

  return null;
}

/**
 * Extract build_id from release - uses target_commitish (git SHA) as unique identifier
 * @param {object} release - GitHub release object
 * @returns {string} - Build ID (commit SHA or timestamp-based fallback)
 */
function extractBuildId(release) {
  // Prefer target_commitish (the commit SHA the release was created from)
  if (release.target_commitish && release.target_commitish.length >= 7) {
    return release.target_commitish.substring(0, 7);
  }
  // Fallback: use published timestamp as epoch
  if (release.published_at) {
    return Math.floor(
      new Date(release.published_at).getTime() / 1000,
    ).toString();
  }
  return "unknown";
}

/**
 * Build OTA-compatible firmware structure with local URLs
 * Uses firmware hosted on the website (downloaded from GitHub during deploy)
 *
 * Note: Web assets are now embedded in firmware. Only firmware.bin is needed for OTA.
 * The "bundle" key is kept for backwards compatibility with older firmware versions.
 * 
 * Uses BUILD_ID in filename for cache busting to prevent CDN from serving stale firmware.
 */
function buildOtaStructure(latestRelease) {
  if (!latestRelease || !latestRelease.assets) {
    return { firmware: {}, bundle: {} };
  }

  // Only ESP32-S3 is supported (4MB ESP32 dropped)
  const boardTypes = ["esp32s3"];
  const firmware = {};
  const bundle = {}; // Legacy key for backwards compatibility
  
  // Use BUILD_ID for cache busting (set by deploy workflow, or use current timestamp)
  const buildId = process.env.BUILD_ID || Math.floor(Date.now() / 1000).toString();

  for (const boardType of boardTypes) {
    // Check if the firmware exists in the release
    const githubUrl = findFirmwareUrl(latestRelease.assets, boardType);

    if (githubUrl) {
      // Use versioned URL with build ID for cache busting
      // Files are downloaded to /updates/firmware/ during deploy with BUILD_ID suffix
      firmware[boardType] = {
        url: `${WEBSITE_FIRMWARE_BASE}/firmware-${boardType}-${buildId}.bin`,
      };
      // Also provide as bundle for backwards compatibility with older firmware
      bundle[boardType] = {
        url: `${WEBSITE_FIRMWARE_BASE}/firmware-${boardType}-${buildId}.bin`,
      };
    }
  }

  return { firmware, bundle };
}

async function generateManifest() {
  try {
    console.log("Fetching releases from GitHub...");
    const releases = await fetchReleases();

    console.log(`Found ${releases.length} releases`);

    // Get latest non-prerelease, or fall back to latest release
    const latestRelease = releases.find((r) => !r.prerelease) || releases[0];
    const latestTag = latestRelease ? latestRelease.tag_name : null;
    const version = extractVersion(latestTag);

    // Build OTA-compatible structure from latest release
    const { firmware, bundle } = buildOtaStructure(latestRelease);

    // Extract build metadata from latest release
    const buildId = latestRelease ? extractBuildId(latestRelease) : "unknown";
    const buildDate = latestRelease?.published_at || new Date().toISOString();

    // Create manifest with OTA fields and versions array
    const manifest = {
      // OTA-compatible fields (for firmware checkUpdateFromManifest)
      version: version,
      build_id: buildId,
      build_date: buildDate,
      firmware: firmware, // New: firmware-only (web assets embedded)
      bundle: bundle, // Legacy: kept for backwards compatibility
      // Metadata
      generated: new Date().toISOString(),
      latest: latestTag,
      // Full versions list (for website display)
      versions: releases.map(transformRelease),
    };

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write manifest file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));

    console.log(`✓ Manifest generated: ${OUTPUT_FILE}`);
    console.log(`  Latest version: ${manifest.version}`);
    console.log(`  Build ID: ${manifest.build_id}`);
    console.log(`  Build date: ${manifest.build_date}`);
    console.log(`  Firmware URLs (web assets embedded):`);
    for (const [board, data] of Object.entries(firmware)) {
      console.log(`    ${board}: ${data.url ? "✓" : "✗ missing"}`);
    }
    console.log(`  Total versions: ${manifest.versions.length}`);

    // Update ESP Web Tools manifests for web installer
    // Use build ID (epoch timestamp) for cache busting - unique per deployment
    // CI creates files like firmware-merged-esp32s3-1769453306.bin
    
    // Use environment variable BUILD_ID if set (from CI), otherwise use current timestamp
    const deployBuildId = process.env.BUILD_ID || Math.floor(Date.now() / 1000).toString();
    
    // 1. Fresh install manifest - full firmware with bootloader
    const freshInstallManifest = {
      name: "LED Matrix Webex Display",
      version: version,
      home_assistant_domain: "webex_display",
      improv: true,
      builds: [
        {
          chipFamily: "ESP32-S3",
          parts: [
            {
              path: `/updates/firmware/firmware-merged-esp32s3-${deployBuildId}.bin`,
              offset: 0
            }
          ]
        }
      ]
    };

    // 2. Update manifest - app only at ota_0 offset
    // Note: This still erases flash but only writes to app partition
    const updateManifest = {
      name: "LED Matrix Webex Display (Update)",
      version: version,
      home_assistant_domain: "webex_display",
      improv: true,
      builds: [
        {
          chipFamily: "ESP32-S3",
          parts: [
            {
              path: `/updates/firmware/firmware-esp32s3-${deployBuildId}.bin`,
              offset: 65536  // 0x10000 - ota_0 partition start
            }
          ]
        }
      ]
    };
    
    console.log(`  Build ID for cache busting: ${deployBuildId}`);

    const freshManifestFile = path.join(outputDir, "manifest-firmware-esp32s3.json");
    const updateManifestFile = path.join(outputDir, "manifest-firmware-update.json");
    
    fs.writeFileSync(freshManifestFile, JSON.stringify(freshInstallManifest, null, 2));
    fs.writeFileSync(updateManifestFile, JSON.stringify(updateManifest, null, 2));
    
    console.log(`✓ ESP Web Tools fresh install manifest: ${freshManifestFile}`);
    console.log(`✓ ESP Web Tools update manifest: ${updateManifestFile}`);
  } catch (error) {
    console.error("Failed to generate manifest:", error.message);
    process.exit(1);
  }
}

generateManifest();
