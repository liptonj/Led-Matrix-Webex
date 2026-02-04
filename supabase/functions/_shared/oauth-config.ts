/**
 * OAuth Configuration Helper
 *
 * Fetches OAuth client credentials from the database instead of environment variables.
 * Reads from display.oauth_clients table and retrieves secrets from vault.
 * Supports multiple OAuth purposes (user auth, device auth, etc.)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Fetches OAuth configuration for a provider from the database.
 *
 * @param provider - OAuth provider name (e.g., 'webex')
 * @param purpose - OAuth purpose: "user" for user authentication, "device" for device OAuth (default: "user")
 * @returns OAuth configuration with client ID, secret, and redirect URI
 * @throws Error if configuration cannot be found or retrieved
 */
export async function getOAuthConfig(
  provider: string = "webex",
  purpose: "user" | "device" = "user"
): Promise<OAuthConfig> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Query oauth_clients table for active client with specific purpose
  const { data: oauthClient, error: clientError } = await supabase
    .schema("display")
    .from("oauth_clients")
    .select("client_id, client_secret_id, redirect_uri")
    .eq("provider", provider)
    .eq("purpose", purpose)
    .eq("active", true)
    .single();

  if (clientError || !oauthClient) {
    console.error(`Failed to fetch OAuth client for ${provider} (${purpose}):`, clientError);
    throw new Error(
      `OAuth client not found or inactive for provider: ${provider}, purpose: ${purpose}`,
    );
  }

  if (!oauthClient.client_secret_id) {
    throw new Error(
      `OAuth client secret ID missing for provider: ${provider}, purpose: ${purpose}`,
    );
  }

  // Fetch the client secret from vault
  const { data: clientSecret, error: secretError } = await supabase
    .schema("display")
    .rpc("vault_read_secret", {
      p_secret_id: oauthClient.client_secret_id,
    });

  if (secretError || !clientSecret) {
    console.error(
      `Failed to read secret from vault for ${provider} (${purpose}):`,
      secretError,
    );
    throw new Error(
      `Failed to retrieve OAuth client secret for provider: ${provider}, purpose: ${purpose}`,
    );
  }

  return {
    clientId: oauthClient.client_id,
    clientSecret: clientSecret as string,
    redirectUri: oauthClient.redirect_uri,
  };
}
