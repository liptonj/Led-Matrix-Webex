# LED Matrix Webex Website

Static website for the LED Matrix Webex Display project, deployed to Cloudflare Pages.

## Structure

- `public/` - Static website files
  - `index.html` - Homepage
  - `hardware.html` - Hardware assembly guide
  - `versions.html` - Firmware downloads
  - `api-docs.html` - API documentation
  - `css/` - Stylesheets
  - `js/` - JavaScript files
- `scripts/` - Build scripts
  - `generate-manifest.js` - Fetches releases from GitHub and generates manifest.json

## Development

```bash
# Serve locally
npm run dev

# Generate manifest from GitHub releases
npm run build

# Deploy to Cloudflare Pages
npm run deploy
```

## Deployment

The website is automatically deployed to Cloudflare Pages on every push to main via GitHub Actions.

The manifest.json file is generated during the build process by fetching release data from the GitHub API.

## URLs

- Production: https://display.5ls.us
- Cloudflare Pages: https://led-matrix-webex.pages.dev
