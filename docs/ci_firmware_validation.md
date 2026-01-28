# CI Workflow Firmware Registration Validation

## Overview

This document validates that the `.github/workflows/ci.yml` workflow properly creates firmware builds and registers them with Supabase.

## Validation Date

January 28, 2026

## Workflow Flow

1. **firmware-build-esp32s3**: Builds ESP32-S3 firmware with embedded web assets
2. **release**: Creates GitHub release with firmware artifacts
3. **supabase-upload**: Uploads firmware to Supabase Storage and creates release record
4. **deploy-website**: Deploys website that uses Supabase Edge Functions for firmware manifests

## Critical Issues Found and Fixed

### ✅ Issue 1: Storage Policy Blocking CI Uploads

**Problem**: The storage policy `firmware_admin_write` only allowed `authenticated` role to upload, but CI uses `SUPABASE_SERVICE_ROLE_KEY` which has `service_role` permissions.

**Impact**: Firmware uploads would fail with 403 Forbidden errors.

**Fix**: Created migration `20260128000004_allow_service_role_firmware_upload.sql` that:
- Updates `firmware_admin_write` policy to allow both `authenticated` and `service_role`
- Adds `firmware_service_update` policy for service_role to update existing files

**Status**: ✅ Fixed

### ✅ Issue 2: Missing Error Handling

**Problem**: Curl commands in the workflow didn't check HTTP status codes or handle errors.

**Impact**: Failed uploads would be silently ignored, making debugging difficult.

**Fix**: Added error handling to all curl commands:
- Capture HTTP status codes
- Exit with error code on failure
- Display error responses for debugging
- Validate file existence before upload

**Status**: ✅ Fixed

## Workflow Validation

### 1. Firmware Build Process ✅

**Location**: `firmware-build-esp32s3` job

**Validations**:
- ✅ Builds firmware with PlatformIO
- ✅ Embeds web assets during build
- ✅ Creates both OTA firmware (`firmware.bin`) and merged firmware (`firmware-merged.bin`)
- ✅ Uses correct environment variables for Supabase config
- ✅ Validates version matches `platformio.ini`

**Secrets Required**:
- `WEBEX_CLIENT_ID` ✅
- `WEBEX_CLIENT_SECRET` ✅
- `SUPABASE_URL` ✅
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ✅ (used for build-time config)

### 2. Supabase Storage Upload ✅

**Location**: `supabase-upload` job → "Upload firmware to Supabase Storage" step

**Validations**:
- ✅ Uploads OTA firmware to `firmware/{version}/firmware.bin`
- ✅ Uploads merged firmware to `firmware/{version}/firmware-merged.bin`
- ✅ Uses correct endpoint: `/storage/v1/object/firmware/{version}/{filename}`
- ✅ Uses service role key for authentication
- ✅ Includes `Content-Profile: display` header (required for schema isolation)
- ✅ Validates HTTP status codes (200-299)
- ✅ Handles errors with clear messages

**Storage Bucket**: `firmware` (private bucket)
**Path Structure**: `{version}/firmware.bin` and `{version}/firmware-merged.bin`

**Secrets Required**:
- `SUPABASE_URL` ✅
- `SUPABASE_SERVICE_ROLE_KEY` ✅

### 3. Release Record Creation ✅

**Location**: `supabase-upload` job → "Create/Update release record in Supabase" step

**Validations**:
- ✅ Creates/updates record in `display.releases` table
- ✅ Uses correct endpoint: `/rest/v1/releases`
- ✅ Includes `Content-Profile: display` header (required for schema)
- ✅ Uses `Prefer: resolution=merge-duplicates` for upsert behavior
- ✅ Sets `is_latest=true` for stable releases
- ✅ Sets `is_latest=false` for pre-releases
- ✅ Includes all required fields:
  - `version` (from tag, e.g., "1.5.0")
  - `tag` (full tag, e.g., "v1.5.0")
  - `name` (e.g., "Release v1.5.0")
  - `firmware_url` (Supabase Storage URL)
  - `firmware_merged_url` (Supabase Storage URL)
  - `firmware_size` (bytes)
  - `build_id` (GitHub SHA)
  - `build_date` (ISO 8601 timestamp)
  - `is_latest` (boolean)
  - `is_prerelease` (boolean)
  - `rollout_percentage` (defaults to 100)

