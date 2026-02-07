/**
 * Vault Secret Management
 *
 * Shared utilities for reading, creating, and updating secrets in Supabase Vault.
 * Used across Edge Functions for secure storage of OAuth tokens and credentials.
 */

import { type SupabaseClient } from "@supabase/supabase-js";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

/**
 * Fetches and decrypts a secret from the vault
 *
 * @param client - Supabase client with service_role permissions
 * @param secretId - UUID of the vault secret
 * @returns Decrypted secret value
 * @throws Error if secret cannot be read
 */
export async function fetchDecryptedSecret(
  client: AnySupabaseClient,
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
  client: AnySupabaseClient,
  secretId: string | null,
  secretValue: string,
  nameHint: string,
): Promise<string> {
  // If we have a secretId, update directly
  if (secretId) {
    const { error } = await (client as any).schema("display").rpc("vault_update_secret", {
      p_secret_id: secretId,
      p_secret: secretValue,
      p_name: null,
      p_description: null,
      p_key_id: null,
    });

    if (error) {
      console.error("[vault] Failed to update secret:", error);
      throw new Error("Failed to update vault secret");
    }

    return secretId;
  }

  // Try to find existing secret by name (upsert pattern)
  const { data: existingId, error: findError } = await (client as any)
    .schema("display")
    .rpc("vault_find_secret_by_name", { p_name: nameHint });

  if (findError) {
    console.error("[vault] Failed to find secret by name:", findError);
  }

  if (existingId) {
    // Update existing secret
    console.log("[vault] Found existing secret, updating:", nameHint);
    const { error: updateError } = await (client as any).schema("display").rpc("vault_update_secret", {
      p_secret_id: existingId,
      p_secret: secretValue,
      p_name: null,
      p_description: null,
      p_key_id: null,
    });

    if (updateError) {
      console.error("[vault] Failed to update existing secret:", updateError);
      throw new Error("Failed to update vault secret");
    }

    return existingId as string;
  }

  // Create new secret
  console.log("[vault] Creating new secret:", nameHint);
  const { data, error } = await (client as any).schema("display").rpc("vault_create_secret", {
    p_name: nameHint,
    p_secret: secretValue,
  });

  if (error || !data) {
    console.error("[vault] Failed to create secret:", error);
    throw new Error("Failed to create vault secret");
  }

  return data as string;
}
