-- Wrapper functions to access Vault from Edge Functions
-- The vault schema is not exposed via the Supabase JS client,
-- so we need to create wrapper functions that can be called via RPC

-- Function to create a secret in the vault and return its UUID
CREATE OR REPLACE FUNCTION display.vault_create_secret(
  p_name TEXT,
  p_secret TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = display, vault, pg_temp
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  -- Call vault.create_secret and return the UUID
  SELECT vault.create_secret(p_secret, p_name) INTO v_secret_id;
  RETURN v_secret_id;
END;
$$;

-- Function to retrieve a decrypted secret from the vault
CREATE OR REPLACE FUNCTION display.vault_read_secret(
  p_secret_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = display, vault, pg_temp
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  -- Retrieve the decrypted secret from vault.decrypted_secrets view
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = p_secret_id;

  RETURN v_secret;
END;
$$;

-- Grant execute permissions to service_role (used by edge functions)
GRANT EXECUTE ON FUNCTION display.vault_create_secret(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION display.vault_read_secret(UUID) TO service_role;

-- Revoke from other roles for security
REVOKE EXECUTE ON FUNCTION display.vault_create_secret(TEXT, TEXT) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION display.vault_read_secret(UUID) FROM authenticated, anon;