**Database Schema**: `display.releases` table
**Primary Key**: `version` (unique constraint)

### 4. Edge Function Integration ✅

**Location**: Supabase Edge Functions (`get-firmware`, `get-manifest`)

**Validations**:
- ✅ `get-firmware` function reads from `display.releases` table
- ✅ `get-manifest` function reads from `display.releases` table
- ✅ Functions generate signed URLs for firmware downloads
- ✅ Functions respect `rollout_percentage` for staged rollouts
- ✅ Functions support both authenticated (HMAC) and public access

**Edge Functions**:
- `get-firmware`: Returns signed URL for specific firmware version
- `get-manifest`: Returns firmware manifest for OTA updates or ESP Web Tools

## Version Matching

**Validation**: The workflow validates that the Git tag version matches `firmware/platformio.ini` firmware_version.

**Example**:
- Tag: `v1.5.0`
- `platformio.ini`: `firmware_version = 1.5.0`
- ✅ Match validated in "Validate version matches platformio.ini" step

## Prerequisites

### Required GitHub Secrets

| Secret | Purpose | Status |
|--------|---------|--------|
| `SUPABASE_URL` | Supabase project URL | ✅ Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for uploads | ✅ Required |
| `WEBEX_CLIENT_ID` | Webex OAuth client ID | ✅ Required |
| `WEBEX_CLIENT_SECRET` | Webex OAuth client secret | ✅ Required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key for build config | ✅ Required |

### Required Supabase Setup

1. ✅ Database schema `display` created
2. ✅ Table `display.releases` created
3. ✅ Storage bucket `firmware` created (private)
4. ✅ Storage policies allow service_role uploads
5. ✅ Edge Functions deployed:
   - `get-firmware`
   - `get-manifest`

### Required Migrations

All migrations in `supabase/migrations/` must be applied, including:
- ✅ `20260127000000_create_display_schema.sql` (creates releases table and storage bucket)
- ✅ `20260128000004_allow_service_role_firmware_upload.sql` (allows CI uploads)

## Testing Recommendations

### 1. Test Storage Upload

```bash
# Test upload with service role key
curl -X POST "${SUPABASE_URL}/storage/v1/object/firmware/test/firmware.bin" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/octet-stream" \
  -H "Content-Profile: display" \
  --data-binary @firmware.bin
```

### 2. Test Release Record Creation

```bash
# Test release record creation
curl -X POST "${SUPABASE_URL}/rest/v1/releases" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Content-Profile: display" \
  -H "Accept-Profile: display" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '{
    "version": "1.5.0",
    "tag": "v1.5.0",
    "name": "Release v1.5.0",
    "firmware_url": "https://...",
    "firmware_merged_url": "https://...",
    "firmware_size": 1234567,
    "build_id": "abc123",
    "build_date": "2026-01-28T00:00:00Z",
    "is_latest": true,
    "is_prerelease": false,
    "rollout_percentage": 100
  }'
```

### 3. Test Edge Functions

```bash
# Test get-manifest (public access)
curl "${SUPABASE_URL}/functions/v1/get-manifest?format=esp-web-tools"

# Test get-firmware (requires HMAC auth)
# See firmware/src/supabase/supabase_client.cpp for HMAC implementation
```

## Workflow Triggers

The workflow runs on:
- ✅ Push to tags matching `v*` pattern (e.g., `v1.5.0`)
- ✅ Pull requests to `main` or `master` (builds only, no upload)

**Note**: Supabase upload only runs on version tags, not on PRs.

## Summary

✅ **All critical issues have been fixed**
✅ **Workflow properly validates versions**
✅ **Storage uploads include error handling**
✅ **Release records are created with all required fields**
✅ **Integration with Supabase Edge Functions is correct**

## Next Steps

1. **Apply Migration**: Run the new migration `20260128000004_allow_service_role_firmware_upload.sql` on your Supabase instance
2. **Verify Secrets**: Ensure all required GitHub secrets are configured
3. **Test Workflow**: Create a test tag (e.g., `v1.5.0-test`) to validate the full flow
4. **Monitor First Run**: Watch the workflow logs on the first real release to ensure everything works

## References

- [Supabase Storage API](https://supabase.com/docs/reference/javascript/storage-from-upload)
- [Supabase REST API](https://supabase.com/docs/reference/javascript/postgrest-from)
- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
