-- Migration: Add Webex OAuth fields to user_profiles
-- Enables Webex OAuth authentication and profile data storage

-- Add Webex OAuth fields to user_profiles
ALTER TABLE display.user_profiles
    ADD COLUMN IF NOT EXISTS webex_user_id TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS webex_email TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'email' 
        CHECK (auth_provider IN ('email', 'webex'));

CREATE INDEX IF NOT EXISTS idx_user_profiles_webex_id 
    ON display.user_profiles(webex_user_id) 
    WHERE webex_user_id IS NOT NULL;

COMMENT ON COLUMN display.user_profiles.webex_user_id IS 'Webex user ID from OAuth (sub claim)';
COMMENT ON COLUMN display.user_profiles.webex_email IS 'Email from Webex OAuth profile';
COMMENT ON COLUMN display.user_profiles.avatar_url IS 'Avatar URL from Webex OAuth profile';
COMMENT ON COLUMN display.user_profiles.display_name IS 'Display name from Webex OAuth profile';
COMMENT ON COLUMN display.user_profiles.auth_provider IS 'How user authenticated: email or webex';
