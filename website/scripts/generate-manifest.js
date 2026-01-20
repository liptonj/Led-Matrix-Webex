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

async function generateManifest() {
    try {
        console.log('Fetching releases from GitHub...');
        const releases = await fetchReleases();
        
        console.log(`Found ${releases.length} releases`);
        
        const manifest = {
            generated: new Date().toISOString(),
            latest: releases[0] ? releases[0].tag_name : null,
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
        console.log(`  Latest version: ${manifest.latest}`);
        console.log(`  Total versions: ${manifest.versions.length}`);
        
    } catch (error) {
        console.error('Failed to generate manifest:', error.message);
        process.exit(1);
    }
}

generateManifest();
