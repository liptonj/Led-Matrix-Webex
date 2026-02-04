# Unified Webex OAuth Authentication - Updated Plan

## Core Change: Single Sign-On for Everyone

**Current State**: 
- Admin uses email/password login
- User portal uses Webex OAuth (from previous plan)
- Two separate authentication flows

**New State**:
- **Everyone** uses Webex OAuth (admins and regular users)
- Single unified login flow
- Simpler architecture, better security

---

## Changes Required

### 1. Update Admin Login Page

**File**: `website/src/app/admin/login/page.tsx`

**Replace email/password form with Webex OAuth button** (same as user login):

```tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { Header } from '@/components/layout';

export default function AdminLoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleWebexLogin = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const supabase = createClient();
      const { data, error: fnError } = await supabase.functions.invoke('webex-user-login', {
        body: { redirect_to: '/admin' }  // Tell callback to redirect to admin
      });
      
      if (fnError || !data.auth_url) {
        throw new Error('Failed to start login');
      }
      
      window.location.href = data.auth_url;
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err.message || 'Failed to start login');
      setLoading(false);
    }
  };
  
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-200px)] bg-[var(--color-bg)] flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text)]">
                Admin Login
              </h1>
              <p className="text-[var(--color-text-muted)] mt-2">
                Sign in with Webex to manage devices and releases
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleWebexLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-600 text-white rounded-md shadow hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Connecting...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22C6.486 22 2 17.514 2 12S6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/>
                  </svg>
                  Sign in with Webex
                </>
              )}
            </button>

            <div className="mt-6 text-center">
              <Link
                href="/"
                className="text-sm text-primary hover:underline"
              >
                Return to Home
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
```

### 2. Update webex-user-login Edge Function

**File**: `supabase/functions/webex-user-login/index.ts`

**Add support for redirect_to parameter**:

```typescript
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response('ok', { headers: corsHeaders });
  }

  const clientId = Deno.env.get('WEBEX_CLIENT_ID');
  const redirectUri = Deno.env.get('WEBEX_REDIRECT_URI') || 
                      `${Deno.env.get('SUPABASE_URL')}/functions/v1/webex-user-callback`;
  
  if (!clientId) {
    return Response.json({ error: 'Webex OAuth not configured' }, { 
      status: 500, headers: corsHeaders 
    });
  }

  // Parse request body for optional redirect_to
  let redirectTo = '/user';  // Default to user portal
  try {
    const body = await req.json();
    if (body.redirect_to) {
      redirectTo = body.redirect_to;
    }
  } catch {
    // No body or invalid JSON - use default
  }

  // Generate PKCE code verifier and challenge
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  // Generate state for CSRF protection + redirect tracking
  const state = btoa(JSON.stringify({
    nonce: crypto.randomUUID(),
    ts: Math.floor(Date.now() / 1000),
    flow: 'unified_login',
    redirect_to: redirectTo  // Store where to redirect after auth
  }));

  // Store code verifier temporarily (5 min expiry)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  await supabase.from('display.oauth_state').upsert({
    state_key: state,
    code_verifier: codeVerifier,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  });

  // Build authorization URL
  const authUrl = new URL(WEBEX_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email profile spark:people_read');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return Response.json({ auth_url: authUrl.toString() }, { headers: corsHeaders });
});
```

### 3. Update webex-user-callback Edge Function

**File**: `supabase/functions/webex-user-callback/index.ts`

**Extract redirect_to from state and use it**:

```typescript
// ... existing code for token exchange ...

// After creating/updating user, extract redirect_to from state
let redirectTo = '/user';  // Default
try {
  const stateData = JSON.parse(atob(state));
  if (stateData.redirect_to) {
    redirectTo = stateData.redirect_to;
  }
} catch {
  // Invalid state - use default
}

// Generate Supabase session
const { data: sessionData } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email: webexUser.email
});

// Redirect to appropriate portal (admin or user)
return Response.json({
  success: true,
  redirect_url: `${redirectTo}?token=${sessionData.properties?.hashed_token}`
}, { headers: corsHeaders });
```

### 4. Update User Login Page

**File**: `website/src/app/user/login/page.tsx`

**Keep existing code, just ensure it passes redirect_to: '/user'**:

```typescript
const { data, error } = await supabase.functions.invoke('webex-user-login', {
  body: { redirect_to: '/user' }
});
```

### 5. Update AdminShell Authentication Check

**File**: `website/src/app/admin/AdminShell.tsx`

**No changes needed** - AdminShell already checks for admin role via `isAdmin()` function. After Webex OAuth login, it will automatically check if user is admin and redirect non-admins to `/admin/devices`.

