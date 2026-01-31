-- Enable Supabase Vault extension for storing encrypted secrets
-- The Vault is used to securely store OAuth client secrets and access tokens

-- Create vault schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS vault;

-- Enable the Vault extension
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Grant necessary permissions to authenticated and service role users
GRANT USAGE ON SCHEMA vault TO postgres, authenticated, service_role;

-- Grant permissions on vault tables and sequences
DO $$
BEGIN
  GRANT ALL ON ALL TABLES IN SCHEMA vault TO postgres, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA vault TO postgres, service_role;
EXCEPTION
  WHEN OTHERS THEN
    -- Permission errors are expected on some internal functions
    NULL;
END $$;
