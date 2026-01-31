-- Wrapper function to update a vault secret from Edge Functions
CREATE OR REPLACE FUNCTION display.vault_update_secret(
  p_secret_id UUID,
  p_secret TEXT,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_key_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = display, vault, pg_temp
AS $$
BEGIN
  PERFORM vault.update_secret(
    p_secret_id,
    p_secret,
    p_name,
    p_description,
    p_key_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION display.vault_update_secret(UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION display.vault_update_secret(UUID, TEXT, TEXT, TEXT, UUID) FROM authenticated, anon;
