import {
  SUPABASE_AUTH_TIMEOUT_MS,
  getCachedSessionFromStorage,
  getStorageKeyForSession,
  getSupabase,
  isAbortError,
  supabaseAnonKey,
  supabaseUrl,
  withTimeout,
} from "./core";

let sessionCheckPromise: Promise<any> | null = null;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getAdminClaimFromSession(session: {
  user?: { app_metadata?: Record<string, unknown> };
  access_token?: string;
} | null | undefined): boolean | undefined {
  if (!session) return undefined;
  const appMetadataClaim = session.user?.app_metadata?.is_admin;
  if (appMetadataClaim !== undefined) return Boolean(appMetadataClaim);

  const token = session.access_token;
  if (!token) return undefined;
  const payload = decodeJwtPayload(token);
  if (!payload) return undefined;
  if (payload.is_admin !== undefined) return Boolean(payload.is_admin);
  const tokenAppMeta = (payload as { app_metadata?: { is_admin?: unknown } }).app_metadata?.is_admin;
  if (tokenAppMeta !== undefined) return Boolean(tokenAppMeta);
  return undefined;
}

// Auth helpers
export async function signIn(email: string, password: string) {
  const supabase = await getSupabase();
  // Don't wrap signIn in timeout - let Supabase handle its own timeouts
  // The timeout wrapper can cause AbortErrors that interfere with login
  const result = await supabase.auth.signInWithPassword({ email, password });
  if (typeof window !== "undefined" && result.data?.session) {
    const storageKey = getStorageKeyForSession();
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(result.data.session));
      } catch {
        // Ignore storage failures (private mode or disabled storage)
      }
    }
  }
  if (result.error && process.env.NODE_ENV !== "production") {
    await logAuthFailure(email, password);
  }
  return result;
}

async function logAuthFailure(email: string, password: string) {
  if (!supabaseUrl || !supabaseAnonKey) return;

  try {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          "x-supabase-client-platform": "debug",
        },
        body: JSON.stringify({
          email,
          password,
          gotrue_meta_security: {},
        }),
      },
    );
    const bodyText = await response.text();
    console.error("Supabase auth token request failed", {
      status: response.status,
      statusText: response.statusText,
      body: bodyText,
    });
  } catch (err) {
    console.error("Supabase auth token request failed (network error)", err);
  }
}

export async function signOut() {
  const supabase = await getSupabase();
  return supabase.auth.signOut();
}

export async function getSession(signal?: AbortSignal) {
  console.log('[getSession] Starting session check');
  const supabase = await getSupabase();

  // If already aborted, return immediately
  if (signal?.aborted) {
    console.log('[getSession] Signal already aborted');
    throw new DOMException('Aborted', 'AbortError');
  }

  if (sessionCheckPromise) {
    console.log('[getSession] Returning existing session check promise');
    return sessionCheckPromise;
  }

  sessionCheckPromise = (async () => {
    const cachedSession = getCachedSessionFromStorage();
    console.log('[getSession] Cached session from storage:', cachedSession ? 'found' : 'none');
    if (cachedSession) {
      if (typeof cachedSession.expires_at !== "number") {
        console.log('[getSession] Cached session missing expiry; returning immediately');
        return { data: { session: cachedSession }, error: null };
      }
      const expiresAtMs = cachedSession.expires_at * 1000;
      const expiresSoon = expiresAtMs - Date.now() < 60_000;
      if (!expiresSoon) {
        console.log('[getSession] Returning cached session immediately');
        return { data: { session: cachedSession }, error: null };
      }
      console.log('[getSession] Cached session expires soon; refreshing');
    }

    try {
      console.log('[getSession] Calling supabase.auth.getSession()');
      const startTime = Date.now();
      const result = await withTimeout(
        supabase.auth.getSession(),
        SUPABASE_AUTH_TIMEOUT_MS,
        "Timed out while checking your session.",
        signal,
      );
      console.log('[getSession] supabase.auth.getSession() completed in', Date.now() - startTime, 'ms');
      if (result.data?.session) {
        return result;
      }
      if (cachedSession?.access_token && cachedSession?.refresh_token) {
        try {
          await supabase.auth.setSession({
            access_token: cachedSession.access_token,
            refresh_token: cachedSession.refresh_token,
          });
          return await supabase.auth.getSession();
        } catch {
          return { data: { session: cachedSession }, error: null };
        }
      }
      return result;
    } catch (err) {
      // Handle AbortError gracefully (can happen in React Strict Mode or component unmount)
      if (isAbortError(err)) {
        // Return empty session instead of throwing - component unmounted
        console.debug("getSession aborted (likely component unmounted)");
        sessionCheckPromise = null;
        throw err;
      }

      if (cachedSession) {
        return { data: { session: cachedSession }, error: null };
      }

      const message = err instanceof Error ? err.message : "";
      if (!message.includes("Timed out")) {
        throw err;
      }

      try {
        await withTimeout(
          supabase.auth.refreshSession(),
          SUPABASE_AUTH_TIMEOUT_MS,
          "Timed out while refreshing your session.",
          signal,
        );
      } catch (refreshErr) {
        // Handle AbortError gracefully
        if (isAbortError(refreshErr)) {
          sessionCheckPromise = null;
          return { data: { session: null }, error: null };
        }
        if (cachedSession) {
          return { data: { session: cachedSession }, error: null };
        }
        console.warn("Supabase session refresh timed out, falling back to direct session fetch.");
      }

      try {
        return await withTimeout(
          supabase.auth.getSession(),
          SUPABASE_AUTH_TIMEOUT_MS,
          "Timed out while checking your session.",
          signal,
        );
      } catch (finalErr) {
        // Handle AbortError gracefully
        if (isAbortError(finalErr)) {
          sessionCheckPromise = null;
          return { data: { session: null }, error: null };
        }
        if (cachedSession) {
          return { data: { session: cachedSession }, error: null };
        }
        console.warn("Supabase session check still timing out; returning empty session.");
        return { data: { session: null }, error: new Error("Timed out while checking your session.") };
      }
    } finally {
      sessionCheckPromise = null;
    }
  })();

  return sessionCheckPromise;
}

