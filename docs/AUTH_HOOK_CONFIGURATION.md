# Custom Access Token Hook Configuration Guide

This guide documents the configuration of the Custom Access Token hook that automatically sets `is_admin` and `disabled` claims in user JWT tokens.

## Overview

The Custom Access Token hook runs automatically on user login and token refresh to inject custom claims into the JWT:
- `app_metadata.is_admin`: Whether the user is an admin (from `admin_users` table)
- `app_metadata.disabled`: Whether the user account is disabled (from `user_profiles` table)

This eliminates the need for the frontend to query the database on every page load, improving performance and reducing database load.

## Architecture

The hook is implemented as a Supabase Edge Function located at:
- **Function**: `supabase/functions/auth-hook-set-claims/index.ts`
- **Endpoint**: `https://PROJECT_ID.supabase.co/functions/v1/auth-hook-set-claims`

The hook:
1. Receives authentication events from Supabase Auth
2. Queries `admin_users` and `user_profiles` tables
3. Returns updated claims with `is_admin` and `disabled` in `app_metadata`
4. Preserves all required JWT claims (aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous)

## Configuration Methods

### Method 1: Using Configuration Script (Recommended for Production)

Use the provided script to configure the hook via Supabase Management API:

```bash
# Set your Supabase access token
export SUPABASE_ACCESS_TOKEN=your_access_token_here

# Run the configuration script
deno run --allow-net --allow-env scripts/configure-auth-hook.ts
```

**Requirements:**
- Supabase Access Token from https://supabase.com/dashboard/account/tokens
- `DEVICE_JWT_SECRET` environment variable set in Supabase project secrets

**What it does:**
- Retrieves current auth configuration
- Sets `HOOK_CUSTOM_ACCESS_TOKEN_URI` to the Edge Function URL
- Sets `HOOK_CUSTOM_ACCESS_TOKEN_ENABLED` to `true`
- Sets `HOOK_CUSTOM_ACCESS_TOKEN_SECRETS` to `DEVICE_JWT_SECRET`

### Method 2: Manual Dashboard Configuration

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **Hooks** → **Custom Access Token**
3. Configure the following settings:

   **Hook URI:**
   ```
   https://PROJECT_ID.supabase.co/functions/v1/auth-hook-set-claims
   ```
   Replace `PROJECT_ID` with your actual Supabase project reference.

   **Secret:**
   ```
   DEVICE_JWT_SECRET
   ```
   This should match the `DEVICE_JWT_SECRET` value set in your Supabase project secrets.

   **Enabled:**
   ```
   true
   ```

### Method 3: Local Development (config.toml)

For local development, update `supabase/config.toml`:

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "http://localhost:54321/functions/v1/auth-hook-set-claims"
secrets = ["DEVICE_JWT_SECRET"]
```

**Note:** Local development may require the Edge Function to be running. Ensure `supabase functions serve` is running before testing.

## Verification

### 1. Check Configuration Status

After configuration, verify the hook is enabled:

**Using Supabase CLI:**
```bash
supabase projects api-keys --project-ref PROJECT_ID
```

**Using Dashboard:**
- Go to **Authentication** → **Hooks** → **Custom Access Token**
- Verify the hook shows as "Enabled"

### 2. Test Hook Functionality

Use the test helper function to verify claims are present:

```typescript
import { checkAuthClaims } from '@/lib/test-claims';

// In a component or test
const claims = await checkAuthClaims();
console.log('Claims:', claims);
// Should show: { is_admin: boolean, disabled: boolean }
```

### 3. Verify JWT Claims

1. Log in to the application
2. Open browser DevTools → Application → Local Storage
3. Find the Supabase session token
4. Decode the JWT (using jwt.io or browser console)
5. Verify `app_metadata.is_admin` and `app_metadata.disabled` are present

**Browser Console Test:**
```javascript
// Get current session
const { data: { session } } = await supabase.auth.getSession();

// Decode JWT
const payload = JSON.parse(atob(session.access_token.split('.')[1]));
console.log('JWT Claims:', payload);
console.log('Is Admin:', payload.app_metadata?.is_admin);
console.log('Disabled:', payload.app_metadata?.disabled);
```

## Edge Function Implementation

The hook function (`supabase/functions/auth-hook-set-claims/index.ts`) performs:

1. **Authentication**: Verifies the request using `DEVICE_JWT_SECRET`
2. **Database Queries**: 
   - Checks `admin_users` table for admin status
   - Checks `user_profiles` table for disabled status
3. **Claim Merging**: Preserves all original claims and adds custom claims to `app_metadata`
4. **Response**: Returns updated claims in the format Supabase expects

**Key Implementation Details:**
- Uses `Promise.allSettled` for parallel queries
- Handles missing profiles gracefully (defaults to `disabled: false`)
- Only grants admin if user is in `admin_users` AND not disabled
- Preserves all required JWT claims to avoid validation errors

## Troubleshooting

### Hook Not Running

**Symptoms:**
- Claims are missing from JWT
- `is_admin` always returns `undefined`

**Solutions:**
1. Verify hook is enabled in Dashboard or config.toml
2. Check Edge Function logs: `supabase functions logs auth-hook-set-claims`
3. Verify `DEVICE_JWT_SECRET` is set in project secrets
4. Ensure Edge Function is deployed: `supabase functions deploy auth-hook-set-claims`

### Invalid Authorization Header

**Symptoms:**
- Hook returns 401 Unauthorized
- Edge Function logs show "Invalid authorization header"

**Solutions:**
1. Verify `DEVICE_JWT_SECRET` matches between:
   - Supabase project secrets
   - Hook configuration (`HOOK_CUSTOM_ACCESS_TOKEN_SECRETS`)
2. Check the secret format matches exactly

### Missing Claims Error

**Symptoms:**
- Error: "output claims do not conform to the expected schema"
- Authentication fails after hook runs

**Solutions:**
1. Verify hook returns ALL required claims (not just custom ones)
2. Check hook implementation preserves original claims
3. Review Edge Function logs for errors

### Claims Not Updating

**Symptoms:**
- Claims show old values after admin status changes
- User needs to log out and back in to see changes

**Solutions:**
1. Claims are set on login and token refresh only
2. User must refresh token or log out/in to get updated claims
3. This is expected behavior - claims are cached in the JWT

## Environment Variables

Required environment variables for the Edge Function:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for database queries
- `DEVICE_JWT_SECRET`: Secret for webhook authentication

These are automatically set when deploying via Supabase CLI or Dashboard.

## Related Files

- **Hook Function**: `supabase/functions/auth-hook-set-claims/index.ts`
- **Configuration Script**: `scripts/configure-auth-hook.ts`
- **Config File**: `supabase/config.toml`
- **Test Helper**: `website/src/lib/test-claims.ts`
- **Auth Helpers**: `website/src/lib/supabase/auth.ts`

## References

- [Supabase Auth Hooks Documentation](https://supabase.com/docs/guides/auth/auth-hooks)
- [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [JWT Claims Documentation](https://supabase.com/docs/guides/auth/auth-deep-dive/auth-deep-dive-jwts)
