import {
    SUPABASE_AUTH_TIMEOUT_MS,
    getCachedSessionFromStorage,
    getStorageKeyForSession,
    getSupabase,
    isAbortError,
    withTimeout
} from "./core";

/**
 * Cache for ongoing session check to prevent duplicate requests.
 * Type is complex union to accommodate both Supabase AuthResponse and cached session responses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionCheckPromise: Promise<any> | null = null;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
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
  return result;
}

export async function signOut() {
  const supabase = await getSupabase();
  return supabase.auth.signOut();
}

export async function getSession(signal?: AbortSignal) {
  const supabase = await getSupabase();

  // If already aborted, return immediately
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (sessionCheckPromise) {
    return sessionCheckPromise;
  }

  sessionCheckPromise = (async () => {
    const cachedSession = getCachedSessionFromStorage();
    if (cachedSession) {
      if (typeof cachedSession.expires_at !== "number") {
        return { data: { session: cachedSession }, error: null };
      }
      const expiresAtMs = cachedSession.expires_at * 1000;
      const expiresSoon = expiresAtMs - Date.now() < 60_000;
      if (!expiresSoon) {
        return { data: { session: cachedSession }, error: null };
      }
    }

    try {
      const result = await withTimeout(
        supabase.auth.getSession(),
        SUPABASE_AUTH_TIMEOUT_MS,
        "Timed out while checking your session.",
        signal,
      );
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
        // Session refresh timed out, falling back to direct session fetch
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
        return { data: { session: null }, error: new Error("Timed out while checking your session.") };
      }
    } finally {
      sessionCheckPromise = null;
    }
  })();

  return sessionCheckPromise;
}

export async function getUser(signal?: AbortSignal) {
  const supabase = await getSupabase();

  // Check if signal is already aborted
  if (signal?.aborted) {
    return null;
  }

  try {
    const { data: { user } } = await withTimeout(
      supabase.auth.getUser(),
      SUPABASE_AUTH_TIMEOUT_MS,
      "Timed out while fetching user details.",
      signal,
    );
    return user;
  } catch (err) {
    // Handle AbortError gracefully (can happen in React Strict Mode or component unmount)
    if (isAbortError(err)) {
      return null;
    }
    if (err instanceof Error && err.message.includes("Timed out")) {
      return null;
    }
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
  // Check if signal is already aborted
  if (signal?.aborted) {
    return false;
  }

  try {
    const cachedSession = getCachedSessionFromStorage();
    const cachedClaim = getAdminClaimFromSession(cachedSession);
    if (cachedClaim !== undefined) {
      return cachedClaim;
    }

    // Fall back to live session only if claim is missing from cache
    const sessionResult = await getSession(signal);
    const sessionClaim = getAdminClaimFromSession(sessionResult?.data?.session);
    if (sessionClaim !== undefined) {
      return sessionClaim;
    }

    return false;
  } catch (err) {
    // Handle AbortError gracefully (can happen in React Strict Mode or component unmount)
    if (isAbortError(err)) {
      return false;
    }
    throw err;
  }
}
