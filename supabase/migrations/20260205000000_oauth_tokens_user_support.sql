-- Migration: Extend oauth_tokens to support user-level tokens
-- This allows storing user OAuth tokens in addition to device OAuth tokens

-- Allow NULL for serial_number and pairing_code (user tokens don't have these)
-- These are safe to run multiple times
ALTER TABLE display.oauth_tokens 
  ALTER COLUMN serial_number DROP NOT NULL;
ALTER TABLE display.oauth_tokens 
  ALTER COLUMN pairing_code DROP NOT NULL;

-- Add user token columns (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'display' AND table_name = 'oauth_tokens' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE display.oauth_tokens 
      ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'display' AND table_name = 'oauth_tokens' AND column_name = 'token_scope'
  ) THEN
    ALTER TABLE display.oauth_tokens 
      ADD COLUMN token_scope TEXT NOT NULL DEFAULT 'device' 
        CHECK (token_scope IN ('device', 'user'));
  END IF;
END $$;

-- Constraint: user tokens must have user_id, device tokens must have serial_number (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_tokens_scope_check'
  ) THEN
    ALTER TABLE display.oauth_tokens
      ADD CONSTRAINT oauth_tokens_scope_check CHECK (
        (token_scope = 'device' AND serial_number IS NOT NULL) OR
        (token_scope = 'user' AND user_id IS NOT NULL)
      );
  END IF;
END $$;

-- Unique constraint for user tokens (one token per provider per user) (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS oauth_tokens_provider_user_idx 
  ON display.oauth_tokens (provider, user_id) 
  WHERE token_scope = 'user';

-- Comment for documentation
COMMENT ON COLUMN display.oauth_tokens.user_id IS 
  'User ID for user-scope tokens. NULL for device-scope tokens.';

COMMENT ON COLUMN display.oauth_tokens.token_scope IS 
  'Scope of token: "device" for device-specific tokens, "user" for user-level tokens';
