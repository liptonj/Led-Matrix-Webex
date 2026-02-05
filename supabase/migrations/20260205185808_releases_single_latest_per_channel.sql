-- Fix: ensure_single_latest trigger should clear is_latest only within the same release_channel.
-- Without this, setting a release as latest in beta would clear latest in production (and vice versa).
-- Matches the channel-aware behaviour of set_latest_release(version, channel).

CREATE OR REPLACE FUNCTION display.ensure_single_latest()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_latest = TRUE THEN
        UPDATE display.releases
        SET is_latest = FALSE
        WHERE id != NEW.id
          AND is_latest = TRUE
          AND release_channel = NEW.release_channel;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
