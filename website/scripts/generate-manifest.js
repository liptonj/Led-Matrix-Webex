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

// Base URL for firmware hosted on the website (not GitHub)
// Files are downloaded by deploy workflow and placed in /updates/firmware/
const WEBSITE_FIRMWARE_BASE = 'https://display.5ls.us/updates/firmware';

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
    // Filter to only include OTA bundle files (firmware-ota-*.bin and bootstrap-ota-*.bin)
    const otaBundles = release.assets
        .filter(asset => {
            const name = asset.name.toLowerCase();
            return name.endsWith('.bin') && name.includes('ota');
        })
        .map(asset => ({
            name: asset.name,
            url: asset.browser_download_url,
            size: asset.size
        }));

    return {
        tag: release.tag_name,
        version: extractVersion(release.tag_name),
        name: release.name,
        build_id: extractBuildId(release),
        build_date: release.published_at,
        notes: release.body ? release.body.split('\n')[0] : '',
        prerelease: release.prerelease,
        bundles: otaBundles
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
 * @param {string} assetType - 'firmware', 'filesystem', or 'bundle'
 * @returns {string|null} - Asset download URL or null if not found
 */
function findAssetUrl(assets, boardType, assetType) {
    // Handle bundle type (LMWB format)
    if (assetType === 'bundle') {
        // Look for firmware-ota-{boardType}.bin pattern
        const patterns = [
            `firmware-ota-${boardType}.bin`,
            `firmware_ota_${boardType}.bin`,
            `firmware-ota_${boardType}.bin`,
        ];
        
        for (const pattern of patterns) {
            const asset = assets.find(a => {
                const name = a.name.toLowerCase();
                // Skip bootstrap bundles
                if (name.includes('bootstrap')) {
                    return false;
                }
                return name === pattern.toLowerCase();
            });
            if (asset) {
                return asset.browser_download_url;
            }
        }
        
        // Fallback: partial match for OTA bundle files
        for (const asset of assets) {
            const name = asset.name.toLowerCase();
            if (name.includes('bootstrap')) {
                continue;
            }
            if (!name.endsWith('.bin')) {
                continue;
            }
            
            // Must contain both 'firmware' and 'ota'
            if (!name.includes('firmware') || !name.includes('ota')) {
                continue;
            }
            
            // Check board type match
            if (boardType === 'esp32s3') {
                if (name.includes('esp32s3') || name.includes('esp32-s3')) {
                    return asset.browser_download_url;
                }
            } else if (boardType === 'esp32') {
                if (name.includes('esp32') && 
                    !name.includes('esp32s3') && 
                    !name.includes('esp32-s3')) {
                    return asset.browser_download_url;
                }
            }
        }
        
        return null;
    }
    
    // Define search patterns in priority order for firmware/filesystem
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
            // Skip bootstrap and OTA bundle files for firmware/filesystem
            if (name.includes('bootstrap')) {
                return false;
            }
            // Skip OTA bundles when looking for plain firmware
            if (assetType === 'firmware' && name.includes('ota')) {
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
        if (name.includes('bootstrap')) {
            continue;
        }
        if (!name.endsWith('.bin')) {
            continue;
        }
        // Skip OTA bundles when looking for plain firmware
        if (assetType === 'firmware' && name.includes('ota')) {
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
        return Math.floor(new Date(release.published_at).getTime() / 1000).toString();
    }
    return 'unknown';
}

/**
 * Build OTA-compatible bundle structure with local URLs
 * Uses firmware hosted on the website (downloaded from GitHub during deploy)
 */
function buildOtaStructure(latestRelease) {
    if (!latestRelease || !latestRelease.assets) {
        return { bundle: {} };
    }

    const boardTypes = ['esp32', 'esp32s3'];
    const bundle = {};

    for (const boardType of boardTypes) {
        // Check if the bundle exists in the release
        const githubUrl = findAssetUrl(latestRelease.assets, boardType, 'bundle');

        if (githubUrl) {
            // Use local URL instead of GitHub URL
            // Files are downloaded to /updates/firmware/ during deploy
            bundle[boardType] = { 
                url: `${WEBSITE_FIRMWARE_BASE}/firmware-ota-${boardType}.bin`
            };
        }
    }

    return { bundle };
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
        const { bundle } = buildOtaStructure(latestRelease);
        
        // Extract build metadata from latest release
        const buildId = latestRelease ? extractBuildId(latestRelease) : 'unknown';
        const buildDate = latestRelease?.published_at || new Date().toISOString();
        
        // Create manifest with OTA fields and versions array
        const manifest = {
            // OTA-compatible fields (for firmware checkUpdateFromManifest)
            version: version,
            build_id: buildId,
            build_date: buildDate,
            bundle: bundle,  // LMWB bundle files (firmware + filesystem combined)
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
        console.log(`  Build ID: ${manifest.build_id}`);
        console.log(`  Build date: ${manifest.build_date}`);
        console.log(`  Bundle URLs:`);
        for (const [board, data] of Object.entries(bundle)) {
            console.log(`    ${board}: ${data.url ? '✓' : '✗ missing'}`);
        }
        console.log(`  Total versions: ${manifest.versions.length}`);
        
    } catch (error) {
        console.error('Failed to generate manifest:', error.message);
        process.exit(1);
    }
}

generateManifest();
