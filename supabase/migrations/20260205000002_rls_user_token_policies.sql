-- Migration: Add RLS policies for user token access and polling toggle

-- Policy: Users can read their own user-scoped tokens
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'oauth_tokens' 
    AND policyname = 'oauth_tokens_user_select'
  ) THEN
    CREATE POLICY oauth_tokens_user_select ON display.oauth_tokens
      FOR SELECT USING (
        token_scope = 'user' AND user_id = auth.uid()
      );
  END IF;
END $$;

-- Policy: Users can update webex_polling_enabled on their own devices
-- Note: There's already a user_devices_self_select policy, but we need update
-- Check if policy already exists and modify if needed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'user_devices' 
    AND policyname = 'user_devices_self_update_polling'
  ) THEN
    CREATE POLICY user_devices_self_update_polling ON display.user_devices
      FOR UPDATE 
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

COMMENT ON POLICY oauth_tokens_user_select ON display.oauth_tokens IS 
  'Users can view their own user-scoped OAuth tokens';

COMMENT ON POLICY user_devices_self_update_polling ON display.user_devices IS 
  'Users can update their own device settings including webex_polling_enabled';
