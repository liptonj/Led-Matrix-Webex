-- Migration: Extend oauth_tokens to support user-level tokens
-- This allows storing user OAuth tokens in addition to device OAuth tokens

-- Allow NULL for serial_number and pairing_code (user tokens don't have these)
ALTER TABLE display.oauth_tokens 
  ALTER COLUMN serial_number DROP NOT NULL,
  ALTER COLUMN pairing_code DROP NOT NULL;

-- Add user token columns
ALTER TABLE display.oauth_tokens 
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN token_scope TEXT NOT NULL DEFAULT 'device' 
    CHECK (token_scope IN ('device', 'user'));

-- Constraint: user tokens must have user_id, device tokens must have serial_number
ALTER TABLE display.oauth_tokens
  ADD CONSTRAINT oauth_tokens_scope_check CHECK (
    (token_scope = 'device' AND serial_number IS NOT NULL) OR
    (token_scope = 'user' AND user_id IS NOT NULL)
  );

-- Unique constraint for user tokens (one token per provider per user)
CREATE UNIQUE INDEX oauth_tokens_provider_user_idx 
  ON display.oauth_tokens (provider, user_id) 
  WHERE token_scope = 'user';

-- Comment for documentation
COMMENT ON COLUMN display.oauth_tokens.user_id IS 
  'User ID for user-scope tokens. NULL for device-scope tokens.';

COMMENT ON COLUMN display.oauth_tokens.token_scope IS 
  'Scope of token: "device" for device-specific tokens, "user" for user-level tokens';
