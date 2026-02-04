/**
 * Test Helper: Check Auth Claims
 * 
 * Utility function to verify that JWT claims (is_admin, disabled) are present
 * in the current user session. Useful for debugging auth hook configuration.
 * 
 * Usage:
 * ```typescript
 * import { checkAuthClaims } from '@/lib/test-claims';
 * 
 * const claims = await checkAuthClaims();
 * console.log('Is Admin:', claims.is_admin);
 * console.log('Disabled:', claims.disabled);
 * ```
 */

import { getSupabase } from './supabase/core';

export interface AuthClaims {
  is_admin: boolean | undefined;
  disabled: boolean | undefined;
  has_claims: boolean;
  raw_token?: string;
  decoded_payload?: Record<string, unknown>;
}

/**
 * Decode JWT payload without verification (for testing only)
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract claims from session
 */
function extractClaimsFromSession(session: {
  user?: { app_metadata?: Record<string, unknown> };
  access_token?: string;
} | null): AuthClaims {
  if (!session) {
    return {
      is_admin: undefined,
      disabled: undefined,
      has_claims: false,
    };
  }

  // Try to get claims from app_metadata first (most reliable)
  const appMetadata = session.user?.app_metadata;
  const isAdminFromMetadata = appMetadata?.is_admin;
  const disabledFromMetadata = appMetadata?.disabled;

  // Try to decode JWT token
  const token = session.access_token;
  let decodedPayload: Record<string, unknown> | null = null;
  let isAdminFromToken: boolean | undefined;
  let disabledFromToken: boolean | undefined;

  if (token) {
    decodedPayload = decodeJwtPayload(token);
    if (decodedPayload) {
      // Check direct claims
      if (decodedPayload.is_admin !== undefined) {
        isAdminFromToken = Boolean(decodedPayload.is_admin);
      }
      if (decodedPayload.disabled !== undefined) {
        disabledFromToken = Boolean(decodedPayload.disabled);
      }

      // Check app_metadata in token
      const tokenAppMeta = (decodedPayload as { app_metadata?: { is_admin?: unknown; disabled?: unknown } })
        .app_metadata;
      if (tokenAppMeta) {
        if (tokenAppMeta.is_admin !== undefined && isAdminFromToken === undefined) {
          isAdminFromToken = Boolean(tokenAppMeta.is_admin);
        }
        if (tokenAppMeta.disabled !== undefined && disabledFromToken === undefined) {
          disabledFromToken = Boolean(tokenAppMeta.disabled);
        }
      }
    }
  }

  // Prefer app_metadata values, fall back to token values
  const isAdmin = isAdminFromMetadata !== undefined ? Boolean(isAdminFromMetadata) : isAdminFromToken;
  const disabled = disabledFromMetadata !== undefined ? Boolean(disabledFromMetadata) : disabledFromToken;

  const hasClaims = isAdmin !== undefined || disabled !== undefined;

  return {
    is_admin: isAdmin,
    disabled: disabled,
    has_claims: hasClaims,
    raw_token: token,
    decoded_payload: decodedPayload || undefined,
  };
}

/**
 * Check auth claims from current session
 * 
 * @returns Promise resolving to claims object with is_admin, disabled, and metadata
 */
export async function checkAuthClaims(): Promise<AuthClaims> {
  try {
    const supabase = await getSupabase();
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error('[test-claims] Error getting session:', error);
      return {
        is_admin: undefined,
        disabled: undefined,
        has_claims: false,
      };
    }

    const claims = extractClaimsFromSession(session);
    return claims;
  } catch (error) {
    console.error('[test-claims] Unexpected error:', error);
    return {
      is_admin: undefined,
      disabled: undefined,
      has_claims: false,
    };
  }
}

/**
 * Log claims to console (for debugging)
 */
export async function logAuthClaims(): Promise<void> {
  const claims = await checkAuthClaims();
  
  console.group('🔐 Auth Claims Debug');
  console.log('Has Claims:', claims.has_claims);
  console.log('Is Admin:', claims.is_admin);
  console.log('Disabled:', claims.disabled);
  
  if (claims.decoded_payload) {
    console.log('JWT Payload:', claims.decoded_payload);
    console.log('App Metadata:', claims.decoded_payload.app_metadata);
  } else {
    console.warn('⚠️ Could not decode JWT token');
  }
  
  if (!claims.has_claims) {
    console.warn('⚠️ No claims found in session. Auth hook may not be configured.');
  }
  
  console.groupEnd();
}

/**
 * Browser console helper (for manual testing)
 * 
 * Call this from browser console:
 * ```javascript
 * // In browser console after importing
 * await logAuthClaims();
 * ```
 */
if (typeof window !== 'undefined') {
  // @ts-expect-error - Adding to window for browser console access
  window.checkAuthClaims = checkAuthClaims;
  // @ts-expect-error - Adding to window for browser console access
  window.logAuthClaims = logAuthClaims;
}
