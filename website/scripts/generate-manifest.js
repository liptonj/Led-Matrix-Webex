#!/usr/bin/env node

/**
 * Generate firmware version manifest from GitHub releases
 * This script fetches release information and creates manifest.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com/repos/liptonj/Led-Matrix-Webex/releases';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN;
const OUTPUT_FILE = path.join(__dirname, '../public/updates/manifest.json');

function fetchReleases() {
    return new Promise((resolve, reject) => {
        const headers = {
            'User-Agent': 'LED-Matrix-Webex-Website',
            'Accept': 'application/vnd.github.v3+json'
        };

        if (GITHUB_TOKEN) {
            headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
        }

        const options = {
            headers: {
                ...headers
            }
        };

        https.get(GITHUB_API, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

function transformRelease(release) {
    return {
        tag: release.tag_name,
        name: release.name,
        published: release.published_at,
        notes: release.body ? release.body.split('\n')[0] : '',
        prerelease: release.prerelease,
        assets: release.assets.map(asset => ({
            name: asset.name,
            url: asset.browser_download_url,
            size: asset.size
        }))
    };
}

/**
 * Extract version string from tag (strips 'v' prefix if present)
 */
function extractVersion(tag) {
    if (!tag) return null;
    return tag.startsWith('v') || tag.startsWith('V') ? tag.substring(1) : tag;
}

/**
 * Find asset URL for a specific board type and asset type
 * @param {Array} assets - Release assets array
 * @param {string} boardType - 'esp32' or 'esp32s3'
 * @param {string} assetType - 'firmware' or 'filesystem'
 * @returns {string|null} - Asset download URL or null if not found
 */
function findAssetUrl(assets, boardType, assetType) {
    // Define search patterns in priority order
    const patterns = assetType === 'firmware'
        ? [
            // Board-specific patterns (highest priority)
            `firmware_${boardType}.bin`,
            `firmware-${boardType}.bin`,
            `firmware_${boardType.replace('esp32', 'esp32-')}.bin`,
            // Generic fallback (lowest priority)
            'firmware.bin'
          ]
        : [
            // Board-specific patterns (highest priority)
            `littlefs_${boardType}.bin`,
            `littlefs-${boardType}.bin`,
            `littlefs_${boardType.replace('esp32', 'esp32-')}.bin`,
            // Generic fallback (lowest priority)
            'littlefs.bin'
          ];

    for (const pattern of patterns) {
        const asset = assets.find(a => {
            const name = a.name.toLowerCase();
            // Skip bootstrap and OTA bundle files
            if (name.includes('bootstrap') || name.includes('ota_bundle')) {
                return false;
            }
            return name === pattern.toLowerCase();
        });
        if (asset) {
            return asset.browser_download_url;
        }
    }

    // Fallback: partial match for board-specific files
    for (const asset of assets) {
        const name = asset.name.toLowerCase();
        if (name.includes('bootstrap') || name.includes('ota_bundle')) {
            continue;
        }
        if (!name.endsWith('.bin')) {
            continue;
        }

        const isFirmware = assetType === 'firmware' && name.includes('firmware');
        const isFilesystem = assetType === 'filesystem' && 
            (name.includes('littlefs') || name.includes('spiffs'));

        if (isFirmware || isFilesystem) {
            // Check board type match
            if (boardType === 'esp32s3') {
                if (name.includes('esp32s3') || name.includes('esp32-s3')) {
                    return asset.browser_download_url;
                }
            } else if (boardType === 'esp32') {
                // Match esp32 but NOT esp32s3
                if (name.includes('esp32') && 
                    !name.includes('esp32s3') && 
                    !name.includes('esp32-s3')) {
                    return asset.browser_download_url;
                }
            }
        }
    }

    return null;
}

/**
 * Build OTA-compatible firmware/filesystem structure from latest release
 */
function buildOtaStructure(latestRelease) {
    if (!latestRelease || !latestRelease.assets) {
        return { firmware: {}, filesystem: {} };
    }

    const boardTypes = ['esp32', 'esp32s3'];
    const firmware = {};
    const filesystem = {};

    for (const boardType of boardTypes) {
        const firmwareUrl = findAssetUrl(latestRelease.assets, boardType, 'firmware');
        const filesystemUrl = findAssetUrl(latestRelease.assets, boardType, 'filesystem');

        if (firmwareUrl) {
            firmware[boardType] = { url: firmwareUrl };
        }
        if (filesystemUrl) {
            filesystem[boardType] = { url: filesystemUrl };
        }
    }

    return { firmware, filesystem };
}

async function generateManifest() {
    try {
        console.log('Fetching releases from GitHub...');
        const releases = await fetchReleases();
        
        console.log(`Found ${releases.length} releases`);

        // Get latest non-prerelease, or fall back to latest release
        const latestRelease = releases.find(r => !r.prerelease) || releases[0];
        const latestTag = latestRelease ? latestRelease.tag_name : null;
        const version = extractVersion(latestTag);

        // Build OTA-compatible structure from latest release
        const { firmware, filesystem } = buildOtaStructure(latestRelease);
        
        // Create manifest with both OTA fields and versions array
        const manifest = {
            // OTA-compatible fields (for firmware checkUpdateFromManifest)
            version: version,
            firmware: firmware,
            filesystem: filesystem,
            // Metadata
            generated: new Date().toISOString(),
            latest: latestTag,
            // Full versions list (for website display)
            versions: releases.map(transformRelease)
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
        console.log(`  Firmware URLs:`);
        for (const [board, data] of Object.entries(firmware)) {
            console.log(`    ${board}: ${data.url ? '✓' : '✗ missing'}`);
        }
        console.log(`  Filesystem URLs:`);
        for (const [board, data] of Object.entries(filesystem)) {
            console.log(`    ${board}: ${data.url ? '✓' : '✗ missing'}`);
        }
        console.log(`  Total versions: ${manifest.versions.length}`);
        
    } catch (error) {
        console.error('Failed to generate manifest:', error.message);
        process.exit(1);
    }
}

generateManifest();
