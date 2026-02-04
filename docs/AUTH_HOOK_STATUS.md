# Custom Access Token Hook - Configuration Status

**Date**: February 3, 2026  
**Status**: ✅ Verified and Documented

## Summary

The Custom Access Token hook configuration has been verified and documented. The hook is currently **disabled** in `config.toml` (for local development) and must be configured separately for production environments.

## Current Configuration Status

### ✅ Hook Function Implementation
- **Location**: `supabase/functions/auth-hook-set-claims/index.ts`
- **Status**: ✅ Properly implemented
- **Functionality**:
  - ✅ Queries `admin_users` table for admin status
  - ✅ Queries `user_profiles` table for disabled status
  - ✅ Returns `is_admin` and `disabled` in `app_metadata`
  - ✅ Preserves all required JWT claims
  - ✅ Handles errors gracefully
  - ✅ Uses parallel queries for performance

### ⚠️ Configuration Files

#### config.toml
- **Status**: Hook disabled (`enabled = false`)
- **Location**: `supabase/config.toml` lines 49-50
- **Note**: This is expected for local development. For production, configure via Dashboard or Management API.

#### Configuration Script
- **Status**: ✅ Available
- **Location**: `scripts/configure-auth-hook.ts`
- **Functionality**: Configures hook via Supabase Management API
- **Usage**: `deno run --allow-net --allow-env scripts/configure-auth-hook.ts`

## Verification Checklist

- [x] Hook function exists and is properly implemented
- [x] Hook queries correct tables (`admin_users`, `user_profiles`)
- [x] Hook returns correct claims (`is_admin`, `disabled`)
- [x] Hook preserves all required JWT claims
- [x] Configuration documentation created
- [x] Test helper function created
- [x] config.toml documented with setup instructions

## Recommendations

### For Production Deployment

1. **Configure via Dashboard** (Recommended):
   - Navigate to Authentication → Hooks → Custom Access Token
   - Set Hook URI: `https://PROJECT_ID.supabase.co/functions/v1/auth-hook-set-claims`
   - Set Secret: `DEVICE_JWT_SECRET`
   - Enable the hook

2. **Or use Configuration Script**:
   ```bash
   export SUPABASE_ACCESS_TOKEN=your_token
   deno run --allow-net --allow-env scripts/configure-auth-hook.ts
   ```

3. **Verify Configuration**:
   - Use test helper: `checkAuthClaims()` from `@/lib/test-claims`
   - Check browser console after login
   - Verify JWT contains `app_metadata.is_admin` and `app_metadata.disabled`

### For Local Development

1. **Enable in config.toml** (if needed):
   ```toml
   [auth.hook.custom_access_token]
   enabled = true
   uri = "http://localhost:54321/functions/v1/auth-hook-set-claims"
   secrets = ["DEVICE_JWT_SECRET"]
   ```

2. **Ensure Edge Function is Running**:
   ```bash
   supabase functions serve auth-hook-set-claims
   ```

3. **Test Locally**:
   - Use `checkAuthClaims()` helper
   - Check Edge Function logs: `supabase functions logs auth-hook-set-claims`

## Testing

### Quick Test

```typescript
import { checkAuthClaims, logAuthClaims } from '@/lib/test-claims';

// In a component or browser console
await logAuthClaims();
```

### Browser Console Test

```javascript
// After importing test-claims.ts
await window.logAuthClaims();
```

### Manual JWT Inspection

1. Log in to the application
2. Open DevTools → Application → Local Storage
3. Find Supabase session token
4. Decode at jwt.io or in console:
   ```javascript
   const { data: { session } } = await supabase.auth.getSession();
   const payload = JSON.parse(atob(session.access_token.split('.')[1]));
   console.log('Claims:', payload.app_metadata);
   ```

## Files Created/Updated

1. ✅ **Documentation**: `docs/AUTH_HOOK_CONFIGURATION.md`
   - Comprehensive configuration guide
   - Troubleshooting section
   - Verification steps

2. ✅ **Test Helper**: `website/src/lib/test-claims.ts`
   - `checkAuthClaims()` function
   - `logAuthClaims()` function
   - Browser console helpers

3. ✅ **Config Documentation**: `supabase/config.toml`
   - Updated with detailed comments
   - Local development instructions

## Next Steps

1. **Production**: Configure hook via Dashboard or script
2. **Testing**: Use test helper to verify claims are present
3. **Monitoring**: Check Edge Function logs for any errors
4. **Documentation**: Share `AUTH_HOOK_CONFIGURATION.md` with team

## Related Documentation

- [Auth Hook Configuration Guide](./AUTH_HOOK_CONFIGURATION.md)
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth/auth-hooks)
- [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
