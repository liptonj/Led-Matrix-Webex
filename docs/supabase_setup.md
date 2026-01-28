# Supabase Setup Guide

This guide walks you through setting up Supabase for the LED Matrix Webex Display project, including database migration, Edge Function deployment, and secret configuration.

## Prerequisites

1. **Supabase Account**: Create a free account at [supabase.com](https://supabase.com)
2. **Supabase CLI**: Install with `brew install supabase/tap/supabase`
3. **GitHub CLI**: Install with `brew install gh`
4. **Azure CLI** (optional): Install with `brew install azure-cli`

## Quick Start

We provide two scripts to automate the setup:

```bash
# Step 1: Set up Supabase (database, functions)
./scripts/setup-supabase.sh

# Step 2: Configure secrets (GitHub, Azure, Cloudflare)
./scripts/configure-secrets.sh
```

## Manual Setup Steps

If you prefer to set up manually, follow these steps:

### Step 1: Create Supabase Project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Click **New Project**
3. Choose your organization
4. Enter project details:
   - **Name**: `led-matrix-webex`
   - **Database Password**: Generate a strong password (save this!)
   - **Region**: Choose closest to your users
5. Wait for project creation (1-2 minutes)

### Step 2: Link Local Project

```bash
cd supabase

# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF
# Enter your database password when prompted
```

Find your project reference in the URL:
`https://supabase.com/dashboard/project/YOUR_PROJECT_REF`

### Step 3: Run Database Migration

```bash
cd supabase
supabase db push
```

This creates:
- `display.devices` - Device registration with HMAC auth
- `display.device_logs` - Debug log storage
- `display.releases` - Firmware release management
- `firmware` storage bucket (private)
- Row Level Security policies

### Step 4: Deploy Edge Functions

```bash
cd supabase

# Deploy all functions
supabase functions deploy provision-device --no-verify-jwt
supabase functions deploy validate-device --no-verify-jwt
supabase functions deploy get-firmware --no-verify-jwt
supabase functions deploy get-manifest --no-verify-jwt
```

The `--no-verify-jwt` flag is required because devices authenticate via HMAC headers, not JWTs.

### Step 5: Create Admin User

1. Go to **Supabase Dashboard > Authentication > Users**
2. Click **Add user** > **Create new user**
3. Enter:
   - Email: Your admin email
   - Password: Strong password
   - Check **Auto Confirm User**
4. Click **Create user**

This user can access the admin dashboard at `/admin`.

### Step 6: Get API Keys

Go to **Settings > API** in the Supabase Dashboard:

- **Project URL**: `https://YOUR_PROJECT.supabase.co`
- **anon (public) key**: For client-side (website)
- **service_role key**: For server-side (bridge, CI/CD) - **KEEP SECRET**

## Configure Secrets

### GitHub Repository Secrets

Go to your GitHub repo > **Settings > Secrets and variables > Actions**

Required secrets for CI/CD:

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (for firmware upload) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Pages permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `AZURE_CREDENTIALS` | Azure service principal JSON (see below) |

Using GitHub CLI:

```bash
# Set Supabase secrets
gh secret set SUPABASE_URL
gh secret set SUPABASE_SERVICE_ROLE_KEY
```

### Azure Container Apps

After deploying the bridge, update environment variables:

```bash
az containerapp update \
  --name webex-bridge \
  --resource-group webex-bridge-rg \
  --set-env-vars \
    SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Cloudflare Pages

In Cloudflare Dashboard > **Workers & Pages > led-matrix-webex > Settings > Environment variables**:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your anon key |

### Local Development

Create local `.env` files:

**website/.env**:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

**bridge/.env**:
```
WS_PORT=8080
LOG_LEVEL=info
DATA_DIR=./data
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   ESP32 Device  │────▶│  Bridge Server  │────▶│    Supabase     │
│   (Firmware)    │     │    (Azure)      │     │    (Cloud)      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ HMAC Auth             │ HMAC Validation       │
         │ WebSocket             │ Device Registration   │ Database
         │                       │ Debug Log Storage     │ Storage
         │                       │                       │ Edge Functions
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web UI        │────▶│   Admin         │────▶│   Auth          │
│   (Device)      │     │   Dashboard     │     │   (JWT)         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Edge Function Endpoints

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `/functions/v1/provision-device` | Device registration | None (device sends key_hash) |
| `/functions/v1/validate-device` | HMAC validation | HMAC headers |
| `/functions/v1/get-firmware` | Signed firmware URL | HMAC headers |
| `/functions/v1/get-manifest` | OTA manifest | Optional HMAC |

## Verification Checklist

After setup, verify:

- [ ] Database migration applied (check tables in SQL Editor)
- [ ] Edge Functions deployed (check in Functions section)
- [ ] Admin user created (test login at `/admin`)
- [ ] GitHub secrets configured (check Actions > Secrets)
- [ ] Local `.env` files created (for development)

Test the Edge Functions:

```bash
# Test provision-device
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/provision-device \
  -H "Content-Type: application/json" \
  -d '{"serial_number": "DEADBEEF", "key_hash": "test123"}'

# Should return: {"success": true, "device_id": "...", "pairing_code": "..."}
```

## Troubleshooting

### Migration Fails

If you see errors about existing objects:

```sql
-- Run in Supabase SQL Editor to reset
DROP SCHEMA IF EXISTS display CASCADE;
```

Then run `supabase db push` again.

### Edge Functions Not Working

Check function logs:

```bash
supabase functions logs provision-device
```

### HMAC Validation Fails

1. Ensure device and server have same key_hash
2. Check timestamp is within 5 minutes
3. Verify signature calculation matches

### Admin Login Fails

1. Ensure user was created with Auto Confirm
2. Check browser console for errors
3. Verify Supabase URL and anon key are correct

## Security Notes

1. **Service Role Key**: Never expose in client-side code
2. **RLS Policies**: All tables have Row Level Security enabled
3. **HMAC Auth**: Prevents replay attacks with timestamps
4. **Storage**: Firmware bucket is private; access via signed URLs
5. **Admin Access**: Protected by Supabase Auth + RLS policies
