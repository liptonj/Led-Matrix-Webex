-- Migration: Add change detection to prevent redundant realtime notifications
--
-- Problem: Every heartbeat or polling update triggers a realtime notification,
-- even when the actual status values haven't changed. This causes unnecessary
-- network traffic and device processing.
--
-- Solution: 
-- 1. Create separate heartbeat table for connection tracking (not subscribed to)
-- 2. Keep status fields in pairings table (device subscribes to this)
-- 3. Add trigger that only updates status_updated_at when STATUS values change
-- 4. Heartbeats update heartbeat table → NO realtime notification
-- 5. Status changes update pairings table → realtime notification sent

-- =============================================================================
-- Part 0: Create separate heartbeat table for connection tracking
-- =============================================================================
-- This table tracks app/device connectivity WITHOUT triggering realtime notifications
-- Device subscribes to pairings table, NOT this table

CREATE TABLE IF NOT EXISTS display.connection_heartbeats (
    pairing_code TEXT PRIMARY KEY REFERENCES display.pairings(pairing_code) ON DELETE CASCADE,
    app_last_seen TIMESTAMPTZ,
    app_connected BOOLEAN DEFAULT FALSE,
    device_last_seen TIMESTAMPTZ,
    device_connected BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE display.connection_heartbeats IS 'Tracks app/device connection state separately from status. Updates to this table do NOT trigger realtime notifications to devices.';

-- Add trigger to update updated_at
CREATE TRIGGER connection_heartbeats_updated_at
    BEFORE UPDATE ON display.connection_heartbeats
    FOR EACH ROW
    EXECUTE FUNCTION display.update_updated_at();

-- Enable RLS
ALTER TABLE display.connection_heartbeats ENABLE ROW LEVEL SECURITY;

-- RLS: Devices can read their own heartbeat
CREATE POLICY "Devices can read own heartbeat"
    ON display.connection_heartbeats FOR SELECT
    USING (
        pairing_code = current_setting('request.jwt.claims', true)::json->>'pairing_code'
    );

-- RLS: Service role can do anything
CREATE POLICY "Service role full access to heartbeats"
    ON display.connection_heartbeats FOR ALL
    USING (
        current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
    );

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_heartbeats_pairing ON display.connection_heartbeats(pairing_code);

-- Migrate existing heartbeat data from pairings
INSERT INTO display.connection_heartbeats (pairing_code, app_last_seen, app_connected, device_last_seen, device_connected)
SELECT pairing_code, app_last_seen, app_connected, device_last_seen, device_connected
FROM display.pairings
WHERE pairing_code IS NOT NULL
ON CONFLICT (pairing_code) DO UPDATE SET
    app_last_seen = EXCLUDED.app_last_seen,
    app_connected = EXCLUDED.app_connected,
    device_last_seen = EXCLUDED.device_last_seen,
    device_connected = EXCLUDED.device_connected;

-- =============================================================================
-- Part 1: Add status_updated_at column for change detection
-- =============================================================================

ALTER TABLE display.pairings
    ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

-- Set initial value to updated_at for existing rows
UPDATE display.pairings 
SET status_updated_at = COALESCE(updated_at, created_at, NOW())
WHERE status_updated_at IS NULL;

-- Make it NOT NULL with default
ALTER TABLE display.pairings
    ALTER COLUMN status_updated_at SET DEFAULT NOW();

COMMENT ON COLUMN display.pairings.status_updated_at IS 'Timestamp when status-relevant fields last changed (webex_status, camera_on, mic_muted, in_call, display_name). Used for realtime filtering.';

-- =============================================================================
-- Part 2: Create trigger function for status change detection
-- =============================================================================

CREATE OR REPLACE FUNCTION display.update_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update status_updated_at if status-relevant fields actually changed
    -- This prevents heartbeats from triggering status notifications
    IF (
        -- Compare status fields - handle NULL values properly
        COALESCE(NEW.webex_status, '') IS DISTINCT FROM COALESCE(OLD.webex_status, '') OR
        COALESCE(NEW.camera_on, FALSE) IS DISTINCT FROM COALESCE(OLD.camera_on, FALSE) OR
        COALESCE(NEW.mic_muted, FALSE) IS DISTINCT FROM COALESCE(OLD.mic_muted, FALSE) OR
        COALESCE(NEW.in_call, FALSE) IS DISTINCT FROM COALESCE(OLD.in_call, FALSE) OR
        COALESCE(NEW.display_name, '') IS DISTINCT FROM COALESCE(OLD.display_name, '') OR
        -- Also track connection state changes (device connected/disconnected)
        COALESCE(NEW.device_connected, FALSE) IS DISTINCT FROM COALESCE(OLD.device_connected, FALSE) OR
        COALESCE(NEW.app_connected, FALSE) IS DISTINCT FROM COALESCE(OLD.app_connected, FALSE)
    ) THEN
        NEW.status_updated_at = NOW();
    ELSE
        -- Keep the old timestamp if no status fields changed
        NEW.status_updated_at = OLD.status_updated_at;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop if exists to allow re-running)
DROP TRIGGER IF EXISTS pairings_status_change ON display.pairings;

