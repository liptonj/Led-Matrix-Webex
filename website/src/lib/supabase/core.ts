import { getSupabaseClient } from "../supabaseClient";

// Supabase URL and anon key are public - they're meant to be exposed
// Row Level Security (RLS) protects the data
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_REQUEST_TIMEOUT_MS = 10_000;
const SUPABASE_AUTH_TIMEOUT_MS = 10_000;

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    return err.name === "AbortError" || err.message.includes("aborted");
  }
  const maybe = err as { name?: string; message?: string };
  if (maybe?.name === "AbortError") return true;
  return typeof maybe?.message === "string" && maybe.message.includes("aborted");
}

function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  // Check if already aborted
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      })
    : null;

  const racers = [Promise.resolve(promise), timeoutPromise];
  if (abortPromise) racers.push(abortPromise);

  return (Promise.race(racers) as Promise<T>).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function getStorageKeyForSession() {
  if (!supabaseUrl) return null;
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
}

function getCachedSessionFromStorage() {
  if (typeof window === "undefined") return null;
  const storageKey = getStorageKeyForSession();
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      user?: {
        id?: string;
        email?: string;
        app_metadata?: Record<string, unknown>;
        user_metadata?: Record<string, unknown>;
      };
    };
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    if (parsed.expires_at && parsed.expires_at * 1000 < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getCachedSession() {
  return getCachedSessionFromStorage();
}

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}

// Supabase client type (we'll create it dynamically)
// Supabase client is a global singleton (see supabaseClient.ts)
export async function getSupabase() {
  return getSupabaseClient();
}

export {
  supabaseUrl,
  supabaseAnonKey,
  SUPABASE_REQUEST_TIMEOUT_MS,
  SUPABASE_AUTH_TIMEOUT_MS,
  isAbortError,
  withTimeout,
  getStorageKeyForSession,
  getCachedSessionFromStorage,
};