### 6. Remove Email/Password Admin Registration

**File**: `website/src/app/admin/users/page.tsx` (if exists)

When creating new admin users, instead of email/password:

1. Have admin enter the Webex email address
2. System creates user_profile with `role: 'admin'`
3. User logs in via Webex OAuth
4. System links their Webex account to the pre-created profile

---

## Benefits of Unified Authentication

### Security
- ✅ Single OAuth flow = smaller attack surface
- ✅ No password storage/management
- ✅ Webex handles MFA, password resets, security policies
- ✅ Enterprise SSO integration (if using Webex org accounts)

### User Experience
- ✅ One login method for everyone
- ✅ Familiar Webex login (users already have accounts)
- ✅ No separate credentials to remember
- ✅ Seamless admin/user switching

### Maintenance
- ✅ Simpler codebase (one auth flow)
- ✅ Fewer edge cases to handle
- ✅ No email/password edge functions needed
- ✅ Easier to audit and secure

---

## Migration Path for Existing Admins

### Option 1: Automatic Migration (Recommended)

1. Create `migrate-admin-to-webex` Edge Function
2. Admin enters their email
3. System sends magic link
4. On first Webex login, links to existing admin account

### Option 2: Manual Migration

1. Admin logs in with email/password (one last time)
2. Admin clicks "Link Webex Account"
3. OAuth flow updates profile with `webex_user_id`
4. Next login uses Webex OAuth

### Option 3: Fresh Start

1. Export list of admin emails
2. Delete old email/password admin accounts
3. Recreate as Webex-only profiles
4. Admins log in via Webex OAuth

---

## Database Schema (No Changes Needed)

The existing schema from the previous plan already supports this:

```sql
-- display.user_profiles already has:
webex_user_id TEXT UNIQUE        -- Webex OAuth ID
webex_email TEXT                 -- Email from Webex
auth_provider TEXT DEFAULT 'email'  -- Can be 'email' or 'webex'
role TEXT DEFAULT 'user'          -- 'admin' or 'user'
```

**For unified Webex auth**:
- Set `auth_provider = 'webex'` for all new users
- Existing `role` field determines admin vs user access
- `webex_user_id` links to Webex account

---

## Admin User Creation Flow

### Before (Email/Password)
1. Admin clicks "Create User"
2. Enter email + password
3. User logs in with credentials

### After (Webex OAuth)
1. Admin clicks "Create User"
2. Enter Webex email address
3. System creates profile with `role: 'admin'`
4. User visits `/admin/login` → Webex OAuth
5. System links Webex account to profile
6. Done!

---

## Implementation Summary

| File | Change | Lines |
|------|--------|-------|
| `website/src/app/admin/login/page.tsx` | Replace email/password with Webex button | ~50 |
| `supabase/functions/webex-user-login/index.ts` | Add redirect_to support | +10 |
| `supabase/functions/webex-user-callback/index.ts` | Extract redirect_to from state | +10 |
| `website/src/app/user/login/page.tsx` | Add redirect_to parameter | +1 |

**Total**: ~70 lines changed, no new files

---

## Testing Checklist

- [ ] Admin can login via Webex OAuth at `/admin/login`
- [ ] User can login via Webex OAuth at `/user/login`
- [ ] Admin redirects to `/admin` after OAuth
- [ ] User redirects to `/user` after OAuth
- [ ] Non-admin Webex users cannot access admin portal
- [ ] Admin users can switch between admin and user portals
- [ ] Existing email/password admins can migrate (if keeping migration)
- [ ] OAuth state includes correct redirect_to
- [ ] PKCE flow works correctly for both paths

---

## Rollback Plan

If issues arise, keep the old email/password admin login:

1. Revert `admin/login/page.tsx` to email/password form
2. Keep Webex OAuth as optional "Sign in with Webex" button
3. Gradually migrate admins to Webex

---

## Deployment Order

1. Deploy updated Edge Functions (webex-user-login, webex-user-callback)
2. Deploy admin login page update
3. Test admin Webex login
4. (Optional) Migrate existing admins
5. Remove email/password login code (if desired)

---

## Summary

✅ **Single Sign-On** - Everyone uses Webex OAuth  
✅ **Role-Based Access** - User profiles determine admin vs user  
✅ **Simpler Architecture** - One auth flow, easier to maintain  
✅ **Better Security** - No password management, enterprise SSO support  
✅ **Seamless Experience** - Familiar Webex login for all users

**Minimal Changes**: ~70 lines of code, no new database tables, reuses existing OAuth infrastructure.
