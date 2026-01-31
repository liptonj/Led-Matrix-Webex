import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  getSupabase,
  supabaseUrl,
  withTimeout,
} from "./core";
import { getSession } from "./auth";
import type { OAuthClient } from "./types";

export async function getOAuthClients(): Promise<OAuthClient[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("oauth_clients")
      .select("id, provider, client_id, redirect_uri, active, created_at, updated_at")
      .order("provider", { ascending: true }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading OAuth clients.",
  );

  if (error) throw error;
  return data || [];
}

export async function upsertOAuthClient(params: {
  provider: string;
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  active?: boolean;
}): Promise<OAuthClient> {
  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured.");
  }

  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (process.env.NODE_ENV !== "production") {
    headers["x-debug-auth"] = "1";
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-upsert-oauth-client`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: params.provider,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      active: params.active,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to save OAuth client.");
  }

  const client = body?.client;
  if (!client) {
    throw new Error("Failed to save OAuth client.");
  }
  return client;
}
