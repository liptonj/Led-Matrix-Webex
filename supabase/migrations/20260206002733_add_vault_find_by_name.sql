-- Migration: Add vault_find_secret_by_name function
-- Purpose: Allow finding vault secrets by name for upsert logic in Edge Functions

-- Create function to find vault secret by name
CREATE OR REPLACE FUNCTION display.vault_find_secret_by_name(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, display
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = p_name;
  
  RETURN v_secret_id;
END;
$$;

-- Grant execute to service_role (Edge Functions use this role)
GRANT EXECUTE ON FUNCTION display.vault_find_secret_by_name(text) TO service_role;

COMMENT ON FUNCTION display.vault_find_secret_by_name(text) IS 
  'Finds a vault secret by name and returns its UUID. Returns NULL if not found.';
