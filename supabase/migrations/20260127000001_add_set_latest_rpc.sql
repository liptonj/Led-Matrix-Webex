-- Migration: Add RPC function for atomic set_latest_release
-- This function atomically clears all existing is_latest flags and sets the new one
-- to avoid race conditions when updating the latest release.

-- =============================================================================
-- Function: display.set_latest_release
-- Atomically sets a release as the latest, clearing all other is_latest flags
-- =============================================================================
CREATE OR REPLACE FUNCTION display.set_latest_release(target_version TEXT)
RETURNS VOID AS $$
BEGIN
    -- Clear all existing latest flags first
    UPDATE display.releases SET is_latest = FALSE WHERE is_latest = TRUE;
    
    -- Set the new latest
    UPDATE display.releases SET is_latest = TRUE WHERE version = target_version;
    
    -- Verify the update happened (raises an exception if no rows matched)
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Release version % not found', target_version;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (admins)
GRANT EXECUTE ON FUNCTION display.set_latest_release(TEXT) TO authenticated;

-- Also grant to service_role for CI operations
GRANT EXECUTE ON FUNCTION display.set_latest_release(TEXT) TO service_role;
