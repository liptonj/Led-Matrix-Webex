-- Add release_channel to releases table for beta/production workflow
-- All CI builds create beta releases; production releases are created via promotion workflow

-- Add release_channel column to releases
ALTER TABLE display.releases 
  ADD COLUMN IF NOT EXISTS release_channel TEXT NOT NULL DEFAULT 'beta'
  CHECK (release_channel IN ('beta', 'production'));

-- Drop the old unique constraint on version alone
ALTER TABLE display.releases DROP CONSTRAINT IF EXISTS releases_version_key;

-- Add new unique constraint: version must be unique per channel
-- This allows the same version to exist in both beta and production
ALTER TABLE display.releases 
  ADD CONSTRAINT releases_version_channel_key UNIQUE (version, release_channel);

-- Add index for efficient channel filtering
CREATE INDEX IF NOT EXISTS idx_releases_channel ON display.releases(release_channel);

-- Add release_channel column to devices (determines which firmware channel device receives)
ALTER TABLE display.devices 
  ADD COLUMN IF NOT EXISTS release_channel TEXT NOT NULL DEFAULT 'production'
  CHECK (release_channel IN ('beta', 'production'));

-- Add index for device channel queries
CREATE INDEX IF NOT EXISTS idx_devices_channel ON display.devices(release_channel);

-- Update set_latest_release RPC to be channel-aware
-- Each channel has its own "latest" release
CREATE OR REPLACE FUNCTION display.set_latest_release(
  target_version TEXT, 
  target_channel TEXT DEFAULT 'production'
)
RETURNS VOID AS $$
BEGIN
  -- Clear is_latest for the same channel only
  UPDATE display.releases 
    SET is_latest = FALSE 
    WHERE is_latest = TRUE AND release_channel = target_channel;
  
  -- Set new latest for this channel
  UPDATE display.releases 
    SET is_latest = TRUE 
    WHERE version = target_version AND release_channel = target_channel;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Release version % in channel % not found', target_version, target_channel;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute on the updated function
GRANT EXECUTE ON FUNCTION display.set_latest_release(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION display.set_latest_release(TEXT, TEXT) TO service_role;
