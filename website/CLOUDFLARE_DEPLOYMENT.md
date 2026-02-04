# Cloudflare Pages Deployment Configuration

This document explains how to configure environment variables for the LED Matrix Webex website on Cloudflare Pages.

## Environment Variables

Environment variables for Cloudflare Pages deployments must be set in the Cloudflare dashboard or via the Wrangler CLI. They are **not** configured in `wrangler.toml` for security reasons.

### Required Variables

#### 1. Supabase Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | `https://abc123.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key | `eyJ...` |

#### 2. GitHub Integration (for Release Promotion)

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_REPO` | Repository in `owner/repo` format | `myorg/Led-Matrix-Webex` |
| `GITHUB_TOKEN` | Personal Access Token with `repo` and `workflow` scopes | `ghp_...` |

**Note:** The GitHub token is used by the `/api/promote-release` endpoint to trigger the production release promotion workflow.

### Setting Environment Variables

#### Option 1: Cloudflare Dashboard

1. Go to your Cloudflare Pages project
2. Navigate to **Settings** → **Environment variables**
3. Add each variable for both **Production** and **Preview** environments
4. Click **Save**
5. Redeploy your site for changes to take effect

#### Option 2: Wrangler CLI

```bash
# Set for production environment
wrangler pages secret put GITHUB_TOKEN --project-name=led-matrix-webex

# Or use wrangler pages deployment create with --env-vars
wrangler pages deployment create . --project-name=led-matrix-webex \
  --branch=main \
  --env GITHUB_REPO=myorg/Led-Matrix-Webex \
  --env GITHUB_TOKEN=ghp_your_token
```

**Security Note:** Use `wrangler pages secret` for sensitive values like tokens. This encrypts them and prevents them from appearing in logs.

### Creating a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens/new
2. Give it a descriptive name: "LED Matrix Webex - Production Promotion"
3. Set expiration (recommended: 90 days with auto-renewal)
4. Select scopes:
   - `repo` (Full control of private repositories)
   - `workflow` (Update GitHub Action workflows)
5. Click **Generate token**
6. Copy the token immediately (you won't see it again)
7. Add it to Cloudflare Pages as `GITHUB_TOKEN`

### Environment-Specific Configuration

You can set different values for production and preview environments:

- **Production**: Used for `main` branch deployments
- **Preview**: Used for PR previews and other branches

This allows you to use different Supabase projects or GitHub tokens for staging vs production.

### Verifying Configuration

After setting environment variables:

1. Trigger a new deployment (push to `main` or manually trigger)
2. Check the deployment logs in Cloudflare dashboard
3. Verify the `/api/promote-release` endpoint works by testing the "Promote to Production" button in the admin releases page

### Local Development

For local development, copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
# Edit .env.local with your actual values
```

Local `.env.local` files are gitignored and never committed to the repository.

## Deployment Process

The website deploys automatically when changes are pushed to the repository:

1. **On push to `main`**: Deploys to production environment
2. **On PR**: Creates a preview deployment

The deployment is handled by the GitHub Actions workflow defined in `.github/workflows/deploy-website.yml`.

## Troubleshooting

### Release Promotion Fails with "GitHub integration not configured"

**Solution:** Ensure `GITHUB_REPO` and `GITHUB_TOKEN` are set in Cloudflare Pages environment variables.

### GitHub API returns 401 Unauthorized

**Solution:** 
1. Check that your GitHub token hasn't expired
2. Verify the token has `repo` and `workflow` scopes
3. Regenerate the token if needed and update in Cloudflare

### Environment variables not taking effect

**Solution:**
1. Verify variables are set in the correct environment (Production vs Preview)
2. Trigger a new deployment (environment variable changes require redeployment)
3. Check deployment logs for any errors

## Security Best Practices

1. **Never commit secrets** to the repository
2. **Use separate tokens** for production and staging
3. **Set token expiration** and rotate regularly
4. **Use minimal scopes** - only `repo` and `workflow` are needed
5. **Monitor token usage** in GitHub settings
6. **Revoke tokens** immediately if compromised
