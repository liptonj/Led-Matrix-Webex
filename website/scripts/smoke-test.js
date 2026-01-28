#!/usr/bin/env node

/**
 * Smoke tests for the Next.js static export
 * Verifies that core pages and assets were generated correctly
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out');

// Required pages (directories with index.html)
const REQUIRED_PAGES = [
  '',           // Root index.html
  'hardware',
  'install',
  'versions',
  'api-docs',
  'troubleshooting',
  'embedded',
  '404',
];

// Required static assets
const REQUIRED_ASSETS = [
  'favicon.ico',
  'icon-192.png',
  'icon-512.png',
  'manifest.json',
  '_headers',
];

// Required Next.js output
const REQUIRED_NEXT = [
  '_next',  // Next.js assets directory
];

let errors = 0;
let warnings = 0;

function log(message, type = 'info') {
  const prefix = {
    info: '  ',
    success: '✓ ',
    warning: '⚠ ',
    error: '✗ ',
  };
  console.log(`${prefix[type]}${message}`);
}

function checkDirectory(dir) {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

function checkFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function checkFileSize(filePath, minSize = 0) {
  if (!checkFile(filePath)) return false;
  const stats = fs.statSync(filePath);
  return stats.size > minSize;
}

console.log('\n📦 Smoke Tests for Next.js Static Export\n');

// Check output directory exists
if (!checkDirectory(OUT_DIR)) {
  log(`Output directory not found: ${OUT_DIR}`, 'error');
  log('Run "npm run build" first', 'info');
  process.exit(1);
}

console.log('Checking required pages...');
for (const page of REQUIRED_PAGES) {
  if (page === '404') {
    const legacyPath = path.join(OUT_DIR, '404', 'index.html');
    const flatPath = path.join(OUT_DIR, '404.html');
    if (checkFileSize(legacyPath, 100) || checkFileSize(flatPath, 100)) {
      log('/404 (index.html or 404.html)', 'success');
    } else {
      log('/404 - missing or empty', 'error');
      errors++;
    }
    continue;
  }

  const pagePath = page === '' 
    ? path.join(OUT_DIR, 'index.html')
    : path.join(OUT_DIR, page, 'index.html');
  
  if (checkFileSize(pagePath, 100)) {
    log(`/${page || 'index.html'}`, 'success');
  } else {
    log(`/${page || 'index.html'} - missing or empty`, 'error');
    errors++;
  }
}

console.log('\nChecking static assets...');
for (const asset of REQUIRED_ASSETS) {
  const assetPath = path.join(OUT_DIR, asset);
  
  if (checkFile(assetPath)) {
    log(asset, 'success');
  } else {
    log(`${asset} - missing`, 'error');
    errors++;
  }
}

console.log('\nChecking Next.js output...');
for (const dir of REQUIRED_NEXT) {
  const dirPath = path.join(OUT_DIR, dir);
  
  if (checkDirectory(dirPath)) {
    log(dir, 'success');
  } else {
    log(`${dir} - missing`, 'error');
    errors++;
  }
}

// Check _next/static directory has content
const staticDir = path.join(OUT_DIR, '_next/static');
if (checkDirectory(staticDir)) {
  const staticContents = fs.readdirSync(staticDir);
  if (staticContents.length > 0) {
    log(`_next/static has ${staticContents.length} items`, 'success');
  } else {
    log('_next/static is empty', 'warning');
    warnings++;
  }
}

// Check manifest.json is valid JSON
console.log('\nValidating JSON files...');
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8'));
  if (manifest.name && manifest.icons) {
    log('manifest.json is valid', 'success');
  } else {
    log('manifest.json missing required fields', 'warning');
    warnings++;
  }
} catch (e) {
  log('manifest.json is invalid JSON', 'error');
  errors++;
}

// Note: Firmware manifests are now generated dynamically by Supabase Edge Functions
// No longer checking for static updates/manifest.json file

// Summary
console.log('\n' + '─'.repeat(40));
if (errors === 0 && warnings === 0) {
  console.log('✅ All smoke tests passed!\n');
  process.exit(0);
} else if (errors === 0) {
  console.log(`⚠️  Tests passed with ${warnings} warning(s)\n`);
  process.exit(0);
} else {
  console.log(`❌ Tests failed: ${errors} error(s), ${warnings} warning(s)\n`);
  process.exit(1);
}