CREATE TRIGGER pairings_status_change
    BEFORE UPDATE ON display.pairings
    FOR EACH ROW
    EXECUTE FUNCTION display.update_status_timestamp();

COMMENT ON FUNCTION display.update_status_timestamp() IS 'Updates status_updated_at only when status-relevant fields change, preventing heartbeat-only updates from triggering realtime notifications.';

-- =============================================================================
-- Part 3: Create index for efficient filtering
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_pairings_status_updated 
    ON display.pairings(pairing_code, status_updated_at DESC);

-- =============================================================================
-- Part 4: Helper function to check if device should receive update
-- =============================================================================

-- This function can be used by Edge Functions to check if an update would
-- actually change any status values before performing the update
CREATE OR REPLACE FUNCTION display.status_values_changed(
    p_pairing_code TEXT,
    p_webex_status TEXT DEFAULT NULL,
    p_camera_on BOOLEAN DEFAULT NULL,
    p_mic_muted BOOLEAN DEFAULT NULL,
    p_in_call BOOLEAN DEFAULT NULL,
    p_display_name TEXT DEFAULT NULL,
    p_app_connected BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    current_record display.pairings%ROWTYPE;
    has_changes BOOLEAN := FALSE;
BEGIN
    -- Get current values
    SELECT * INTO current_record
    FROM display.pairings
    WHERE pairing_code = p_pairing_code;
    
    IF NOT FOUND THEN
        -- New record would be created
        RETURN TRUE;
    END IF;
    
    -- Check each field if provided
    -- Note: Parameters default to NULL meaning "not being updated"
    -- A value of FALSE is distinct from NULL and means "setting to false"
    
    -- Connection state changes are always significant
    IF p_app_connected IS NOT NULL AND 
       p_app_connected IS DISTINCT FROM COALESCE(current_record.app_connected, FALSE) THEN
        has_changes := TRUE;
    END IF;
    
    -- Webex status (string comparison)
    IF p_webex_status IS NOT NULL AND 
       COALESCE(p_webex_status, '') IS DISTINCT FROM COALESCE(current_record.webex_status, '') THEN
        has_changes := TRUE;
    END IF;
    
    -- Camera state (boolean comparison - FALSE is a valid value, not "no change")
    IF p_camera_on IS NOT NULL AND 
       p_camera_on IS DISTINCT FROM COALESCE(current_record.camera_on, FALSE) THEN
        has_changes := TRUE;
    END IF;
    
    -- Microphone state
    IF p_mic_muted IS NOT NULL AND 
       p_mic_muted IS DISTINCT FROM COALESCE(current_record.mic_muted, FALSE) THEN
        has_changes := TRUE;
    END IF;
    
    -- Call state
    IF p_in_call IS NOT NULL AND 
       p_in_call IS DISTINCT FROM COALESCE(current_record.in_call, FALSE) THEN
        has_changes := TRUE;
    END IF;
    
    -- Display name (string comparison)
    IF p_display_name IS NOT NULL AND 
       COALESCE(p_display_name, '') IS DISTINCT FROM COALESCE(current_record.display_name, '') THEN
        has_changes := TRUE;
    END IF;
    
    RETURN has_changes;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION display.status_values_changed(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) IS 
'Returns TRUE if the provided status values differ from current values in the pairings table.
Used by Edge Functions to avoid unnecessary database updates that would trigger realtime notifications.

Parameter behavior:
- NULL (default): Field is not being updated, skip comparison
- FALSE: Field is being set to FALSE, compare against current value
- TRUE: Field is being set to TRUE, compare against current value

Note: device_connected is NOT included because this function is called by the embedded app,
which cannot change the device connection state.';

-- Grant execute to service role (drop and recreate to handle signature change)
DROP FUNCTION IF EXISTS display.status_values_changed(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT);
GRANT EXECUTE ON FUNCTION display.status_values_changed(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) TO service_role;

-- =============================================================================
-- Part 5: Add comments about deprecated columns in pairings table
-- =============================================================================
-- The following columns in display.pairings are now DEPRECATED for new code:
--   - app_last_seen (use connection_heartbeats.app_last_seen)
--   - device_last_seen (use connection_heartbeats.device_last_seen)
--   - app_connected (use connection_heartbeats.app_connected)
--   - device_connected (use connection_heartbeats.device_connected)
--
-- These columns are kept for backwards compatibility but should be migrated
-- to use connection_heartbeats table. Updates to these columns will still
-- trigger realtime notifications, which defeats the purpose of this migration.

COMMENT ON COLUMN display.pairings.app_last_seen IS 'DEPRECATED: Use connection_heartbeats.app_last_seen instead. Kept for backwards compatibility.';
COMMENT ON COLUMN display.pairings.device_last_seen IS 'DEPRECATED: Use connection_heartbeats.device_last_seen instead. Kept for backwards compatibility.';
COMMENT ON COLUMN display.pairings.app_connected IS 'App connection state. Updated via Edge Functions. Note: For heartbeat tracking, use connection_heartbeats table to avoid triggering realtime.';
COMMENT ON COLUMN display.pairings.device_connected IS 'Device connection state. Note: For heartbeat tracking, use connection_heartbeats table to avoid triggering realtime.';
