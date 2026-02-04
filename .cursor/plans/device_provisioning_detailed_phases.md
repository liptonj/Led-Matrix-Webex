# Device Provisioning Implementation - Detailed Phase Breakdown

## Executive Summary

This document breaks down the Netflix-style device provisioning plan into independent, parallelizable phases that can be executed by separate engineering teams. Each phase has clear deliverables, dependencies, and acceptance criteria.

---

## Current State Analysis

### What Exists

| Component | Status | Location |
|-----------|--------|----------|
| Admin Portal | ✅ Complete | `/admin/*` |
| Admin Auth (email/password) | ✅ Complete | `signIn()` in `auth.ts` |
| Webex OAuth (device pairing only) | ✅ Complete | `/webexauth`, `/callback` |
| Device HMAC Auth | ✅ Complete | `device-auth` Edge Function |
| User Profiles Table | ✅ Complete | `display.user_profiles` |
| User-Device Mapping | ✅ Complete | `display.user_devices` |
| Admin Role System | ✅ Complete | `display.admin_users` + `is_admin()` |
| RLS Policies | ✅ Complete | Users can access assigned devices |

### What's Missing

| Component | Priority | Owner Phase |
|-----------|----------|-------------|
| User Portal/Dashboard | P0 | Phase 2 |
| User Login with Webex OAuth | P0 | Phase 1 |
| User Device Management UI | P1 | Phase 2 |
| Device Pairing Code Display | P1 | Phase 4 |
| Netflix-style Code Entry | P1 | Phase 3 |
| ESP Web Tools Integration | P2 | Phase 5 |
| Multi-device Support per User | P0 | Phase 1 (DB ready) |

---

## Phase 0: Prerequisites & Planning
**Duration**: 1 sprint | **Team**: Tech Lead / Architect | **Dependencies**: None

### Deliverables

