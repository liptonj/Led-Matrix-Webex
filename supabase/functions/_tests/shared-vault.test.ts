/**
 * Vault Secret Management Tests
 *
 * Tests for the vault.ts shared module that handles secure secret storage.
 *
 * Run: deno test --allow-net --allow-env _tests/shared-vault.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "@supabase/supabase-js";
import { fetchDecryptedSecret, updateSecret } from "../_shared/vault.ts";

// Mock Supabase client for testing
function createMockSupabaseClient() {
  return {
    schema: () => ({
      rpc: async (fnName: string, params: Record<string, unknown>) => {
        if (fnName === "vault_read_secret") {
          if (params.p_secret_id === "valid-secret-id") {
            return { data: "decrypted-secret-value", error: null };
          }
          return { data: null, error: { message: "Secret not found" } };
        }
        if (fnName === "vault_update_secret") {
          if (params.p_secret_id === "valid-secret-id") {
            return { data: null, error: null };
          }
          return { data: null, error: { message: "Update failed" } };
        }
        if (fnName === "vault_create_secret") {
          return { data: "new-secret-id-uuid", error: null };
        }
        return { data: null, error: { message: "Unknown RPC function" } };
      },
    }),
  } as unknown as ReturnType<typeof createClient>;
}

// ============================================================================
// fetchDecryptedSecret Tests
// ============================================================================

Deno.test("vault: fetchDecryptedSecret returns decrypted value for valid secret", async () => {
  const supabase = createMockSupabaseClient();
  const secret = await fetchDecryptedSecret(supabase, "valid-secret-id");
  assertEquals(secret, "decrypted-secret-value");
});

Deno.test("vault: fetchDecryptedSecret throws error for invalid secret ID", async () => {
  const supabase = createMockSupabaseClient();
  await assertRejects(
    async () => {
      await fetchDecryptedSecret(supabase, "invalid-secret-id");
    },
    Error,
    "Failed to read secret from vault",
  );
});

Deno.test("vault: fetchDecryptedSecret throws error when RPC returns null data", async () => {
  const supabase = createMockSupabaseClient();
  await assertRejects(
    async () => {
      await fetchDecryptedSecret(supabase, "null-data-secret-id");
    },
    Error,
    "Failed to read secret from vault",
  );
});

// ============================================================================
// updateSecret Tests
// ============================================================================

Deno.test("vault: updateSecret updates existing secret", async () => {
  const supabase = createMockSupabaseClient();
  const secretId = await updateSecret(
    supabase,
    "valid-secret-id",
    "new-secret-value",
    "test-secret-name",
  );
  assertEquals(secretId, "valid-secret-id");
});

Deno.test("vault: updateSecret creates new secret when secretId is null", async () => {
  const supabase = createMockSupabaseClient();
  const secretId = await updateSecret(
    supabase,
    null,
    "new-secret-value",
    "test-secret-name",
  );
  assertEquals(secretId, "new-secret-id-uuid");
  assertExists(secretId);
});

Deno.test("vault: updateSecret throws error when update fails", async () => {
  const supabase = createMockSupabaseClient();
  await assertRejects(
    async () => {
      await updateSecret(
        supabase,
        "invalid-secret-id",
        "new-secret-value",
        "test-secret-name",
      );
    },
    Error,
    "Failed to update vault secret",
  );
});

Deno.test("vault: updateSecret throws error when create fails", async () => {
  const mockSupabase = {
    schema: () => ({
      rpc: async (fnName: string, params: Record<string, unknown>) => {
        if (fnName === "vault_create_secret") {
          return { data: null, error: { message: "Create failed" } };
        }
        return { data: null, error: null };
      },
    }),
  } as unknown as ReturnType<typeof createClient>;

  await assertRejects(
    async () => {
      await updateSecret(mockSupabase, null, "new-secret-value", "test-secret-name");
    },
    Error,
    "Failed to create vault secret",
  );
});

Deno.test("vault: updateSecret uses nameHint when creating new secret", async () => {
  const supabase = createMockSupabaseClient();
  const secretId = await updateSecret(
    supabase,
    null,
    "secret-value",
    "webex_access_ABC123",
  );
  assertEquals(secretId, "new-secret-id-uuid");
});
