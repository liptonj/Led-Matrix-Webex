/**
 * Vault Secret Management
 *
 * Shared utilities for reading, creating, and updating secrets in Supabase Vault.
 * Used across Edge Functions for secure storage of OAuth tokens and credentials.
 */

import { createClient } from "@supabase/supabase-js";

/**
 * Fetches and decrypts a secret from the vault
 *
 * @param client - Supabase client with service_role permissions
 * @param secretId - UUID of the vault secret
 * @returns Decrypted secret value
 * @throws Error if secret cannot be read
 */
export async function fetchDecryptedSecret(
  client: ReturnType<typeof createClient>,
  secretId: string,
): Promise<string> {
  const { data, error } = await (client as any).schema("display").rpc("vault_read_secret", {
    p_secret_id: secretId,
  });

  if (error || !data) {
    throw new Error("Failed to read secret from vault");
  }
  return data as string;
}

/**
 * Updates an existing secret or creates a new one
 *
 * @param client - Supabase client with service_role permissions
 * @param secretId - UUID of existing secret (null to create new)
 * @param secretValue - New secret value to store
 * @param nameHint - Descriptive name for the secret (used when creating)
 * @returns UUID of the secret (existing or newly created)
 * @throws Error if operation fails
 */
export async function updateSecret(
  client: ReturnType<typeof createClient>,
  secretId: string | null,
  secretValue: string,
  nameHint: string,
): Promise<string> {
  if (secretId) {
    const { error } = await (client as any).schema("display").rpc("vault_update_secret", {
      p_secret_id: secretId,
      p_secret: secretValue,
      p_name: null,
      p_description: null,
      p_key_id: null,
    });

    if (error) {
      throw new Error("Failed to update vault secret");
    }

    return secretId;
  }

  const { data, error } = await (client as any).schema("display").rpc("vault_create_secret", {
    p_secret: secretValue,
    p_name: nameHint,
  });

  if (error || !data) {
    throw new Error("Failed to create vault secret");
  }

  return data as string;
}
