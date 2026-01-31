# Supabase Authentication Flow Validation

## Singleton Pattern Implementation

### ✅ Main Supabase Client (User Authentication)
**File**: `website/src/lib/supabaseClient.ts`

- **Pattern**: Global singleton using `globalThis.__supabaseClient`
- **Usage**: All user authentication flows
- **Configuration**:
  - `persistSession: true` - Sessions persist across page reloads
  - `autoRefreshToken: true` - Tokens auto-refresh
  - `detectSessionInUrl: true` - Handles OAuth callbacks

### ✅ Embedded App Client (Device Pairing Authentication)
**File**: `website/src/app/embedded/EmbeddedAppClient.tsx`

- **Pattern**: Component-level singleton using `useRef`
- **Usage**: Device pairing token authentication (different from user auth)
- **Configuration**:
  - `persistSession: false` - No session persistence needed
  - `autoRefreshToken: false` - Tokens managed manually
  - `detectSessionInUrl: false` - No OAuth flow
  - Custom auth header with device pairing token

**Note**: This is intentionally separate because it uses device pairing tokens, not user session tokens.

## Login Flows Validation

### 1. ✅ Admin Login (`/admin/login`)
**File**: `website/src/app/admin/login/page.tsx`

- Uses `signIn()` from `@/lib/supabase` ✅
- `signIn()` calls `getSupabase()` ✅
- `getSupabase()` calls `getSupabaseClient()` ✅
- **Singleton**: ✅ Uses global singleton

**Flow**:
```
Login Page → signIn() → getSupabase() → getSupabaseClient() → globalThis.__supabaseClient
```

### 2. ✅ Logout (`/admin` and Avatar component)
**Files**: 
- `website/src/app/admin/AdminShell.tsx`
- `website/src/components/layout/Avatar.tsx`

- Uses `signOut()` from `@/lib/supabase` ✅
- `signOut()` calls `getSupabase()` ✅
- **Singleton**: ✅ Uses global singleton

**Flow**:
```
Logout → signOut() → getSupabase() → getSupabaseClient() → globalThis.__supabaseClient
```

### 3. ✅ Session Check (All protected pages)
**Files**:
- `website/src/app/admin/AdminShell.tsx`
- `website/src/components/layout/Avatar.tsx`

- Uses `getSession()` from `@/lib/supabase` ✅
- `getSession()` calls `getSupabase()` ✅
- **Singleton**: ✅ Uses global singleton

**Flow**:
```
Session Check → getSession() → getSupabase() → getSupabaseClient() → globalThis.__supabaseClient
```

### 4. ✅ Auth State Change Listener
**Files**:
- `website/src/app/admin/AdminShell.tsx`
- `website/src/components/layout/Avatar.tsx`

- Uses `onAuthStateChange()` from `@/lib/supabase` ✅
- `onAuthStateChange()` calls `getSupabase()` ✅
- **Singleton**: ✅ Uses global singleton

**Flow**:
```
Auth Listener → onAuthStateChange() → getSupabase() → getSupabaseClient() → globalThis.__supabaseClient
```

### 5. ✅ User Profile Check
**Files**:
- `website/src/app/admin/AdminShell.tsx`
- `website/src/app/admin/login/page.tsx`

- Uses `getCurrentUserProfile()` from `@/lib/supabase` ✅
- `getCurrentUserProfile()` calls `getUser()` → `getSupabase()` ✅
- **Singleton**: ✅ Uses global singleton

### 6. ✅ Admin Permission Check
**File**: `website/src/app/admin/AdminShell.tsx`

- Uses `isAdmin()` from `@/lib/supabase` ✅
- `isAdmin()` calls `getSupabase()` ✅
- **Singleton**: ✅ Uses global singleton

## All Authentication Functions

| Function | File | Uses Singleton? | Notes |
|----------|------|------------------|-------|
| `signIn()` | `supabase.ts:447` | ✅ Yes | Calls `getSupabase()` |
| `signOut()` | `supabase.ts:452` | ✅ Yes | Calls `getSupabase()` |
| `getSession()` | `supabase.ts:457` | ✅ Yes | Calls `getSupabase()` |
| `getUser()` | `supabase.ts:504` | ✅ Yes | Calls `getSupabase()` |
| `onAuthStateChange()` | `supabase.ts:514` | ✅ Yes | Calls `getSupabase()` |
| `isAdmin()` | `supabase.ts:521` | ✅ Yes | Calls `getSupabase()` |
| `getCurrentUserProfile()` | `supabase.ts:652` | ✅ Yes | Calls `getSupabase()` |
| `getSupabase()` | `supabase.ts:91` | ✅ Yes | Calls `getSupabaseClient()` |
| `getSupabaseClient()` | `supabaseClient.ts:12` | ✅ Yes | Returns singleton |

## Direct Client Creation (Intentionally Separate)

| Location | Pattern | Reason |
|----------|---------|--------|
| `EmbeddedAppClient.tsx:332` | Component singleton (`useRef`) | Uses device pairing token, not user session |

## Validation Results

✅ **All user authentication flows use the singleton pattern**
✅ **No duplicate client creation for user auth**
✅ **Embedded app uses separate singleton (intentional and correct)**
✅ **All login/logout/session checks use the same singleton instance**

## Recommendations

1. ✅ **Current implementation is correct** - All user auth flows use the global singleton
2. ✅ **Embedded app separation is intentional** - Device pairing tokens require a separate client instance
3. ✅ **No changes needed** - Singleton pattern is properly implemented

## Testing Checklist

- [x] Login page uses singleton
- [x] Logout uses singleton
- [x] Session checks use singleton
- [x] Auth state listeners use singleton
- [x] Admin checks use singleton
- [x] User profile checks use singleton
- [x] Embedded app uses separate singleton (correct)

## Conclusion

**All Supabase login flows are validated and using the singleton pattern correctly.**

The singleton ensures:
- Single client instance per browser session
- Consistent session state across components
- Proper token refresh handling
- Efficient resource usage
