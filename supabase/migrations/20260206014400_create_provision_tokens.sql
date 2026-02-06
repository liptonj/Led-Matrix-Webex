-- Migration: Create provision_tokens table for session token auto-provisioning
-- This table stores temporary, single-use tokens for auto-linking devices to users
-- during ESP Web Tools firmware installation

-- Create the provision_tokens table
CREATE TABLE IF NOT EXISTS display.provision_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  CONSTRAINT token_format CHECK (char_length(token) = 32)
);

-- Add comment describing the table
COMMENT ON TABLE display.provision_tokens IS 'Temporary tokens for auto-provisioning devices via ESP Web Tools. Single-use, deleted after consumption.';

-- Create index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_provision_tokens_token 
  ON display.provision_tokens(token);

-- Create index for efficient expired token cleanup
CREATE INDEX IF NOT EXISTS idx_provision_tokens_expires_at 
  ON display.provision_tokens(expires_at);

-- Enable Row Level Security
ALTER TABLE display.provision_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can create their own tokens
CREATE POLICY "Users can create their own tokens"
  ON display.provision_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can view their own tokens
CREATE POLICY "Users can view their own tokens"
  ON display.provision_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Service role has full access (for backend token validation and deletion)
CREATE POLICY "Service role full access"
  ON display.provision_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant usage on cron schema to postgres
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule hourly cleanup of expired tokens
-- This prevents accumulation of unused/expired tokens in the database
SELECT cron.schedule(
  'cleanup-expired-provision-tokens',
  '0 * * * *',  -- Every hour at minute 0
  $$DELETE FROM display.provision_tokens WHERE expires_at < now()$$
);

-- Add table to realtime publication (optional, for monitoring)
-- ALTER PUBLICATION supabase_realtime ADD TABLE display.provision_tokens;
