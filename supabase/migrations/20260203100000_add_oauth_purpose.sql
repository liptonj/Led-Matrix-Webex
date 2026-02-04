-- Fix OAuth clients schema to support multiple callbacks per provider
-- We need to drop the old (provider, client_id) constraint and use (provider, purpose) instead

-- Drop the old unique constraint that prevents duplicate client_ids per provider
ALTER TABLE display.oauth_clients 
DROP CONSTRAINT IF EXISTS oauth_clients_provider_client_id_key;

-- Add purpose column if it doesn't exist
ALTER TABLE display.oauth_clients 
ADD COLUMN IF NOT EXISTS purpose TEXT DEFAULT 'device';

-- Add a unique constraint on (provider, purpose) instead
-- This allows the same provider+client_id to have multiple purposes
CREATE UNIQUE INDEX IF NOT EXISTS oauth_clients_provider_purpose_idx 
ON display.oauth_clients (provider, purpose);

-- Update existing row to be 'device' purpose (if it exists)
UPDATE display.oauth_clients
SET purpose = 'device'
WHERE provider = 'webex' AND purpose IS NULL;

-- Insert new configuration for user authentication
-- (Only if it doesn't exist already)
INSERT INTO display.oauth_clients (
  provider,
  client_id,
  client_secret_id,
  redirect_uri,
  purpose,
  active
)
SELECT 
  'webex',
  client_id,  -- Same client_id as device config
  client_secret_id,  -- Same secret as device config
  'https://fmultmlsevqgtnqzaylg.supabase.co/functions/v1/webex-user-callback',  -- New callback
  'user',  -- Different purpose
  true
FROM display.oauth_clients
WHERE provider = 'webex' AND purpose = 'device'
ON CONFLICT (provider, purpose) DO NOTHING;

-- Verify both configs exist
SELECT provider, purpose, redirect_uri, active, created_at
FROM display.oauth_clients
WHERE provider = 'webex'
ORDER BY purpose;