export async function getUser(signal?: AbortSignal) {
  console.log('[getUser] Starting user fetch');
  const supabase = await getSupabase();

  // Check if signal is already aborted
  if (signal?.aborted) {
    console.log('[getUser] Signal already aborted');
    return null;
  }

  try {
    console.log('[getUser] Calling supabase.auth.getUser()');
    const startTime = Date.now();
    const { data: { user } } = await withTimeout(
      supabase.auth.getUser(),
      SUPABASE_AUTH_TIMEOUT_MS,
      "Timed out while fetching user details.",
      signal,
    );
    console.log('[getUser] supabase.auth.getUser() completed in', Date.now() - startTime, 'ms');
    return user;
  } catch (err) {
    // Handle AbortError gracefully (can happen in React Strict Mode or component unmount)
    if (isAbortError(err)) {
      // Return null instead of throwing - component unmounted, no need to error
      console.debug("[getUser] aborted (likely component unmounted)");
      return null;
    }
    if (err instanceof Error && err.message.includes("Timed out")) {
      console.warn("[getUser] timed out after", SUPABASE_AUTH_TIMEOUT_MS, "ms; continuing without user details.");
      return null;
    }
    console.error('[getUser] Unexpected error:', err);
    throw err;
  }
}

export async function onAuthStateChange(
  callback: (event: string, session: unknown) => void,
) {
  const supabase = await getSupabase();
  return supabase.auth.onAuthStateChange(callback);
}

export async function isAdmin(signal?: AbortSignal): Promise<boolean> {
  console.log('[isAdmin] Starting admin check');

  // Check if signal is already aborted
  if (signal?.aborted) {
    console.log('[isAdmin] Signal already aborted');
    return false;
  }

  try {
    const cachedSession = getCachedSessionFromStorage();
    const cachedClaim = getAdminClaimFromSession(cachedSession);
    if (cachedClaim !== undefined) {
      console.log('[isAdmin] Using cached JWT claim:', cachedClaim);
      return cachedClaim;
    }

    // Fall back to live session only if claim is missing from cache
    const sessionResult = await getSession(signal);
    const sessionClaim = getAdminClaimFromSession(sessionResult?.data?.session);
    if (sessionClaim !== undefined) {
      console.log('[isAdmin] Using JWT claim:', sessionClaim);
      return sessionClaim;
    }

    console.log('[isAdmin] JWT claim not found; skipping RPC fallback');
    return false;
  } catch (err) {
    // Handle AbortError gracefully (can happen in React Strict Mode or component unmount)
    if (isAbortError(err)) {
      console.debug("[isAdmin] aborted (likely component unmounted)");
      return false;
    }
    console.error('[isAdmin] Unexpected error:', err);
    throw err;
  }
}