1. **Webex Integration Setup**
   - [ ] Create/configure Webex Integration at [developer.webex.com](https://developer.webex.com)
   - [ ] Required scopes: `openid`, `email`, `profile`, `spark:people_read`
   - [ ] Register redirect URIs:
     - `https://display.5ls.us/auth/callback` (production)
     - `http://localhost:3000/auth/callback` (development)
   - [ ] Document `WEBEX_CLIENT_ID` and `WEBEX_CLIENT_SECRET`

2. **Supabase OAuth Provider Configuration**
   - [ ] Configure Webex as OAuth provider in Supabase Auth
   - [ ] Set up redirect URLs in Supabase Dashboard
   - [ ] Test OAuth flow manually

3. **Environment Variables**
   ```env
   # Add to .env files
   WEBEX_CLIENT_ID=<from developer.webex.com>
   WEBEX_CLIENT_SECRET=<from developer.webex.com>
   WEBEX_REDIRECT_URI=https://display.5ls.us/auth/callback
   ```

### Acceptance Criteria
- [ ] Webex Integration created and credentials stored securely
- [ ] Supabase configured with Webex OAuth provider
- [ ] Dev and prod redirect URIs registered

---

## Phase 1: Database Schema Updates
**Duration**: 1 sprint | **Team**: Backend/DB Engineer | **Dependencies**: Phase 0

### 1.1 Create Device Pairing Codes Table

```sql
-- Migration: 20260203000000_add_device_pairing_codes.sql

-- Table for Netflix-style pairing codes
CREATE TABLE display.device_pairing_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The 6-character pairing code displayed on device
    pairing_code TEXT UNIQUE NOT NULL,
    
    -- Device that generated this code
    serial_number TEXT NOT NULL REFERENCES display.devices(serial_number),
    
    -- User linkage (NULL until user enters code on website)
    linked_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ,
    
    -- Provisioning token (generated when user links code)
    provisioning_token TEXT UNIQUE,
    token_expires_at TIMESTAMPTZ,
    token_used_at TIMESTAMPTZ,
    
    -- Lifecycle timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_poll_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT pairing_code_format CHECK (char_length(pairing_code) = 6),
    CONSTRAINT provisioning_token_format CHECK (
        provisioning_token IS NULL OR char_length(provisioning_token) = 8
    )
);

-- Indexes for common queries
CREATE INDEX idx_pairing_codes_code ON display.device_pairing_codes(pairing_code) 
    WHERE linked_user_id IS NULL;
CREATE INDEX idx_pairing_codes_serial ON display.device_pairing_codes(serial_number);
CREATE INDEX idx_pairing_codes_user ON display.device_pairing_codes(linked_user_id);
CREATE INDEX idx_pairing_codes_expires ON display.device_pairing_codes(expires_at) 
    WHERE linked_user_id IS NULL;

-- Comments
COMMENT ON TABLE display.device_pairing_codes IS 
    'Netflix-style pairing codes displayed on device LED matrix, linked by user on website';
COMMENT ON COLUMN display.device_pairing_codes.pairing_code IS 
    '6-character code shown on LED matrix (e.g., ABC123)';
COMMENT ON COLUMN display.device_pairing_codes.provisioning_token IS 
    'Generated when user links code, used for actual device provisioning';
```

### 1.2 Update user_devices Table

```sql
-- Migration: 20260203000001_update_user_devices_provisioning.sql

ALTER TABLE display.user_devices 
    ADD COLUMN IF NOT EXISTS pairing_code_id UUID REFERENCES display.device_pairing_codes(id),
    ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS provisioning_method TEXT 
        CHECK (provisioning_method IN ('web_serial', 'pairing_code', 'improv_wifi', 'admin_assigned'));

COMMENT ON COLUMN display.user_devices.provisioning_method IS 
    'How device was provisioned: web_serial (ESP Web Tools), pairing_code (Netflix-style), improv_wifi, admin_assigned';
```

### 1.3 Add Webex User Profile Fields

```sql
-- Migration: 20260203000002_add_webex_profile_fields.sql

ALTER TABLE display.user_profiles
    ADD COLUMN IF NOT EXISTS webex_user_id TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS webex_email TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'email' 
        CHECK (auth_provider IN ('email', 'webex'));

CREATE INDEX idx_user_profiles_webex_id ON display.user_profiles(webex_user_id) 
    WHERE webex_user_id IS NOT NULL;

COMMENT ON COLUMN display.user_profiles.webex_user_id IS 
    'Webex user ID from OAuth (sub claim in ID token)';
COMMENT ON COLUMN display.user_profiles.auth_provider IS 
    'How user authenticated: email (password) or webex (OAuth)';
```

### 1.4 RLS Policies for Pairing Codes

```sql
-- Migration: 20260203000003_pairing_codes_rls.sql

ALTER TABLE display.device_pairing_codes ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for device polling)
CREATE POLICY "pairing_codes_service" ON display.device_pairing_codes
    FOR ALL USING (auth.role() = 'service_role');

-- Admins can see all pairing codes
CREATE POLICY "pairing_codes_admin" ON display.device_pairing_codes
    FOR ALL USING (display.is_admin());

-- Users can see their own linked codes
CREATE POLICY "pairing_codes_user_select" ON display.device_pairing_codes
    FOR SELECT USING (linked_user_id = auth.uid());

-- Users can link codes to themselves (update unlinked codes)
CREATE POLICY "pairing_codes_user_link" ON display.device_pairing_codes
    FOR UPDATE USING (
        linked_user_id IS NULL  -- Only unlinked codes
        AND expires_at > NOW()  -- Not expired
    )
    WITH CHECK (linked_user_id = auth.uid());
```

### 1.5 Cleanup Function

```sql
-- Migration: 20260203000004_pairing_codes_cleanup.sql

CREATE OR REPLACE FUNCTION display.cleanup_expired_pairing_codes()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete expired, unlinked codes
    DELETE FROM display.device_pairing_codes
    WHERE expires_at < NOW()
    AND linked_user_id IS NULL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION display.cleanup_expired_pairing_codes IS 
    'Removes expired pairing codes that were never linked to a user';
```

### Acceptance Criteria
- [ ] All migrations apply cleanly to dev and prod
- [ ] RLS policies verified with test queries
- [ ] Existing data unaffected
- [ ] Rollback scripts tested

---

## Phase 2: Webex OAuth for User Login
**Duration**: 2 sprints | **Team**: Frontend + Backend Engineer | **Dependencies**: Phase 0, Phase 1

### 2.1 Edge Function: `webex-user-login`

```typescript
// supabase/functions/webex-user-login/index.ts
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

const WEBEX_AUTH_URL = 'https://webexapis.com/v1/authorize';

interface LoginRequest {
  redirect_uri?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const clientId = Deno.env.get('WEBEX_CLIENT_ID');
  const defaultRedirect = Deno.env.get('WEBEX_REDIRECT_URI');
  
  if (!clientId || !defaultRedirect) {
    return new Response(JSON.stringify({ error: 'Webex OAuth not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const body: LoginRequest = await req.json().catch(() => ({}));
  const redirectUri = body.redirect_uri || defaultRedirect;

  // Generate state with CSRF protection
  const state = btoa(JSON.stringify({
    nonce: crypto.randomUUID(),
    ts: Math.floor(Date.now() / 1000),
    redirect: redirectUri,
    flow: 'user_login'  // Distinguish from device pairing
  }));

  // Generate PKCE code verifier and challenge
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Store code verifier for callback (in session or temp storage)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Store PKCE verifier temporarily (5 min expiry)
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

  return new Response(JSON.stringify({ auth_url: authUrl.toString() }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
```

### 2.2 Edge Function: `webex-user-callback`

```typescript
// supabase/functions/webex-user-callback/index.ts
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

const WEBEX_TOKEN_URL = 'https://webexapis.com/v1/access_token';
const WEBEX_USERINFO_URL = 'https://webexapis.com/v1/userinfo';

interface CallbackRequest {
  code: string;
  state: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const body: CallbackRequest = await req.json();
  
  if (!body.code || !body.state) {
    return new Response(JSON.stringify({ error: 'Missing code or state' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Validate state and get PKCE verifier
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: stateData, error: stateError } = await supabase
    .from('display.oauth_state')
    .select('code_verifier, expires_at')
    .eq('state_key', body.state)
    .single();

  if (stateError || !stateData) {
    return new Response(JSON.stringify({ error: 'Invalid state' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (new Date(stateData.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: 'State expired' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Clean up state
  await supabase.from('display.oauth_state').delete().eq('state_key', body.state);

  // Decode state to get redirect URI
  let stateObj;
  try {
    stateObj = JSON.parse(atob(body.state));
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid state format' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Exchange code for tokens
  const clientId = Deno.env.get('WEBEX_CLIENT_ID')!;
  const clientSecret = Deno.env.get('WEBEX_CLIENT_SECRET')!;

  const tokenResponse = await fetch(WEBEX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: body.code,
      redirect_uri: stateObj.redirect,
      code_verifier: stateData.code_verifier
    })
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    console.error('Token exchange failed:', err);
    return new Response(JSON.stringify({ error: 'Token exchange failed' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const tokens = await tokenResponse.json();

  // Get user info from Webex
  const userInfoResponse = await fetch(WEBEX_USERINFO_URL, {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` }
  });

  if (!userInfoResponse.ok) {
    return new Response(JSON.stringify({ error: 'Failed to get user info' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const webexUser = await userInfoResponse.json();

  // Check if user exists, create or update
  const { data: existingProfile } = await supabase
    .schema('display')
    .from('user_profiles')
    .select('user_id')
    .eq('webex_user_id', webexUser.sub)
    .single();

  let userId: string;

  if (existingProfile) {
    // Update existing profile
    userId = existingProfile.user_id;
    await supabase.schema('display').from('user_profiles').update({
      email: webexUser.email,
      display_name: webexUser.name,
      webex_email: webexUser.email,
      auth_provider: 'webex'
    }).eq('user_id', userId);
  } else {
    // Check if email exists (might have been created as admin)
    const { data: emailProfile } = await supabase
      .schema('display')
      .from('user_profiles')
      .select('user_id')
      .eq('email', webexUser.email)
      .single();

    if (emailProfile) {
      // Link Webex to existing account
      userId = emailProfile.user_id;
      await supabase.schema('display').from('user_profiles').update({
        webex_user_id: webexUser.sub,
        webex_email: webexUser.email,
        display_name: webexUser.name,
        auth_provider: 'webex'
      }).eq('user_id', userId);
    } else {
      // Create new Supabase Auth user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: webexUser.email,
        email_confirm: true,
        user_metadata: {
          webex_user_id: webexUser.sub,
          name: webexUser.name,
          avatar_url: webexUser.avatar
        }
      });

      if (createError || !newUser.user) {
        return new Response(JSON.stringify({ error: 'Failed to create user' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      userId = newUser.user.id;

      // Create user profile
      await supabase.schema('display').from('user_profiles').insert({
        user_id: userId,
        email: webexUser.email,
        webex_user_id: webexUser.sub,
        webex_email: webexUser.email,
        display_name: webexUser.name,
        avatar_url: webexUser.avatar,
        role: 'user',
        auth_provider: 'webex'
      });
    }
  }

  // Generate Supabase session for the user
  const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: webexUser.email
  });

  if (sessionError) {
    return new Response(JSON.stringify({ error: 'Failed to create session' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    success: true,
    user: {
      id: userId,
      email: webexUser.email,
      name: webexUser.name
    },
    redirect_url: sessionData.properties?.hashed_token 
      ? `/auth/verify?token=${sessionData.properties.hashed_token}`
      : '/user'
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
```

### 2.3 OAuth State Storage Table

```sql
-- Migration: 20260203000005_oauth_state_storage.sql

CREATE TABLE IF NOT EXISTS display.oauth_state (
    state_key TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_oauth_state_expires ON display.oauth_state(expires_at);

-- Auto-cleanup function
CREATE OR REPLACE FUNCTION display.cleanup_expired_oauth_state()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM display.oauth_state WHERE expires_at < NOW();
END;
$$;
```

### 2.4 Frontend: Login Page with Webex

```tsx
// website/src/app/login/page.tsx
'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClientComponentClient();

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    window.location.href = '/user';
  };

  const handleWebexLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/webex-user-login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            redirect_uri: `${window.location.origin}/auth/callback`
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start login');
      }

      window.location.href = data.auth_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Manage your LED display devices
          </p>
        </div>

        {/* Webex Login Button */}
        <button
          onClick={handleWebexLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            {/* Webex logo SVG */}
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 21.6c-5.302 0-9.6-4.298-9.6-9.6S6.698 2.4 12 2.4s9.6 4.298 9.6 9.6-4.298 9.6-9.6 9.6z"/>
          </svg>
          <span className="font-medium">Continue with Webex</span>
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-50 text-gray-500">Or continue with email</span>
          </div>
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in with Email'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          Admin? <Link href="/admin/login" className="text-blue-600 hover:underline">
            Go to Admin Portal
          </Link>
        </p>
      </div>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Users can log in with Webex OAuth
- [ ] Users can log in with email/password (existing accounts)
- [ ] Webex users get profile created automatically
- [ ] Existing email accounts can be linked to Webex
- [ ] PKCE flow implemented for security
- [ ] Session created after successful OAuth

---

## Phase 3: User Portal & Dashboard
**Duration**: 2 sprints | **Team**: Frontend Engineer | **Dependencies**: Phase 2

### 3.1 User Layout Shell

```tsx
// website/src/app/user/UserShell.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, signOut, isAdmin } from '@/lib/supabase/auth';
import Link from 'next/link';

interface UserProfile {
  email: string;
  display_name?: string;
  avatar_url?: string;
  role: string;
}

export default function UserShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }

      // Fetch user profile
      const supabase = (await import('@/lib/supabaseClient')).default;
      const { data: profileData } = await supabase
        .schema('display')
        .from('user_profiles')
        .select('email, display_name, avatar_url, role')
        .eq('user_id', session.user.id)
        .single();

      setProfile(profileData);
      setIsAdminUser(await isAdmin());
      setLoading(false);
    }

    checkAuth();
  }, [router]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link href="/user" className="text-xl font-bold text-gray-900">
                LED Display
              </Link>
              <Link href="/user/devices" className="text-gray-600 hover:text-gray-900">
                My Devices
              </Link>
              <Link href="/user/link-device" className="text-gray-600 hover:text-gray-900">
                Link Device
              </Link>
            </div>

            <div className="flex items-center space-x-4">
              {isAdminUser && (
                <Link href="/admin" className="text-blue-600 hover:text-blue-700 text-sm">
                  Admin Portal
                </Link>
              )}
              
              <div className="flex items-center space-x-2">
                {profile?.avatar_url && (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <span className="text-sm text-gray-700">
                  {profile?.display_name || profile?.email}
                </span>
              </div>

              <button
                onClick={handleSignOut}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
```

### 3.2 User Dashboard

```tsx
// website/src/app/user/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import UserShell from './UserShell';

interface DeviceSummary {
  total: number;
  online: number;
  offline: number;
}

export default function UserDashboard() {
  const [summary, setSummary] = useState<DeviceSummary>({ total: 0, online: 0, offline: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSummary() {
      const supabase = (await import('@/lib/supabaseClient')).default;
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) return;

      // Get user's devices
      const { data: assignments } = await supabase
        .schema('display')
        .from('user_devices')
        .select('serial_number, devices!inner(last_seen)')
        .eq('user_id', session.user.id);

      if (assignments) {
        const now = new Date();
        const onlineThreshold = 5 * 60 * 1000; // 5 minutes
        
        const online = assignments.filter((a: any) => {
          const lastSeen = new Date(a.devices.last_seen);
          return now.getTime() - lastSeen.getTime() < onlineThreshold;
        }).length;

        setSummary({
          total: assignments.length,
          online,
          offline: assignments.length - online
        });
      }
      
      setLoading(false);
    }

    loadSummary();
  }, []);

  return (
    <UserShell>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">Total Devices</div>
          <div className="text-3xl font-bold text-gray-900">{summary.total}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">Online</div>
          <div className="text-3xl font-bold text-green-600">{summary.online}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">Offline</div>
          <div className="text-3xl font-bold text-gray-400">{summary.offline}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          href="/user/devices"
          className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
        >
          <h3 className="text-lg font-semibold text-gray-900">Manage Devices</h3>
          <p className="text-gray-600 mt-1">View and manage your connected displays</p>
        </Link>

        <Link
          href="/user/link-device"
          className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
        >
          <h3 className="text-lg font-semibold text-gray-900">Link New Device</h3>
          <p className="text-gray-600 mt-1">Add a new display using a pairing code</p>
        </Link>
      </div>

      {summary.total === 0 && !loading && (
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
          <h3 className="text-lg font-medium text-blue-900">No devices yet</h3>
          <p className="text-blue-700 mt-1">
            Get started by linking your first LED display.
          </p>
          <Link
            href="/user/link-device"
            className="inline-block mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Link Device
          </Link>
        </div>
      )}
    </UserShell>
  );
}
```

### 3.3 User Device List

```tsx
// website/src/app/user/devices/page.tsx
'use client';

import { useEffect, useState } from 'react';
import UserShell from '../UserShell';

interface UserDevice {
  serial_number: string;
  provisioning_method: string;
  created_at: string;
  device: {
    device_id: string;
    display_name: string | null;
    firmware_version: string | null;
    last_seen: string;
  };
}

export default function UserDevicesPage() {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDevices() {
      const supabase = (await import('@/lib/supabaseClient')).default;
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) return;

      const { data, error } = await supabase
        .schema('display')
        .from('user_devices')
        .select(`
          serial_number,
          provisioning_method,
          created_at,
          devices!inner (
            device_id,
            display_name,
            firmware_version,
            last_seen
          )
        `)
        .eq('user_id', session.user.id);

      if (!error && data) {
        setDevices(data.map((d: any) => ({
          serial_number: d.serial_number,
          provisioning_method: d.provisioning_method,
          created_at: d.created_at,
          device: d.devices
        })));
      }
      
      setLoading(false);
    }

    loadDevices();
  }, []);

  const getStatusColor = (lastSeen: string) => {
    const now = new Date();
    const seen = new Date(lastSeen);
    const diff = now.getTime() - seen.getTime();
    
    if (diff < 5 * 60 * 1000) return 'bg-green-500'; // Online
    if (diff < 30 * 60 * 1000) return 'bg-yellow-500'; // Recently seen
    return 'bg-gray-400'; // Offline
  };

  if (loading) {
    return (
      <UserShell>
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </UserShell>
    );
  }

  return (
    <UserShell>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Devices</h1>
        <a
          href="/user/link-device"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Link New Device
        </a>
      </div>

      {devices.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-600">You haven't linked any devices yet.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {devices.map((device) => (
            <div key={device.serial_number} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(device.device.last_seen)}`} />
                    <h3 className="text-lg font-semibold">
                      {device.device.display_name || device.device.device_id}
                    </h3>
                  </div>
                  <div className="mt-2 text-sm text-gray-600 space-y-1">
                    <p>Serial: {device.serial_number}</p>
                    <p>Firmware: {device.device.firmware_version || 'Unknown'}</p>
                    <p>Last seen: {new Date(device.device.last_seen).toLocaleString()}</p>
                    <p>Added: {new Date(device.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">
                  {device.provisioning_method === 'pairing_code' ? 'Pairing Code' :
                   device.provisioning_method === 'web_serial' ? 'Web Install' :
                   device.provisioning_method === 'admin_assigned' ? 'Admin Assigned' :
                   device.provisioning_method || 'Unknown'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </UserShell>
  );
}
```

### Acceptance Criteria
- [ ] User dashboard shows device summary
- [ ] User can view list of their devices
- [ ] Device status (online/offline) displayed
- [ ] Navigation between user pages works
- [ ] Admin users see link to admin portal
- [ ] Users cannot access other users' devices

---

## Phase 4: Netflix-Style Device Linking
**Duration**: 1 sprint | **Team**: Full-Stack Engineer | **Dependencies**: Phase 1

### 4.1 Edge Function: `register-pairing-code`

Called by device to register a new pairing code.

```typescript
// supabase/functions/register-pairing-code/index.ts
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { validateHmacRequest } from '../_shared/hmac.ts';

interface RegisterRequest {
  serial_number: string;
  pairing_code: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Validate device HMAC signature
  const validationResult = await validateHmacRequest(req);
  if (!validationResult.valid) {
    return new Response(JSON.stringify({ error: validationResult.error }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const body: RegisterRequest = await req.json();

  if (!body.pairing_code || body.pairing_code.length !== 6) {
    return new Response(JSON.stringify({ error: 'Invalid pairing code format' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Expire old codes for this device
  await supabase
    .schema('display')
    .from('device_pairing_codes')
    .update({ expires_at: new Date().toISOString() })
    .eq('serial_number', validationResult.serial)
    .is('linked_user_id', null);

  // Insert new pairing code (1 hour expiry)
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  const { error: insertError } = await supabase
    .schema('display')
    .from('device_pairing_codes')
    .insert({
      pairing_code: body.pairing_code.toUpperCase(),
      serial_number: validationResult.serial,
      expires_at: expiresAt.toISOString()
    });

  if (insertError) {
    // Check if code already exists (collision)
    if (insertError.code === '23505') {
      return new Response(JSON.stringify({ error: 'Code collision, generate new code' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    throw insertError;
  }

  return new Response(JSON.stringify({
    success: true,
    expires_at: expiresAt.toISOString()
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
```

### 4.2 Edge Function: `poll-provisioning-token`

Called by device every 10 seconds.

```typescript
// supabase/functions/poll-provisioning-token/index.ts
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(req.url);
  const pairingCode = url.searchParams.get('code')?.toUpperCase();

  if (!pairingCode || pairingCode.length !== 6) {
    return new Response(JSON.stringify({ error: 'Invalid pairing code' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Update last_poll_at and get code data
  const { data: codeData, error } = await supabase
    .schema('display')
    .from('device_pairing_codes')
    .update({ last_poll_at: new Date().toISOString() })
    .eq('pairing_code', pairingCode)
    .select('id, linked_user_id, provisioning_token, expires_at, token_used_at')
    .single();

  if (error || !codeData) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Pairing code not found'
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check expiry
  if (new Date(codeData.expires_at) < new Date()) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Pairing code expired'
    }), {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check if already used
  if (codeData.token_used_at) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Pairing code already used'
    }), {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check if user has linked
  if (!codeData.linked_user_id || !codeData.provisioning_token) {
    return new Response(JSON.stringify({
      success: false,
      linked: false,
      message: 'Waiting for user to link device'
    }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Token available!
  return new Response(JSON.stringify({
    success: true,
    linked: true,
    provisioning_token: codeData.provisioning_token
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
```

### 4.3 Edge Function: `link-device`

Called by website when user enters pairing code.

```typescript
// supabase/functions/link-device/index.ts
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

interface LinkRequest {
  pairing_code: string;
}

function generateProvisioningToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (let i = 0; i < 8; i++) {
    token += chars[array[i] % chars.length];
  }
  return token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Requires user authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Verify user token
  const userSupabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await userSupabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid auth token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const body: LinkRequest = await req.json();
  const pairingCode = body.pairing_code?.toUpperCase();

  if (!pairingCode || pairingCode.length !== 6) {
    return new Response(JSON.stringify({ error: 'Invalid pairing code format' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Find pairing code
  const { data: codeData, error: lookupError } = await supabase
    .schema('display')
    .from('device_pairing_codes')
    .select('id, serial_number, linked_user_id, expires_at, token_used_at')
    .eq('pairing_code', pairingCode)
    .single();

  if (lookupError || !codeData) {
    return new Response(JSON.stringify({
      error: 'Pairing code not found. Check the code on your device.'
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check expiry
  if (new Date(codeData.expires_at) < new Date()) {
    return new Response(JSON.stringify({
      error: 'Pairing code expired. Reboot device for new code.'
    }), {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check if already linked
  if (codeData.linked_user_id) {
    return new Response(JSON.stringify({
      error: 'This code has already been used.'
    }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check if already provisioned (used)
  if (codeData.token_used_at) {
    return new Response(JSON.stringify({
      error: 'This code has already been used.'
    }), {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Generate provisioning token
  const provisioningToken = generateProvisioningToken();
  const tokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Link code to user
  const { error: updateError } = await supabase
    .schema('display')
    .from('device_pairing_codes')
    .update({
      linked_user_id: user.id,
      linked_at: new Date().toISOString(),
      provisioning_token: provisioningToken,
      token_expires_at: tokenExpiresAt.toISOString()
    })
    .eq('id', codeData.id);

  if (updateError) {
    return new Response(JSON.stringify({ error: 'Failed to link device' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    success: true,
    message: 'Device linked! It will provision automatically in a few seconds.',
    serial_number: codeData.serial_number
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
```

### 4.4 Frontend: Link Device Page

```tsx
// website/src/app/user/link-device/page.tsx
'use client';

import { useState } from 'react';
import UserShell from '../UserShell';

export default function LinkDevicePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const linkDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      const supabase = (await import('@/lib/supabaseClient')).default;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError('Please log in first');
        setLoading(false);
        return;
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/link-device`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ pairing_code: code.toUpperCase() })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to link device');
      }

      setMessage('Device linked successfully! It will provision automatically in a few seconds.');
      setCode('');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link device');
    } finally {
      setLoading(false);
    }
  };

  return (
    <UserShell>
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Link Device</h1>

        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-600 mb-6 text-center">
            Enter the 6-character code displayed on your device's LED matrix
          </p>

          <form onSubmit={linkDevice} className="space-y-4">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(
                e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
              )}
              placeholder="ABC123"
              maxLength={6}
              className="w-full px-4 py-3 text-center text-2xl font-mono border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? 'Linking...' : 'Link Device'}
            </button>
          </form>

          {message && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
              {message}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h2 className="font-semibold mb-3">How it works:</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
            <li>Power on your device</li>
            <li>Look for a 6-character code on the LED display</li>
            <li>Enter the code above</li>
            <li>Device will automatically provision within 10 seconds</li>
          </ol>
        </div>
      </div>
    </UserShell>
  );
}
```

### Acceptance Criteria
- [ ] Device can register pairing code via Edge Function
- [ ] Device can poll for provisioning token
- [ ] User can enter pairing code on website
- [ ] Provisioning token generated when user links code
- [ ] Device receives token on next poll
- [ ] Expired codes rejected
- [ ] Used codes rejected

---

## Phase 5: Firmware Updates
**Duration**: 2 sprints | **Team**: Firmware Engineer | **Dependencies**: Phase 4

### 5.1 Pairing Code Manager

```cpp
// firmware/src/pairing/pairing_code_manager.h
#pragma once

#include <Arduino.h>

class PairingCodeManager {
public:
    static String generatePairingCode();
    static bool saveCode(const String& code);
    static String loadCode();
    static bool hasValidCode();
    static void clearCode();
    
    static bool registerCodeWithServer(const String& code);
    
private:
    static const char* NVS_KEY;
    static const char* ALLOWED_CHARS;
};

// firmware/src/pairing/pairing_code_manager.cpp
#include "pairing_code_manager.h"
#include "common/nvs_utils.h"
#include <esp_random.h>

const char* PairingCodeManager::NVS_KEY = "pair_code";
const char* PairingCodeManager::ALLOWED_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

String PairingCodeManager::generatePairingCode() {
    String code = "";
    for (int i = 0; i < 6; i++) {
        uint32_t random = esp_random() % 32;
        code += ALLOWED_CHARS[random];
    }
    return code;
}

bool PairingCodeManager::saveCode(const String& code) {
    return NVS_Utils::setString(NVS_KEY, code.c_str());
}

String PairingCodeManager::loadCode() {
    return NVS_Utils::getString(NVS_KEY, "");
}

bool PairingCodeManager::hasValidCode() {
    return loadCode().length() == 6;
}

void PairingCodeManager::clearCode() {
    NVS_Utils::erase(NVS_KEY);
}

bool PairingCodeManager::registerCodeWithServer(const String& code) {
    // Implementation calls register-pairing-code Edge Function
    // with HMAC authentication
    // Returns true if successful
}
```

### 5.2 Display Pairing Code on Matrix

```cpp
// firmware/src/display/display_pairing.h
#pragma once

#include <Arduino.h>

void displayPairingCode(const String& code);
void displayPairingPending();
void displayPairingSuccess();
void displayPairingError(const String& message);
```

### 5.3 Polling Loop

```cpp
// firmware/src/sync/provisioning_poll.cpp
// Polls every 10 seconds for provisioning token
// Implements exponential backoff on errors
// Displays status on LED matrix
```

### Acceptance Criteria
- [ ] Device generates 6-character pairing code on boot (if not provisioned)
- [ ] Pairing code displayed on LED matrix
- [ ] Pairing code printed to Serial
- [ ] Device registers code with server
- [ ] Device polls every 10 seconds
- [ ] Device provisions when token received
- [ ] Already provisioned devices skip pairing flow

---

## Phase 6: Update provision-device Edge Function
**Duration**: 1 sprint | **Team**: Backend Engineer | **Dependencies**: Phase 4, Phase 5

### Changes Required

1. Accept `provisioning_token` parameter
2. Validate token against `device_pairing_codes` table
3. Create `user_devices` entry linking user to device
4. Mark token as used (`token_used_at`)
5. Return success with pairing code

### Acceptance Criteria
- [ ] Token validated before provisioning
- [ ] User-device link created automatically
- [ ] Token marked as used (single-use)
- [ ] Invalid/expired tokens rejected
- [ ] Backward compatible with existing devices

---

## Phase 7: ESP Web Tools Integration (Optional)
**Duration**: 2 sprints | **Team**: Full-Stack Engineer | **Dependencies**: Phase 6

### 7.1 Install Page with Web Serial

Implementation of firmware flashing via browser using esptool-js.

### 7.2 Auto-provisioning Flow

After flashing, automatically send provisioning token via Serial.

### Acceptance Criteria
- [ ] Users can flash firmware from browser
- [ ] WiFi configured via ESP Web Tools UI
- [ ] Device auto-provisions after flash
- [ ] Progress displayed during flash
- [ ] Error handling for failed flashes

---

## Phase Dependencies Diagram

```
Phase 0: Prerequisites (Webex Integration Setup)
    │
    ├─────────────────────────────────────────────┐
    │                                             │
    v                                             v
Phase 1: Database Schema               Phase 2: Webex OAuth Login
    │                                             │
    │                                             v
    │                                   Phase 3: User Portal
    │                                             │
    ├─────────────────────────────────────────────┤
    │                                             │
    v                                             │
Phase 4: Netflix Device Linking <─────────────────┘
    │
    ├─────────────────────────────────────────────┐
    │                                             │
    v                                             v
Phase 5: Firmware Updates              Phase 6: Update provision-device
    │                                             │
    └─────────────────────────────────────────────┤
                                                  │
                                                  v
                                        Phase 7: ESP Web Tools (Optional)
```

---

## Team Assignments

| Phase | Team | Skills Required | Estimated Effort |
|-------|------|-----------------|------------------|
| 0 | Tech Lead | Webex Integration, Supabase Config | 2-3 days |
| 1 | Backend | SQL, Supabase Migrations | 1 week |
| 2 | Full-Stack | TypeScript, OAuth, Next.js | 2 weeks |
| 3 | Frontend | React, Next.js, UI/UX | 2 weeks |
| 4 | Full-Stack | TypeScript, Edge Functions, React | 1 week |
| 5 | Firmware | C++, ESP32, PlatformIO | 2 weeks |
| 6 | Backend | TypeScript, Edge Functions | 1 week |
| 7 | Full-Stack | Web Serial API, esptool-js | 2 weeks (optional) |

---

## Parallel Execution Strategy

### Sprint 1
- **Phase 0**: Tech Lead sets up Webex Integration
- **Phase 1**: Backend starts database migrations

### Sprint 2
- **Phase 2**: Full-Stack begins Webex OAuth
- **Phase 3**: Frontend begins user portal (can start in parallel with mocked auth)

### Sprint 3
- **Phase 4**: Full-Stack implements Netflix linking
- **Phase 5**: Firmware starts pairing code implementation

### Sprint 4
- **Phase 6**: Backend updates provision-device
- Integration testing begins

### Sprint 5+ (Optional)
- **Phase 7**: ESP Web Tools integration

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Webex OAuth complexity | Use PKCE flow, test manually first |
| Firmware OTA conflicts | Test provisioning flow on dedicated test devices |
| Token collision | 8-char tokens have ~2.8 trillion combinations, implement retry on collision |
| Rate limiting | Implement exponential backoff in firmware polling |
| Session management | Use Supabase's built-in session handling |

---

## Testing Strategy

### Unit Tests
- Database constraints and RLS policies
- Token generation (uniqueness, format)
- HMAC validation
- JWT claims

### Integration Tests
- OAuth flow end-to-end
- Device polling and provisioning
- User-device linking

### End-to-End Tests
- Full provisioning flow (device → user → provisioned)
- Multiple devices per user
- Admin vs user access control

---

## Success Metrics

1. **Security**: Zero unauthorized device provisioning
2. **UX**: Device linked in < 30 seconds after code entry
3. **Reliability**: 99%+ provisioning success rate
4. **Multi-device**: Users can manage 5+ devices
